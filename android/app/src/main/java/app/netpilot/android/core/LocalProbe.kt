package app.netpilot.android.core

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL

/** Red actual del teléfono según ConnectivityManager. */
data class PhoneNetwork(
    val onWifi: Boolean,
    val ipv4: String?,
    val prefix: Int?,
    val gateway: String?,
    val dns: List<String>,
)

/** Conexión Wi-Fi del teléfono según WifiManager. */
data class PhoneWifi(
    /** null si Android lo oculta (sin permiso de ubicación o con la ubicación apagada). */
    val ssid: String?,
    val bssidMasked: String?,
    val rssi: Int?,
    val linkMbps: Int?,
    val frequencyMhz: Int?,
    val band: String?,
    val channel: Int?,
)

data class PhoneScanResult(
    val ssid: String,
    val bssidMasked: String?,
    val rssi: Int,
    val frequencyMhz: Int,
    val band: String?,
    val channel: Int?,
)

data class LocalLatency(
    val target: String,
    val method: String,
    val summary: Summary,
    val note: String?,
)

/**
 * Lo que la app puede medir SIN agente, usando solo APIs públicas de Android.
 * Lo que Android no permite (tabla ARP desde Android 10, inventario de la LAN, canal de otros
 * equipos, administración del router) no se simula: la UI lo declara no disponible.
 */
class LocalProbe(context: Context) {
    private val app = context.applicationContext
    private val wifiManager = app.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val connectivity = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun isLocationEnabled(): Boolean {
        val lm = app.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return LocationManagerCompat.isLocationEnabled(lm)
    }

    fun isWifiEnabled(): Boolean = wifiManager.isWifiEnabled

    fun network(): PhoneNetwork? {
        val active = connectivity.activeNetwork ?: return null
        val caps = connectivity.getNetworkCapabilities(active)
        val lp = connectivity.getLinkProperties(active) ?: return null
        val v4 = lp.linkAddresses.firstOrNull { it.address is Inet4Address }
        val gw = lp.routes.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.hostAddress
        return PhoneNetwork(
            onWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true,
            ipv4 = v4?.address?.hostAddress,
            prefix = v4?.prefixLength,
            gateway = gw,
            dns = lp.dnsServers.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress },
        )
    }

    @Suppress("DEPRECATION") // WifiManager.connectionInfo: sigue funcionando hasta API 35 para la red propia.
    fun wifi(): PhoneWifi? {
        if (!wifiManager.isWifiEnabled) return null
        val info = wifiManager.connectionInfo ?: return null
        if (info.networkId == -1 && info.rssi <= -127) return null
        val rawSsid = info.ssid?.trim('"')
        val ssid = rawSsid?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }
        val freq = info.frequency.takeIf { it > 0 }
        return PhoneWifi(
            ssid = ssid,
            // Sin permiso, Android devuelve un BSSID de relleno (prefijo 02:00:00 y ceros): se descarta.
            bssidMasked = Mask.mac(info.bssid)?.takeIf { it != REDACTED_BSSID_MASKED },
            rssi = info.rssi.takeIf { it > -127 && it < 0 },
            linkMbps = info.linkSpeed.takeIf { it > 0 },
            frequencyMhz = freq,
            band = freq?.let { WifiFreq.band(it) },
            channel = freq?.let { WifiFreq.channel(it) },
        )
    }

    /**
     * Pide un escaneo. Android limita a 4 escaneos cada 2 minutos por app en primer plano;
     * si lo rechaza, devuelve false y se usan los últimos resultados del sistema.
     */
    @Suppress("DEPRECATION")
    fun requestScan(): Boolean = try {
        wifiManager.startScan()
    } catch (e: SecurityException) {
        false
    }

    @Suppress("DEPRECATION") // ScanResult.SSID/BSSID: reemplazos solo desde API 33.
    fun scanResults(): List<PhoneScanResult> {
        val results = try {
            wifiManager.scanResults
        } catch (e: SecurityException) {
            return emptyList()
        } ?: return emptyList()
        return results.map { r ->
            PhoneScanResult(
                ssid = r.SSID?.takeIf { it.isNotBlank() } ?: "(oculta)",
                bssidMasked = Mask.mac(r.BSSID),
                rssi = r.level,
                frequencyMhz = r.frequency,
                band = WifiFreq.band(r.frequency),
                channel = WifiFreq.channel(r.frequency),
            )
        }.sortedByDescending { it.rssi }
    }

    /**
     * Latencia por conexión TCP. Cuenta como respuesta tanto el SYN-ACK como el rechazo (RST):
     * ambos implican un viaje de ida y vuelta. Sin respuesta dentro del timeout = perdida.
     * No es ICMP (Android no permite ping sin privilegios de forma fiable).
     */
    suspend fun tcpLatency(host: String, port: Int, count: Int = 10, timeoutMs: Int = 1_000): LocalLatency =
        withContext(Dispatchers.IO) {
            var refused = 0
            val samples = (1..count).map {
                val t0 = System.nanoTime()
                val ms: Double? = try {
                    Socket().use { s -> s.connect(InetSocketAddress(host, port), timeoutMs) }
                    (System.nanoTime() - t0) / 1e6
                } catch (e: ConnectException) {
                    val dt = (System.nanoTime() - t0) / 1e6
                    if (dt < timeoutMs) { refused++; dt } else null
                } catch (e: SocketTimeoutException) {
                    null
                } catch (e: IOException) {
                    null
                }
                Thread.sleep(100)
                ms
            }
            LocalLatency(
                target = "$host:$port",
                method = "TCP",
                summary = Stats.summarize(samples),
                note = if (refused > 0) "$refused de $count respuestas fueron rechazos del puerto (también cuentan como ida y vuelta)." else null,
            )
        }

    /**
     * Latencia HTTPS a un endpoint 204 público. La primera muestra incluye DNS y TLS.
     * Contacta un servidor externo: solo se ejecuta cuando el usuario lo pide.
     */
    suspend fun httpsLatency(url: String = HTTPS_PROBE_URL, count: Int = 5, timeoutMs: Int = 5_000): LocalLatency =
        withContext(Dispatchers.IO) {
            val samples = (1..count).map {
                val t0 = System.nanoTime()
                val ms: Double? = try {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = timeoutMs
                    conn.readTimeout = timeoutMs
                    conn.useCaches = false
                    conn.instanceFollowRedirects = false
                    try {
                        val code = conn.responseCode
                        if (code in 200..399) (System.nanoTime() - t0) / 1e6 else null
                    } finally {
                        conn.disconnect()
                    }
                } catch (e: IOException) {
                    null
                }
                Thread.sleep(200)
                ms
            }
            LocalLatency(
                target = URL(url).host,
                method = "HTTPS",
                summary = Stats.summarize(samples),
                note = "Incluye DNS y TLS en la primera muestra; mide hasta Internet, no solo la Wi-Fi.",
            )
        }

    companion object {
        const val HTTPS_PROBE_URL = "https://www.gstatic.com/generate_204"
        private const val REDACTED_BSSID_MASKED = "02:00:00:··:··:··"
    }
}
