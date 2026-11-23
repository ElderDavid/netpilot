package app.netpilot.android.core

/**
 * Regla del proyecto: en la UI solo se muestra el prefijo OUI de una MAC/BSSID.
 * La app nunca lee el campo `mac` completo del agente; esto es una segunda barrera para
 * BSSID (que el agente entrega completos en /api/wifi).
 */
object Mask {
    private val hex = Regex("^[0-9A-Fa-f]{2}$")

    fun mac(value: String?): String? {
        if (value.isNullOrBlank()) return null
        val parts = value.trim().split(':', '-')
        if (parts.size < 3 || !parts.take(3).all { hex.matches(it) }) return null
        return parts.take(3).joinToString(":") { it.uppercase() } + ":··:··:··"
    }
}
