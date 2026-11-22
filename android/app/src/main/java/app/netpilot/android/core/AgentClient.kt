package app.netpilot.android.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException

class AgentException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Cliente HTTP mínimo del agente NetPilot (HttpURLConnection, sin librerías).
 * Todas las llamadas tienen timeout y los errores llegan como [AgentException] con un mensaje
 * en español listo para mostrar. No envía credenciales: la API de lectura no las necesita y la
 * conexión administrativa al router (POST /api/router/connect) no se usa desde Android.
 */
class AgentClient(
    val host: String,
    val port: Int,
    private val connectTimeoutMs: Int = 4_000,
) {
    val baseUrl: String = "http://$host:$port"

    suspend fun bootstrap(): Bootstrap =
        parsing { Parse.bootstrap(request("GET", "/api/bootstrap", readTimeoutMs = 15_000)) }

    /** El agente cachea 30 s; con [refresh] vuelve a leer `netsh` en el PC. */
    suspend fun wifi(refresh: Boolean): AgentWifi =
        parsing { Parse.wifi(JSONObject(request("GET", if (refresh) "/api/wifi?refresh=1" else "/api/wifi", readTimeoutMs = 30_000))) }

    /** Con [refresh] el agente hace traceroute y sondas: puede tardar decenas de segundos. */
    suspend fun router(refresh: Boolean): RouterInfo? = parsing {
        val text = request("GET", if (refresh) "/api/router?refresh=1" else "/api/router", readTimeoutMs = 90_000)
        if (text.trim() == "null") null else Parse.router(JSONObject(text))
    }

    suspend fun startScan(): Job? = parsing { Parse.scanStart(request("POST", "/api/scan", readTimeoutMs = 10_000)) }

    /** [kind]: latency | dns | speed. */
    suspend fun startTest(kind: String): Job {
        require(kind in setOf("latency", "dns", "speed")) { "Prueba desconocida: $kind" }
        return parsing { Parse.job(request("POST", "/api/tests/$kind", readTimeoutMs = 10_000)) }
    }

    suspend fun job(id: String): Job =
        parsing { Parse.job(request("GET", "/api/jobs/$id", readTimeoutMs = 8_000)) }

    private inline fun <T> parsing(block: () -> T): T = try {
        block()
    } catch (e: JSONException) {
        throw AgentException("La respuesta no parece de un agente NetPilot (JSON inválido).", e)
    }

    private suspend fun request(method: String, path: String, readTimeoutMs: Int): String = withContext(Dispatchers.IO) {
        checkResolvesToPrivate()
        val conn = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = connectTimeoutMs
            readTimeout = readTimeoutMs
            instanceFollowRedirects = false
            useCaches = false
            setRequestProperty("Accept", "application/json")
            if (method == "POST") {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (method == "POST") conn.outputStream.use { it.write("{}".toByteArray()) }
            val code = conn.responseCode
            val body = (if (code < 400) conn.inputStream else conn.errorStream)?.let { readCapped(it) } ?: ""
            if (code !in 200..299) {
                val msg = Parse.errorMessage(body)
                throw AgentException(
                    when {
                        msg != null -> "$msg (HTTP $code)"
                        code == 403 -> "El agente rechazó la conexión (HTTP 403). ¿Estás en la misma red local?"
                        else -> "El agente respondió HTTP $code."
                    },
                )
            }
            body
        } catch (e: AgentException) {
            throw e
        } catch (e: SocketTimeoutException) {
            throw AgentException("Sin respuesta de $host:$port a tiempo. ¿El agente está encendido y en la misma red?", e)
        } catch (e: ConnectException) {
            throw AgentException("No se pudo conectar con $host:$port (rechazada o inalcanzable). Revisa la IP, el puerto, que el agente esté encendido y el firewall del PC.", e)
        } catch (e: NoRouteToHostException) {
            throw AgentException("No hay ruta hacia $host. ¿El teléfono está en la misma Wi-Fi que el PC?", e)
        } catch (e: IOException) {
            throw AgentException("Error de red con el agente: ${e.message ?: e.javaClass.simpleName}", e)
        } finally {
            conn.disconnect()
        }
    }

    /** Segunda barrera: aunque el nombre sea .local, solo se habla con direcciones privadas. */
    private fun checkResolvesToPrivate() {
        val addrs = try {
            InetAddress.getAllByName(host)
        } catch (e: UnknownHostException) {
            throw AgentException("No se pudo resolver \"$host\". Android no siempre resuelve nombres .local: usa la IP del PC.", e)
        }
        val v4 = addrs.filterIsInstance<Inet4Address>().firstOrNull()
            ?: throw AgentException("\"$host\" no tiene dirección IPv4; el agente solo atiende IPv4.")
        if (!HostValidation.isPrivateIpv4(v4.hostAddress ?: "")) {
            throw AgentException("\"$host\" resuelve a una dirección pública; por seguridad no se conecta.")
        }
    }

    private fun readCapped(stream: InputStream): String = stream.use { s ->
        val bytes = s.readNBytesCompat(MAX_BODY_BYTES + 1)
        if (bytes.size > MAX_BODY_BYTES) throw AgentException("Respuesta demasiado grande del agente.")
        String(bytes, Charsets.UTF_8)
    }

    companion object {
        private const val MAX_BODY_BYTES = 16 * 1024 * 1024
    }
}

/** `InputStream.readNBytes` llegó en Android 13 (API 33); minSdk es 26. */
internal fun InputStream.readNBytesCompat(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(16 * 1024)
    var total = 0
    while (total < limit) {
        val n = read(buf, 0, minOf(buf.size, limit - total))
        if (n < 0) break
        out.write(buf, 0, n)
        total += n
    }
    return out.toByteArray()
}
