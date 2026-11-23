package app.netpilot.android.core

import android.content.Context

/**
 * Preferencias locales. Solo guarda la última IP y puerto del agente para no reescribirlos.
 * Nunca guarda credenciales (la app no las pide).
 */
class Settings(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("netpilot", Context.MODE_PRIVATE)

    var lastHost: String
        get() = prefs.getString(KEY_HOST, "") ?: ""
        set(value) = prefs.edit().putString(KEY_HOST, value).apply()

    var lastPort: Int
        get() = prefs.getInt(KEY_PORT, HostValidation.DEFAULT_PORT)
        set(value) = prefs.edit().putInt(KEY_PORT, value).apply()

    private companion object {
        const val KEY_HOST = "last_host"
        const val KEY_PORT = "last_port"
    }
}
