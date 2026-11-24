package com.orbit.sandbox

import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import org.json.JSONObject

/**
 * Android isolated-process service. It has no Android permissions of its own;
 * the only entry point is the Messenger/Binder Service API. All plugin policy
 * and execution is delegated to the Rust core.
 */
class OrbitSandboxService : Service() {
  private val inbox = Handler(Looper.getMainLooper()) { message ->
    handleMessage(message)
    true
  }
  private val messenger = Messenger(inbox)

  override fun onBind(intent: Intent?): IBinder = messenger.binder

  private fun handleMessage(message: Message) {
    val replyTo = message.replyTo ?: return
    val request = message.data?.getString(SandboxProtocol.KEY_REQUEST)
    val response = if (request == null) {
      errorResponse("", "missing_request", "Sandbox request is missing.")
    } else {
      runCatching { SandboxNative.dispatch(request) }
        .getOrElse { error -> errorResponse(requestId(request), "native_failure", error.message ?: "Native failure") }
    }

    val reply = Message.obtain(null, SandboxProtocol.MESSAGE_RESPONSE).apply {
      data.putString(SandboxProtocol.KEY_RESPONSE, response)
    }
    replyTo.send(reply)
  }

  private fun requestId(request: String): String =
    runCatching { JSONObject(request).optString("id") }.getOrDefault("")

  private fun errorResponse(id: String, code: String, message: String): String =
    JSONObject()
      .put("id", id)
      .put("ok", false)
      .put("result", JSONObject.NULL)
      .put("error", JSONObject().put("code", code).put("message", message))
      .toString()
}
