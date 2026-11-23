package app.netpilot.android.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Convierte el JSON del agente en modelos. Tolerante: un campo ausente o `null` da `null`,
 * nunca un valor inventado. Nunca se lee `mac` (MAC completa) ni `system.interfaces`.
 */
object Parse {

    fun bootstrap(text: String): Bootstrap {
        val o = JSONObject(text)
        val system = o.optJSONObject("system")
        val state = o.optJSONObject("state") ?: JSONObject()
        return Bootstrap(
            agent = AgentInfo(
                version = o.str("version"),
                hostname = system?.str("hostname"),
                platform = system?.str("platform"),
                node = system?.str("node"),
            ),
            network = o.optJSONObject("network")?.let { network(it) },
            devices = state.optJSONArray("devices").objects().mapNotNull { device(it) },
            alerts = state.optJSONArray("alerts").objects().map { alert(it) },
            tests = tests(state.optJSONObject("tests")),
            wifi = state.optJSONObject("wifi")?.let { wifi(it) },
            router = state.optJSONObject("router")?.let { router(it) },
            access = o.optJSONObject("access").let { a ->
                AccessStatus(connected = a?.optBoolean("connected", false) ?: false, label = a?.str("label"))
            },
        )
    }

    fun network(o: JSONObject) = NetworkInfo(
        iface = o.str("iface"),
        ip = o.str("ip"),
        subnet = o.str("subnet"),
        gateway = o.str("gateway"),
        gatewayMacMasked = o.str("gatewayMacMasked"),
        gatewayVendor = o.str("gatewayVendor"),
    )

    fun device(o: JSONObject): Device? {
        val id = o.str("id") ?: return null
        val ip = o.str("ip") ?: return null
        return Device(
            id = id,
            ip = ip,
            ips = o.optJSONArray("ips").strings(),
            macMasked = o.str("macMasked"),
            name = o.str("name"),
            hostname = o.str("hostname"),
            vendor = o.str("vendor"),
            type = o.str("type") ?: "unknown",
            typeLabel = o.str("typeLabel") ?: "Desconocido",
            confidence = o.str("confidence") ?: "low",
            reasons = o.optJSONArray("reasons").strings(),
            method = o.optJSONArray("method").strings(),
            ttl = o.int("ttl"),
            rttMs = o.num("rttMs"),
            online = o.optBoolean("online", false),
            isGateway = o.optBoolean("isGateway", false),
            ssdpName = o.optJSONObject("ssdp")?.str("friendlyName"),
            firstSeen = o.str("firstSeen"),
            lastSeen = o.str("lastSeen"),
        )
    }

    fun alert(o: JSONObject) = Alert(
        id = o.str("id") ?: "",
        at = o.str("at"),
        title = o.str("title") ?: "Alerta",
        detail = o.str("detail"),
        ack = o.optBoolean("ack", false),
    )

    fun wifi(o: JSONObject): AgentWifi {
        val link = o.optJSONObject("link")?.let { l ->
            WifiLink(
                connected = l.optBoolean("connected", false),
                ssid = l.str("ssid"),
                bssidMasked = Mask.mac(l.str("bssid")),
                band = l.str("band"),
                channel = l.int("channel"),
                radio = l.str("radio"),
                auth = l.str("auth"),
                rxMbps = l.num("rxMbps"),
                txMbps = l.num("txMbps"),
                signalPct = l.int("signalPct"),
                rssi = l.int("rssi"),
            )
        }
        val nets = o.optJSONArray("networks").objects().map { n ->
            WifiNeighbor(
                ssid = n.str("ssid") ?: "(oculta)",
                bssidMasked = Mask.mac(n.str("bssid")),
                band = n.str("band"),
                channel = n.int("channel"),
                signalPct = n.int("signalPct"),
                radio = n.str("radio"),
                auth = n.str("auth"),
            )
        }
        val rec = o.optJSONObject("recommendation")?.let { r ->
            WifiRecommendation(reason = r.str("reason"), note = r.str("note"), shouldChange = r.optBoolean("shouldChange", false))
        }
        return AgentWifi(at = o.str("at"), link = link, networks = nets, recommendation = rec)
    }

    fun tests(o: JSONObject?): Tests {
        if (o == null) return Tests(emptyList(), emptyList(), emptyList())
        return Tests(
            latency = o.optJSONArray("latency").objects().map { latency(it) },
            dns = o.optJSONArray("dns").objects().map { d ->
                val sys = d.optJSONObject("system")
                val pub = d.optJSONObject("public")
                DnsResult(d.str("at"), sys?.num("p50"), pub?.num("p50"), sys?.str("label"), pub?.str("label"))
            },
            speed = o.optJSONArray("speed").objects().map { s ->
                SpeedResult(
                    at = s.str("at"),
                    server = s.str("server"),
                    downloadMbps = s.num("downloadMbps"),
                    uploadMbps = s.num("uploadMbps"),
                    idleLatency = s.num("idleLatency"),
                    loadedLatency = s.num("loadedLatency"),
                    bufferbloatMs = s.num("bufferbloatMs"),
                )
            },
        )
    }

    fun latency(o: JSONObject) = LatencyResult(
        at = o.str("at"),
        gateway = o.optJSONObject("gateway")?.let { latencyStats(it) },
        internet = o.optJSONObject("internet")?.let { latencyStats(it) },
    )

    private fun latencyStats(o: JSONObject) = LatencyStats(
        target = o.str("target"),
        p50 = o.num("p50"),
        p95 = o.num("p95"),
        jitter = o.num("jitter"),
        lossPct = o.num("lossPct"),
    )

    fun router(o: JSONObject): RouterInfo {
        val gw = o.optJSONObject("gateway")
        val web = gw?.optJSONObject("web")
        val ont = o.optJSONObject("ont")?.let { n ->
            OntInfo(ip = n.str("ip"), ms = n.num("ms"), manageable = n.optBoolean("manageable", false), note = n.str("note"))
        }
        return RouterInfo(
            gatewayIp = gw?.str("ip"),
            gatewayMacMasked = gw?.str("macMasked"),
            vendor = gw?.str("vendor"),
            family = gw?.str("family"),
            familyLabel = gw?.str("familyLabel"),
            webReachable = web?.optBoolean("reachable", false) ?: false,
            webTitle = web?.str("title"),
            ont = ont,
            capabilities = o.optJSONArray("capabilities").objects().map { c ->
                Capability(
                    key = c.str("key") ?: "",
                    label = c.str("label") ?: c.str("key") ?: "",
                    status = c.str("status") ?: "unknown",
                    evidence = c.str("evidence"),
                )
            },
            inspectedAt = o.str("inspectedAt"),
        )
    }

    fun job(text: String): Job = job(JSONObject(text))

    fun job(o: JSONObject) = Job(
        id = o.str("id") ?: "",
        type = o.str("type"),
        label = o.str("label"),
        status = o.str("status") ?: "running",
        progress = o.num("progress") ?: 0.0,
        message = o.str("message"),
        error = o.str("error"),
    )

    /** Respuesta de POST /api/scan: `{ job: {...} | null, already?: true }`. */
    fun scanStart(text: String): Job? = JSONObject(text).optJSONObject("job")?.let { job(it) }

    /** Mensaje `error` de una respuesta de error del agente, si lo hay. */
    fun errorMessage(text: String): String? = runCatching { JSONObject(text).str("error") }.getOrNull()

    // --- utilidades -----------------------------------------------------------------------------

    internal fun JSONObject.str(k: String): String? =
        if (isNull(k)) null else opt(k)?.toString()?.takeIf { it.isNotEmpty() }

    internal fun JSONObject.num(k: String): Double? =
        if (isNull(k)) null else (opt(k) as? Number)?.toDouble()?.takeIf { it.isFinite() }

    internal fun JSONObject.int(k: String): Int? = num(k)?.toInt()

    internal fun JSONArray?.objects(): List<JSONObject> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { optJSONObject(it) }
    }

    internal fun JSONArray?.strings(): List<String> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { i -> if (isNull(i)) null else opt(i)?.toString() }
    }
}
