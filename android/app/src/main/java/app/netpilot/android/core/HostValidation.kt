package app.netpilot.android.core

/**
 * Valida a qué agente se puede conectar la app. El agente solo atiende peticiones desde rangos
 * privados (agent/net.mjs `isPrivateIp`), así que la app aplica el mismo criterio del lado
 * cliente: no tiene sentido (ni es seguro) enviar tráfico HTTP sin cifrar a una IP pública.
 */
object HostValidation {
    const val DEFAULT_PORT = 8787

    sealed interface Result {
        data class Ok(val host: String, val port: Int) : Result
        data class Invalid(val message: String) : Result
    }

    fun validate(hostInput: String, portInput: String): Result {
        val host = hostInput.trim().removePrefix("http://").trimEnd('/')
        if (host.isEmpty()) return Result.Invalid("Escribe la IP del equipo donde corre el agente.")
        if (host.contains('/') || host.contains('@') || host.contains(' ')) {
            return Result.Invalid("Escribe solo la IP o el nombre, sin rutas ni espacios.")
        }
        val port = portInput.trim().ifEmpty { DEFAULT_PORT.toString() }.toIntOrNull()
            ?: return Result.Invalid("El puerto debe ser un número.")
        if (port !in 1..65535) return Result.Invalid("El puerto debe estar entre 1 y 65535.")

        return when {
            isIpv4Literal(host) ->
                if (isPrivateIpv4(host)) Result.Ok(host, port)
                else Result.Invalid("Solo se permiten IP privadas (10.x, 172.16–31.x, 192.168.x, 169.254.x o 127.x).")
            host.equals("localhost", ignoreCase = true) -> Result.Ok("127.0.0.1", port)
            host.endsWith(".local", ignoreCase = true) && host.length > 6 && isHostnameSyntax(host) ->
                Result.Ok(host.lowercase(), port) // se resuelve y se vuelve a validar al conectar
            else -> Result.Invalid("Usa una IP privada (p. ej. 192.168.1.20) o un nombre .local.")
        }
    }

    fun isIpv4Literal(s: String): Boolean {
        val parts = s.split('.')
        if (parts.size != 4) return false
        return parts.all { p -> p.isNotEmpty() && p.length <= 3 && p.all(Char::isDigit) && p.toInt() in 0..255 }
    }

    /** Mismo criterio que `isPrivateIp` del agente. */
    fun isPrivateIpv4(ip: String): Boolean {
        if (!isIpv4Literal(ip)) return false
        val (a, b) = ip.split('.').map(String::toInt)
        return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b in 16..31) || (a == 169 && b == 254)
    }

    private fun isHostnameSyntax(s: String): Boolean =
        s.length <= 253 && s.split('.').all { label ->
            label.isNotEmpty() && label.length <= 63 &&
                label.all { it.isLetterOrDigit() || it == '-' } &&
                !label.startsWith('-') && !label.endsWith('-')
        }
}
