package com.orbit.sandbox

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

private const val CALL_TIMEOUT_MS = 15_000L
private const val DEFAULT_MAX_FILE_BYTES = 256L * 1024L

/**
 * Expo Modules API bridge and Android platform boundary.
 *
 * Rust inside [OrbitSandboxService] makes every policy, manifest, permission,
 * approval, path and network decision. Kotlin performs no policy evaluation and
 * no code execution. It only forwards validation calls and, after an explicit
 * Rust `allow` for `file.read`, performs a bounded read from the app-private
 * files directory with canonical-path, symlink, regular-file and size checks.
 */
class OrbitMobileSandboxModule : Module() {
  private sealed interface PendingCall {
    class Expo(val promise: Promise) : PendingCall
    class Callback(
      val onResponse: (String) -> Unit,
      val onError: (String, String) -> Unit,
    ) : PendingCall
  }

  private val pendingCalls = ConcurrentHashMap<String, PendingCall>()
  private val timeouts = ConcurrentHashMap<String, Runnable>()
  private val waiters = ArrayDeque<(Messenger) -> Unit>()
  private val sequence = AtomicInteger(0)

  @Volatile private var messenger: Messenger? = null
  @Volatile private var connection: ServiceConnection? = null

  private val replyHandler = Handler(Looper.getMainLooper()) { message ->
    handleReply(message)
    true
  }
  private val replyMessenger = Messenger(replyHandler)

  override fun definition() = ModuleDefinition {
    Name("OrbitMobileSandbox")

    AsyncFunction("describe") { promise: Promise ->
      enqueue("describe", JSONObject(), PendingCall.Expo(promise))
    }

    AsyncFunction("validateManifest") { manifestJson: String, promise: Promise ->
      val manifest = parseObject(manifestJson, promise) ?: return@AsyncFunction
      enqueue(
        "validateManifest",
        JSONObject().put("manifest", manifest),
        PendingCall.Expo(promise),
      )
    }

    AsyncFunction("checkPermission") { requestJson: String, promise: Promise ->
      val params = parseObject(requestJson, promise) ?: return@AsyncFunction
      enqueue("checkPermission", params, PendingCall.Expo(promise))
    }

    AsyncFunction("validatePath") { requestJson: String, promise: Promise ->
      val params = parseObject(requestJson, promise) ?: return@AsyncFunction
      enqueue("validatePath", params, PendingCall.Expo(promise))
    }

    AsyncFunction("validateNetwork") { requestJson: String, promise: Promise ->
      val params = parseObject(requestJson, promise) ?: return@AsyncFunction
      enqueue("validateNetwork", params, PendingCall.Expo(promise))
    }

    AsyncFunction("validateRequest") { requestJson: String, promise: Promise ->
      val params = parseObject(requestJson, promise) ?: return@AsyncFunction
      enqueue("validateRequest", params, PendingCall.Expo(promise))
    }

    AsyncFunction("authorizeOperation") { requestJson: String, promise: Promise ->
      val params = parseObject(requestJson, promise) ?: return@AsyncFunction
      enqueue("authorizeOperation", params, PendingCall.Expo(promise))
    }

    AsyncFunction("readFile") { requestJson: String, promise: Promise ->
      val request = parseObject(requestJson, promise) ?: return@AsyncFunction
      readFile(request, promise)
    }

    AsyncFunction("shutdown") { promise: Promise ->
      shutdownInternal()
      promise.resolve(JSONObject().put("shutdown", true).toString())
    }

    OnDestroy {
      shutdownInternal()
    }
  }

  private fun parseObject(raw: String, promise: Promise): JSONObject? {
    return try {
      JSONObject(raw)
    } catch (error: Exception) {
      promise.reject("SANDBOX_INVALID_JSON", error.message, error)
      null
    }
  }

  private fun enqueue(method: String, params: JSONObject, pending: PendingCall) {
    val id = "rn-${sequence.incrementAndGet()}"
    val envelope = JSONObject()
      .put("id", id)
      .put("method", method)
      .put("params", params)
      .toString()

    pendingCalls[id] = pending
    val timeout = Runnable {
      reject(id, "SANDBOX_TIMEOUT", "Sandbox service did not respond in time.")
    }
    timeouts[id] = timeout
    replyHandler.postDelayed(timeout, CALL_TIMEOUT_MS)

    sendOrQueue(id, envelope)
  }

  private fun sendOrQueue(id: String, envelope: String) {
    val current = messenger
    if (current != null) {
      send(current, id, envelope)
      return
    }

    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      reject(id, "SANDBOX_UNAVAILABLE", "No Android context is available.")
      return
    }

    synchronized(waiters) {
      val bound = messenger
      if (bound != null) {
        send(bound, id, envelope)
        return@synchronized
      }

      if (connection == null) {
        val serviceConnection = object : ServiceConnection {
          override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            if (service == null) {
              releaseConnection()
              rejectAll("SANDBOX_BIND_FAILED", "Sandbox service binder was null.")
              return
            }

            val boundMessenger = Messenger(service)
            synchronized(waiters) {
              messenger = boundMessenger
              while (waiters.isNotEmpty()) {
                waiters.removeFirst()(boundMessenger)
              }
            }
          }

          override fun onServiceDisconnected(name: ComponentName?) {
            // The binding itself stays alive and Android reconnects it because of
            // BIND_AUTO_CREATE. Keep `connection` so the next call does not create a
            // second, leaked binding; only the dead messenger is dropped.
            messenger = null
            rejectAll("SANDBOX_DISCONNECTED", "Sandbox service disconnected.")
          }

          override fun onBindingDied(name: ComponentName?) {
            releaseConnection()
            rejectAll("SANDBOX_BIND_FAILED", "Sandbox service binding died.")
          }

          override fun onNullBinding(name: ComponentName?) {
            releaseConnection()
            rejectAll("SANDBOX_BIND_FAILED", "Sandbox service returned no binder.")
          }
        }

        connection = serviceConnection
        val bound = context.bindService(
          Intent(context, OrbitSandboxService::class.java),
          serviceConnection,
          Context.BIND_AUTO_CREATE,
        )
        if (!bound) {
          releaseConnection()
          rejectAll("SANDBOX_BIND_FAILED", "Unable to bind sandbox service.")
          return@synchronized
        }
      }

      waiters.add { service ->
        // The call may already have timed out or been rejected while it was queued.
        if (pendingCalls.containsKey(id)) {
          send(service, id, envelope)
        }
      }
    }
  }

  private fun send(service: Messenger, id: String, envelope: String) {
    val message = Message.obtain(null, SandboxProtocol.MESSAGE_CALL).apply {
      data.putString(SandboxProtocol.KEY_REQUEST, envelope)
      replyTo = replyMessenger
    }
    try {
      service.send(message)
    } catch (error: Exception) {
      reject(id, "SANDBOX_SEND_FAILED", error.message ?: "Unable to send sandbox request")
    }
  }

  private fun handleReply(message: Message) {
    val response = message.data?.getString(SandboxProtocol.KEY_RESPONSE) ?: return
    val id = runCatching { JSONObject(response).optString("id") }.getOrDefault("")
    val pending = pendingCalls.remove(id) ?: return
    timeouts.remove(id)?.let(replyHandler::removeCallbacks)

    when (pending) {
      is PendingCall.Expo -> pending.promise.resolve(response)
      is PendingCall.Callback -> pending.onResponse(response)
    }
  }

  private fun reject(id: String, code: String, message: String) {
    val pending = pendingCalls.remove(id) ?: return
    timeouts.remove(id)?.let(replyHandler::removeCallbacks)

    when (pending) {
      is PendingCall.Expo -> pending.promise.reject(code, message, null)
      is PendingCall.Callback -> pending.onError(code, message)
    }
  }

  private fun rejectAll(code: String, message: String) {
    for (id in pendingCalls.keys().toList()) {
      reject(id, code, message)
    }
    synchronized(waiters) {
      waiters.clear()
    }
  }

  /** Unbinds the service (if bound) and forgets the connection and messenger. */
  private fun releaseConnection() {
    val context = appContext.reactContext?.applicationContext
    val serviceConnection = connection
    connection = null
    messenger = null
    if (context != null && serviceConnection != null) {
      runCatching { context.unbindService(serviceConnection) }
    }
  }

  private fun shutdownInternal() {
    releaseConnection()
    rejectAll("SANDBOX_SHUT_DOWN", "Sandbox was shut down before the call completed.")
  }

  private fun readFile(request: JSONObject, promise: Promise) {
    val manifest = request.optJSONObject("manifest")
    if (manifest == null) {
      promise.reject("SANDBOX_INVALID_REQUEST", "readFile requires a manifest object.", null)
      return
    }

    val pluginId = request.optString("pluginId")
    val manifestPluginId = manifest.optString("pluginId")

    if (pluginId.isNotEmpty() && pluginId != manifestPluginId) {
      promise.reject(
        "SANDBOX_PLUGIN_MISMATCH",
        "The request pluginId does not match the manifest.",
        null,
      )
      return
    }

    val path = request.optString("path")

    if (path.isEmpty()) {
      promise.reject("SANDBOX_INVALID_REQUEST", "readFile requires a path.", null)
      return
    }

    val granted = request.optJSONArray("grantedPermissions") ?: JSONArray()
    val params = JSONObject()
      .put("manifest", manifest)
      .put("operation", "file.read")
      .put("grantedPermissions", granted)
      .put("resource", JSONObject().put("path", path))

    // Forward approval evidence unchanged. Rust binds it to `resource` and
    // rejects a grant for any other path; Kotlin never rewrites that binding.
    request.optJSONObject("approval")?.let { params.put("approval", it) }

    enqueue(
      "authorizeOperation",
      params,
      PendingCall.Callback(
        onResponse = { response -> completeReadFile(response, request, promise) },
        onError = { code, message -> promise.reject(code, message, null) },
      ),
    )
  }

  private fun completeReadFile(response: String, request: JSONObject, promise: Promise) {
    val started = System.currentTimeMillis()
    val envelope = runCatching { JSONObject(response) }.getOrElse { error ->
      promise.reject("SANDBOX_INVALID_RESPONSE", error.message, error)
      return
    }

    if (!envelope.optBoolean("ok", false)) {
      val error = envelope.optJSONObject("error")
      promise.reject(
        error?.optString("code") ?: "SANDBOX_POLICY_FAILED",
        error?.optString("message") ?: "Sandbox policy call failed.",
        null,
      )
      return
    }

    val decision = envelope.optJSONObject("result")

    if (decision == null) {
      promise.reject("SANDBOX_INVALID_RESPONSE", "Sandbox policy returned no decision.", null)
      return
    }

    if (decision.optString("decision") != "allow") {
      promise.resolve(response)
      return
    }

    val normalizedPath = decision.optString("normalizedResource")
    if (normalizedPath.isEmpty()) {
      promise.reject(
        "SANDBOX_INVALID_RESPONSE",
        "Sandbox allowed a read without an authorized resource.",
        null,
      )
      return
    }

    val limits = decision.optJSONObject("limits")
    val maxFileBytes = limits?.optLong("maxFileBytes", DEFAULT_MAX_FILE_BYTES)
      ?: DEFAULT_MAX_FILE_BYTES
    val audit = decision.optJSONObject("audit")

    try {
      val root = appContext.reactContext?.applicationContext?.filesDir
        ?: throw ReadDenied("sandbox_unavailable", "No app-private files directory is available.")
      val rootCanonical = root.canonicalFile
      val target = File(root, normalizedPath)

      if (containsSymlink(root, normalizedPath)) {
        throw ReadDenied("symlink_not_allowed", "Symlinks are not allowed in sandbox paths.")
      }

      val canonical = target.canonicalFile
      val rootPath = rootCanonical.path
      val targetPath = canonical.path

      if (targetPath != rootPath && !targetPath.startsWith(rootPath + File.separator)) {
        throw ReadDenied("path_escape", "The resolved path is outside the sandbox root.")
      }

      if (!target.exists()) {
        throw ReadDenied("file_not_found", "The requested file does not exist.")
      }

      if (!target.isFile) {
        throw ReadDenied("not_a_regular_file", "Only regular files can be read.")
      }

      if (target.length() > maxFileBytes) {
        throw ReadDenied(
          "file_too_large",
          "The file is ${target.length()} bytes; the limit is $maxFileBytes.",
        )
      }

      val bytes = readBounded(target, maxFileBytes)

      if (bytes.any { it == 0.toByte() }) {
        throw ReadDenied("binary_file", "Binary files are not readable through the sandbox.")
      }

      val content = try {
        Charsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(bytes))
          .toString()
      } catch (error: Exception) {
        throw ReadDenied("invalid_encoding", "The file is not valid UTF-8 text.")
      }

      val result = JSONObject(decision.toString())
        .put("decision", "allow")
        .put("operation", "file.read")
        .put("path", normalizedPath)
        .put("content", content)
        .put("bytesRead", bytes.size)
        .put("reason", "Permission, approval and path policy allowed the read.")
        .put("reasonCode", "allowed")
        .put(
          "audit",
          auditFor(
            audit,
            request.optString("pluginId", ""),
            "file.read",
            "allow",
            "allowed",
            "files.read",
            normalizedPath,
            bytes.size,
            started,
          ),
        )

      promise.resolve(
        JSONObject()
          .put("id", envelope.optString("id"))
          .put("ok", true)
          .put("result", result)
          .toString(),
      )
    } catch (error: ReadDenied) {
      promise.resolve(
        deniedReadResponse(
          envelope,
          decision,
          request,
          error.code,
          error.message ?: error.code,
          started,
        ),
      )
    } catch (error: Exception) {
      promise.resolve(
        deniedReadResponse(
          envelope,
          decision,
          request,
          "read_failed",
          error.message ?: "The bounded file read failed.",
          started,
        ),
      )
    }
  }

  private fun deniedReadResponse(
    envelope: JSONObject,
    decision: JSONObject,
    request: JSONObject,
    code: String,
    message: String,
    started: Long,
  ): String {
    val normalizedPath = decision.optString("normalizedResource").takeIf { it.isNotEmpty() }
    val audit = decision.optJSONObject("audit")
    val result = JSONObject(decision.toString())
      .put("decision", "deny")
      .put("operation", "file.read")
      .put("normalizedResource", normalizedPath ?: JSONObject.NULL)
      .put("reason", message)
      .put("reasonCode", code)
      .put(
        "audit",
        auditFor(
          audit,
          request.optString("pluginId", ""),
          "file.read",
          "deny",
          code,
          "files.read",
          normalizedPath,
          0,
          started,
        ),
      )

    return JSONObject()
      .put("id", envelope.optString("id"))
      .put("ok", true)
      .put("result", result)
      .toString()
  }

  private fun auditFor(
    original: JSONObject?,
    pluginId: String,
    operation: String,
    decision: String,
    reasonCode: String,
    permission: String?,
    resource: String?,
    bytes: Int,
    started: Long,
  ): JSONObject {
    val now = System.currentTimeMillis()
    return JSONObject()
      .put("id", original?.optString("id", "")?.takeIf { it.isNotEmpty() } ?: "audit-$now")
      .put("at", original?.optLong("at", now) ?: now)
      .put("pluginId", pluginId)
      .put("operation", operation)
      .put("decision", decision)
      .put("reasonCode", reasonCode)
      .put("permission", permission ?: JSONObject.NULL)
      .put("resourceHash", resource?.let { fnv1a64(it) } ?: JSONObject.NULL)
      .put("bytes", bytes)
      .put(
        "durationMs",
        (original?.optLong("durationMs", 0) ?: 0) + (System.currentTimeMillis() - started),
      )
      .put("policyVersion", original?.optInt("policyVersion", 3) ?: 3)
      .put(
        "requestId",
        original?.optString("requestId", "")?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL,
      )
  }

  private fun containsSymlink(root: File, relativePath: String): Boolean {
    var current = root

    for (segment in relativePath.split('/')) {
      if (segment.isEmpty()) continue
      current = File(current, segment)
      if (Files.isSymbolicLink(current.toPath())) {
        return true
      }
    }

    return false
  }

  private fun readBounded(file: File, maxBytes: Long): ByteArray {
    FileInputStream(file).use { input ->
      val output = ByteArrayOutputStream()
      val chunk = ByteArray(8 * 1024)
      var total = 0L

      while (true) {
        val read = input.read(chunk)
        if (read < 0) break
        total += read
        if (total > maxBytes) {
          throw ReadDenied(
            "file_too_large",
            "The file exceeded the $maxBytes byte read limit.",
          )
        }
        output.write(chunk, 0, read)
      }

      return output.toByteArray()
    }
  }

  /** Matches the Rust core's FNV-1a64 so host and native audit hashes agree. */
  private fun fnv1a64(value: String): String {
    var hash = 0xCBF29CE484222325uL
    for (byte in value.toByteArray(Charsets.UTF_8)) {
      hash = (hash xor byte.toUByte().toULong()) * 0x100000001B3uL
    }
    return "%016x".format(hash.toLong())
  }

  private class ReadDenied(val code: String, message: String) : Exception(message)
}
