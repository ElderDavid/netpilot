package app.netpilot.android.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.netpilot.android.core.AgentClient
import app.netpilot.android.core.AgentException
import app.netpilot.android.core.AgentFinder
import app.netpilot.android.core.Bootstrap
import app.netpilot.android.core.HostValidation
import app.netpilot.android.core.Job
import app.netpilot.android.core.LocalLatency
import app.netpilot.android.core.LocalProbe
import app.netpilot.android.core.PhoneNetwork
import app.netpilot.android.core.PhoneScanResult
import app.netpilot.android.core.PhoneWifi
import app.netpilot.android.core.Settings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface Connection {
    data object Offline : Connection
    data class Connecting(val host: String, val port: Int) : Connection
    data class Connected(val host: String, val port: Int) : Connection
    data class Failed(val host: String, val port: Int, val message: String) : Connection
}

sealed interface FinderState {
    data object Idle : FinderState
    data class Searching(val done: Int, val total: Int) : FinderState
    data class Done(val found: List<AgentFinder.Found>) : FinderState
    data class Error(val message: String) : FinderState
}

data class LocalState(
    val network: PhoneNetwork? = null,
    val wifi: PhoneWifi? = null,
    val wifiEnabled: Boolean = false,
    val hasLocationPermission: Boolean = false,
    val locationEnabled: Boolean = false,
    val scan: List<PhoneScanResult> = emptyList(),
    val scanNote: String? = null,
    val gatewayLatency: LocalLatency? = null,
    val internetLatency: LocalLatency? = null,
    val measuring: Boolean = false,
    val measureError: String? = null,
)

data class UiState(
    val connection: Connection = Connection.Offline,
    val lastHost: String = "",
    val lastPort: Int = HostValidation.DEFAULT_PORT,
    val boot: Bootstrap? = null,
    val updatedAtMillis: Long? = null,
    val refreshing: Boolean = false,
    val refreshError: String? = null,
    /** Trabajos del agente por tipo: scan, latency, dns, speed. */
    val jobs: Map<String, Job> = emptyMap(),
    val jobErrors: Map<String, String> = emptyMap(),
    val wifiRefreshing: Boolean = false,
    val routerRefreshing: Boolean = false,
    val finder: FinderState = FinderState.Idle,
    val local: LocalState = LocalState(),
) {
    val connected: Boolean get() = connection is Connection.Connected
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val settings = Settings(app)
    private val probe = LocalProbe(app)
    private var client: AgentClient? = null

    private val _state = MutableStateFlow(UiState(lastHost = settings.lastHost, lastPort = settings.lastPort))
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        refreshLocal()
    }

    // --- Conexión con el agente ---------------------------------------------------------------

    fun connect(hostInput: String, portInput: String) {
        when (val v = HostValidation.validate(hostInput, portInput)) {
            is HostValidation.Result.Invalid ->
                _state.update { it.copy(connection = Connection.Failed(hostInput.trim(), it.lastPort, v.message)) }
            is HostValidation.Result.Ok -> {
                val c = AgentClient(v.host, v.port)
                _state.update { it.copy(connection = Connection.Connecting(v.host, v.port)) }
                viewModelScope.launch {
                    try {
                        val boot = c.bootstrap()
                        client = c
                        settings.lastHost = v.host
                        settings.lastPort = v.port
                        _state.update {
                            it.copy(
                                connection = Connection.Connected(v.host, v.port),
                                lastHost = v.host,
                                lastPort = v.port,
                                boot = boot,
                                updatedAtMillis = System.currentTimeMillis(),
                                refreshError = null,
                                jobs = emptyMap(),
                                jobErrors = emptyMap(),
                            )
                        }
                    } catch (e: AgentException) {
                        _state.update { it.copy(connection = Connection.Failed(v.host, v.port, e.message ?: "Error")) }
                    }
                }
            }
        }
    }

    /** Pasar a modo sin agente (no borra la última IP guardada). */
    fun goOffline() {
        client = null
        _state.update { it.copy(connection = Connection.Offline, boot = null, jobs = emptyMap(), jobErrors = emptyMap(), refreshError = null) }
        refreshLocal()
    }

    fun refresh() {
        val c = client ?: return
        _state.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            try {
                val boot = c.bootstrap()
                _state.update { it.copy(boot = boot, updatedAtMillis = System.currentTimeMillis(), refreshError = null, refreshing = false) }
            } catch (e: AgentException) {
                // Se conservan los últimos datos, marcados como desactualizados en la UI.
                _state.update { it.copy(refreshError = e.message, refreshing = false) }
            }
        }
    }

    fun refreshAgentWifi() {
        val c = client ?: return
        _state.update { it.copy(wifiRefreshing = true) }
        viewModelScope.launch {
            try {
                val wifi = c.wifi(refresh = true)
                _state.update { s -> s.copy(boot = s.boot?.copy(wifi = wifi), wifiRefreshing = false, refreshError = null) }
            } catch (e: AgentException) {
                _state.update { it.copy(wifiRefreshing = false, refreshError = e.message) }
            }
        }
    }

    fun refreshRouter() {
        val c = client ?: return
        _state.update { it.copy(routerRefreshing = true) }
        viewModelScope.launch {
            try {
                val router = c.router(refresh = true)
                _state.update { s -> s.copy(boot = s.boot?.copy(router = router), routerRefreshing = false, refreshError = null) }
            } catch (e: AgentException) {
                _state.update { it.copy(routerRefreshing = false, refreshError = e.message) }
            }
        }
    }

    // --- Trabajos (escaneo y pruebas) ---------------------------------------------------------

    /** [kind]: scan | latency | dns | speed. */
    fun runJob(kind: String) {
        val c = client ?: return
        if (_state.value.jobs[kind]?.status == "running") return
        _state.update { it.copy(jobErrors = it.jobErrors - kind) }
        viewModelScope.launch {
            try {
                val started = if (kind == "scan") c.startScan() else c.startTest(kind)
                if (started == null) {
                    setJobError(kind, "El agente no devolvió el trabajo de escaneo.")
                    return@launch
                }
                _state.update { it.copy(jobs = it.jobs + (kind to started)) }
                pollJob(c, kind, started.id)
            } catch (e: AgentException) {
                setJobError(kind, e.message ?: "Error")
            }
        }
    }

    private suspend fun pollJob(c: AgentClient, kind: String, id: String) {
        val deadline = System.currentTimeMillis() + JOB_TIMEOUT_MS.getValue(kind)
        var failures = 0
        while (true) {
            delay(1_000)
            if (System.currentTimeMillis() > deadline) {
                setJobError(kind, "La prueba superó el tiempo máximo de espera. Puede seguir corriendo en el agente.")
                return
            }
            val job = try {
                c.job(id).also { failures = 0 }
            } catch (e: CancellationException) {
                throw e
            } catch (e: AgentException) {
                if (++failures >= 5) {
                    setJobError(kind, e.message ?: "Se perdió la conexión con el agente.")
                    return
                }
                continue
            }
            _state.update { it.copy(jobs = it.jobs + (kind to job)) }
            when (job.status) {
                "done" -> { refresh(); return }
                "error" -> { setJobError(kind, job.error ?: "El agente reportó un error."); return }
            }
        }
    }

    private fun setJobError(kind: String, message: String) {
        _state.update { it.copy(jobs = it.jobs - kind, jobErrors = it.jobErrors + (kind to message)) }
    }

    // --- Buscar agente en la red --------------------------------------------------------------

    fun findAgents(portInput: String) {
        val port = portInput.trim().toIntOrNull()?.takeIf { it in 1..65535 } ?: HostValidation.DEFAULT_PORT
        val ip = probe.network()?.ipv4
        if (ip == null || !HostValidation.isPrivateIpv4(ip)) {
            _state.update { it.copy(finder = FinderState.Error("El teléfono no está en una red local con IPv4 privada. Conéctate a la Wi-Fi del PC.")) }
            return
        }
        _state.update { it.copy(finder = FinderState.Searching(0, 254)) }
        viewModelScope.launch {
            try {
                val found = AgentFinder.scan(ip, port) { done, total ->
                    _state.update { it.copy(finder = FinderState.Searching(done, total)) }
                }
                _state.update { it.copy(finder = FinderState.Done(found)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(finder = FinderState.Error(e.message ?: "Error al buscar")) }
            }
        }
    }

    // --- Modo local (sin agente) --------------------------------------------------------------

    fun refreshLocal() {
        _state.update {
            it.copy(
                local = it.local.copy(
                    network = probe.network(),
                    wifi = probe.wifi(),
                    wifiEnabled = probe.isWifiEnabled(),
                    hasLocationPermission = probe.hasLocationPermission(),
                    locationEnabled = probe.isLocationEnabled(),
                ),
            )
        }
    }

    fun scanLocalWifi() {
        refreshLocal()
        val accepted = probe.requestScan()
        val results = probe.scanResults()
        val note = when {
            !probe.hasLocationPermission() -> "Sin permiso de ubicación Android no entrega redes cercanas."
            !probe.isLocationEnabled() -> "Activa la ubicación del teléfono: Android la exige para escanear redes."
            !accepted -> "Android limitó el escaneo (máx. 4 cada 2 min). Se muestran los últimos resultados del sistema."
            else -> "Escaneo solicitado. Si la lista no cambia, vuelve a intentarlo en unos segundos."
        }
        _state.update { it.copy(local = it.local.copy(scan = results, scanNote = note)) }
        // Los resultados nuevos llegan unos segundos después del escaneo.
        if (accepted) {
            viewModelScope.launch {
                delay(4_000)
                _state.update { it.copy(local = it.local.copy(scan = probe.scanResults())) }
            }
        }
    }

    fun measureLocal() {
        if (_state.value.local.measuring) return
        refreshLocal()
        val gw = _state.value.local.network?.gateway
        _state.update { it.copy(local = it.local.copy(measuring = true, measureError = null)) }
        viewModelScope.launch {
            try {
                val gwResult = gw?.let { probe.tcpLatency(it, 80) }
                val inet = probe.httpsLatency()
                _state.update {
                    it.copy(
                        local = it.local.copy(
                            gatewayLatency = gwResult,
                            internetLatency = inet,
                            measuring = false,
                            measureError = if (gw == null) "No se encontró la puerta de enlace de la red actual." else null,
                        ),
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(local = it.local.copy(measuring = false, measureError = e.message ?: "Error al medir")) }
            }
        }
    }

    private companion object {
        val JOB_TIMEOUT_MS = mapOf(
            "scan" to 180_000L,
            "latency" to 90_000L,
            "dns" to 90_000L,
            "speed" to 180_000L,
        )
    }
}
