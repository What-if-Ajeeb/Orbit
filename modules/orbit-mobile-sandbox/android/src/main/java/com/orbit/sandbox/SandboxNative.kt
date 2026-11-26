package com.orbit.sandbox

import org.json.JSONObject

/**
 * Thin JNI boundary. Kotlin does not implement any policy; every validation and
 * authorization decision is made by the data-only Rust core. If the native
 * library is unavailable, requests fail closed with a structured response.
 */
object SandboxNative {
  private val loadError: String? = try {
    System.loadLibrary("orbit_sandbox_core")
    null
  } catch (error: Throwable) {
    error.message ?: error.javaClass.simpleName
  }

  fun dispatch(request: String): String {
    val error = loadError
    if (error != null) {
      val id = runCatching { JSONObject(request).optString("id") }.getOrDefault("")
      return JSONObject()
        .put("id", id)
        .put("ok", false)
        .put("result", JSONObject.NULL)
        .put(
          "error",
          JSONObject()
            .put("code", "native_core_unavailable")
            .put("message", "Sandbox native core is unavailable: $error"),
        )
        .toString()
    }

    return try {
      nativeDispatch(request)
    } catch (error: Throwable) {
      val id = runCatching { JSONObject(request).optString("id") }.getOrDefault("")
      JSONObject()
        .put("id", id)
        .put("ok", false)
        .put("result", JSONObject.NULL)
        .put(
          "error",
          JSONObject()
            .put("code", "native_failure")
            .put("message", error.message ?: error.javaClass.simpleName),
        )
        .toString()
    }
  }

  @JvmStatic
  private external fun nativeDispatch(request: String): String
}
