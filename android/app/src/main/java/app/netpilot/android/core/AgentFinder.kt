package app.netpilot.android.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

/**
 * Busca agentes NetPilot en la /24 del teléfono probando el puerto indicado.
 *
 * Por qué no mDNS: el agente hoy no anuncia ningún servicio mDNS/DNS-SD (no hay
 * `_netpilot._tcp`), así que NsdManager no encontraría nada. Cuando el agente lo anuncie,
 * se puede añadir NsdManager aquí. Mientras tanto: conexión TCP a <red>.1–254:<puerto> y
 * confirmación leyendo /manifest.webmanifest (debe contener "NetPilot").
 * Se ejecuta solo cuando el usuario lo pide.
 */
object AgentFinder {
    data class Found(val host: String, val port: Int)

    suspend fun scan(
        phoneIp: String,
        port: Int = HostValidation.DEFAULT_PORT,
        onProgress: (done: Int, total: Int) -> Unit = { _, _ -> },
    ): List<Found> = withContext(Dispatchers.IO) {
        require(HostValidation.isPrivateIpv4(phoneIp)) { "El teléfono no tiene una IP privada" }
        val base = phoneIp.substringBeforeLast('.')
        val hosts = (1..254).map { "$base.$it" }
        val done = AtomicInteger(0)
        val gate = Semaphore(32)
        coroutineScope {
            hosts.map { host ->
                async {
                    gate.withPermit {
                        val hit = if (portOpen(host, port) && looksLikeNetPilot(host, port)) Found(host, port) else null
                        onProgress(done.incrementAndGet(), hosts.size)
                        hit
                    }
                }
            }.awaitAll().filterNotNull()
        }
    }

    private fun portOpen(host: String, port: Int): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(host, port), 400) }
        true
    } catch (e: IOException) {
        false
    }

    private fun looksLikeNetPilot(host: String, port: Int): Boolean = try {
        val conn = URL("http://$host:$port/manifest.webmanifest").openConnection() as HttpURLConnection
        conn.connectTimeout = 1_000
        conn.readTimeout = 1_500
        conn.instanceFollowRedirects = false
        try {
            conn.responseCode == 200 &&
                String(conn.inputStream.use { it.readNBytesCompat(64 * 1024) }, Charsets.UTF_8).contains("NetPilot")
        } finally {
            conn.disconnect()
        }
    } catch (e: IOException) {
        false
    }
}
