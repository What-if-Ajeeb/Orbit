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
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

private const val CALL_TIMEOUT_MS = 15_000L

/**
 * Expo Modules API bridge. Kotlin only manages binding, message correlation,
 * and lifecycle. Validation, policy, storage semantics, and program execution
 * live in Rust inside the isolated service process.
 */
class OrbitMobileSandboxModule : Module() {
  private val pendingCalls = ConcurrentHashMap<String, Promise>()
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
      enqueue("describe", JSONObject(), promise)
    }

    AsyncFunction("validateManifest") { manifestJson: String, promise: Promise ->
      val manifest = parseObject(manifestJson, promise) ?: return@AsyncFunction
      enqueue("validateManifest", JSONObject().put("manifest", manifest), promise)
    }

    AsyncFunction("execute") { requestJson: String, promise: Promise ->
      val params = parseObject(requestJson, promise) ?: return@AsyncFunction
      enqueue("executeProgram", params, promise)
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

  private fun enqueue(method: String, params: JSONObject, promise: Promise) {
    val id = "rn-${sequence.incrementAndGet()}"
    val envelope = JSONObject()
      .put("id", id)
      .put("method", method)
      .put("params", params)
      .toString()

    pendingCalls[id] = promise
    val timeout = Runnable {
      reject(id, promise, "SANDBOX_TIMEOUT", "Sandbox service did not respond in time.")
    }
    timeouts[id] = timeout
    replyHandler.postDelayed(timeout, CALL_TIMEOUT_MS)

    sendOrQueue(id, envelope, promise)
  }

  private fun sendOrQueue(id: String, envelope: String, promise: Promise) {
    val current = messenger
    if (current != null) {
      send(current, id, envelope, promise)
      return
    }

    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      reject(id, promise, "SANDBOX_UNAVAILABLE", "No Android context is available.")
      return
    }

    synchronized(waiters) {
      val bound = messenger
      if (bound != null) {
        send(bound, id, envelope, promise)
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
          send(service, id, envelope, promise)
        }
      }
    }
  }

  private fun send(service: Messenger, id: String, envelope: String, promise: Promise) {
    val message = Message.obtain(null, SandboxProtocol.MESSAGE_CALL).apply {
      data.putString(SandboxProtocol.KEY_REQUEST, envelope)
      replyTo = replyMessenger
    }
    try {
      service.send(message)
    } catch (error: Exception) {
      reject(id, promise, "SANDBOX_SEND_FAILED", error.message ?: "Unable to send sandbox request")
    }
  }

  private fun handleReply(message: Message) {
    val response = message.data?.getString(SandboxProtocol.KEY_RESPONSE) ?: return
    val id = runCatching { JSONObject(response).optString("id") }.getOrDefault("")
    val promise = pendingCalls.remove(id) ?: return
    timeouts.remove(id)?.let(replyHandler::removeCallbacks)
    promise.resolve(response)
  }

  private fun reject(id: String, promise: Promise, code: String, message: String) {
    pendingCalls.remove(id)
    timeouts.remove(id)?.let(replyHandler::removeCallbacks)
    promise.reject(code, message, null)
  }

  private fun rejectAll(code: String, message: String) {
    for (id in pendingCalls.keys().toList()) {
      pendingCalls.remove(id)?.let { promise ->
        timeouts.remove(id)?.let(replyHandler::removeCallbacks)
        promise.reject(code, message, null)
      }
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
}
