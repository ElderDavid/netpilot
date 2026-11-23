package app.netpilot.android.core

/*
 * Modelos de lo que la app MUESTRA. Se llenan desde el JSON del agente (ver Parse.kt) y
 * reflejan los campos reales de agent/index.mjs, store.mjs, router.mjs, speed.mjs y wifi.mjs.
 * El campo `mac` completo del agente se ignora a propósito: solo se usa `macMasked`.
 */

data class AgentInfo(
    val version: String?,
    val hostname: String?,
    val platform: String?,
    val node: String?,
)

data class NetworkInfo(
    val iface: String?,
    val ip: String?,
    val subnet: String?,
    val gateway: String?,
    val gatewayMacMasked: String?,
    val gatewayVendor: String?,
)

data class Device(
    val id: String,
    val ip: String,
    val ips: List<String>,
    val macMasked: String?,
    val name: String?,
    val hostname: String?,
    val vendor: String?,
    val type: String,
    val typeLabel: String,
    /** "high" | "medium" | "low" (según discovery.mjs). */
    val confidence: String,
    /** Evidencia de la identificación (texto del agente). */
    val reasons: List<String>,
    /** Cómo se detectó: icmp, arp, ssdp… */
    val method: List<String>,
    val ttl: Int?,
    val rttMs: Double?,
    val online: Boolean,
    val isGateway: Boolean,
    val ssdpName: String?,
    val firstSeen: String?,
    val lastSeen: String?,
) {
    val displayName: String get() = name ?: hostname ?: ssdpName ?: ip
}

data class Alert(val id: String, val at: String?, val title: String, val detail: String?, val ack: Boolean)

data class WifiLink(
    val connected: Boolean,
    val ssid: String?,
    val bssidMasked: String?,
    val band: String?,
    val channel: Int?,
    val radio: String?,
    val auth: String?,
    val rxMbps: Double?,
    val txMbps: Double?,
    val signalPct: Int?,
    val rssi: Int?,
)

data class WifiNeighbor(
    val ssid: String,
    val bssidMasked: String?,
    val band: String?,
    val channel: Int?,
    val signalPct: Int?,
    val radio: String?,
    val auth: String?,
)

data class WifiRecommendation(val reason: String?, val note: String?, val shouldChange: Boolean)

data class AgentWifi(
    val at: String?,
    val link: WifiLink?,
    val networks: List<WifiNeighbor>,
    val recommendation: WifiRecommendation?,
)

data class LatencyStats(
    val target: String?,
    val p50: Double?,
    val p95: Double?,
    val jitter: Double?,
    val lossPct: Double?,
)

data class LatencyResult(val at: String?, val gateway: LatencyStats?, val internet: LatencyStats?)

data class DnsResult(val at: String?, val systemP50: Double?, val publicP50: Double?, val systemLabel: String?, val publicLabel: String?)

data class SpeedResult(
    val at: String?,
    val server: String?,
    val downloadMbps: Double?,
    val uploadMbps: Double?,
    val idleLatency: Double?,
    val loadedLatency: Double?,
    val bufferbloatMs: Double?,
)

data class Tests(val latency: List<LatencyResult>, val dns: List<DnsResult>, val speed: List<SpeedResult>)

/** Estado de una capacidad: supported, config_required, read_only, unavailable, unknown. */
data class Capability(val key: String, val label: String, val status: String, val evidence: String?)

data class OntInfo(val ip: String?, val ms: Double?, val manageable: Boolean, val note: String?)

data class RouterInfo(
    val gatewayIp: String?,
    val gatewayMacMasked: String?,
    val vendor: String?,
    val family: String?,
    val familyLabel: String?,
    val webReachable: Boolean,
    val webTitle: String?,
    val ont: OntInfo?,
    val capabilities: List<Capability>,
    val inspectedAt: String?,
)

data class AccessStatus(val connected: Boolean, val label: String?)

data class Bootstrap(
    val agent: AgentInfo,
    val network: NetworkInfo?,
    val devices: List<Device>,
    val alerts: List<Alert>,
    val tests: Tests,
    val wifi: AgentWifi?,
    val router: RouterInfo?,
    val access: AccessStatus,
)

/** Trabajo asíncrono del agente (GET /api/jobs/:id). */
data class Job(
    val id: String,
    val type: String?,
    val label: String?,
    /** running | done | error */
    val status: String,
    val progress: Double,
    val message: String?,
    val error: String?,
)
