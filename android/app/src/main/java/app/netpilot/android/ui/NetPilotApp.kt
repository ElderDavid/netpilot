package app.netpilot.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.netpilot.android.ui.screens.ConnectScreen
import app.netpilot.android.ui.screens.DeviceDetailScreen
import app.netpilot.android.ui.screens.DevicesScreen
import app.netpilot.android.ui.screens.RouterScreen
import app.netpilot.android.ui.screens.SummaryScreen
import app.netpilot.android.ui.screens.TestsScreen
import app.netpilot.android.ui.screens.WifiScreen

private enum class Tab(val label: String, val icon: ImageVector) {
    Summary("Resumen", Icons.Filled.Home),
    Devices("Equipos", Icons.AutoMirrored.Filled.List),
    Wifi("Wi-Fi", Icons.Filled.Search),
    Tests("Pruebas", Icons.Filled.PlayArrow),
    Router("Router", Icons.Filled.Settings),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NetPilotApp(vm: AppViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    // La app empieza en «Conectar»; se sale al conectar o al elegir el modo sin agente.
    var showConnect by rememberSaveable { mutableStateOf(true) }
    var tab by rememberSaveable { mutableStateOf(Tab.Summary) }
    var deviceId by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(state.connection) {
        if (state.connection is Connection.Connected) showConnect = false
    }

    BackHandler(enabled = deviceId != null) { deviceId = null }

    if (showConnect) {
        Scaffold(
            topBar = { TopAppBar(title = { Text("NetPilot") }) },
        ) { padding ->
            Column(Modifier.padding(padding)) {
                ConnectScreen(
                    state = state,
                    onConnect = vm::connect,
                    onFind = vm::findAgents,
                    onOffline = {
                        vm.goOffline()
                        showConnect = false
                    },
                )
            }
        }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(if (deviceId != null) "Dispositivo" else "NetPilot")
                        Muted(connectionLabel(state))
                    }
                },
                navigationIcon = {
                    if (deviceId != null) {
                        IconButton(onClick = { deviceId = null }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Volver")
                        }
                    }
                },
                actions = {
                    IconButton(
                        onClick = { if (state.connected) vm.refresh() else vm.refreshLocal() },
                        enabled = !state.refreshing,
                    ) { Icon(Icons.Filled.Refresh, contentDescription = "Actualizar") }
                    TextButton(onClick = { showConnect = true }) { Text("Conexión") }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = t == tab && deviceId == null,
                        onClick = {
                            tab = t
                            deviceId = null
                        },
                        icon = { Icon(t.icon, contentDescription = null) },
                        label = { Text(t.label) },
                    )
                }
            }
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            state.refreshError?.let { msg ->
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    ErrorBanner("$msg Se muestran los últimos datos (${fmtAgo(state.updatedAtMillis)}).", "Reintentar") { vm.refresh() }
                }
            }
            val id = deviceId
            if (id != null) {
                DeviceDetailScreen(state.boot?.devices?.firstOrNull { it.id == id })
            } else {
                when (tab) {
                    Tab.Summary -> SummaryScreen(state)
                    Tab.Devices -> DevicesScreen(state, onOpen = { deviceId = it }, onScan = { vm.runJob("scan") })
                    Tab.Wifi -> WifiScreen(
                        state,
                        onLocalRefresh = vm::refreshLocal,
                        onLocalScan = vm::scanLocalWifi,
                        onAgentRefresh = vm::refreshAgentWifi,
                    )
                    Tab.Tests -> TestsScreen(state, onRunJob = vm::runJob, onMeasureLocal = vm::measureLocal)
                    Tab.Router -> RouterScreen(state, onRefresh = vm::refreshRouter)
                }
            }
        }
    }
}

private fun connectionLabel(state: UiState): String = when (val c = state.connection) {
    is Connection.Connected -> "Agente ${c.host}:${c.port}"
    is Connection.Connecting -> "Conectando…"
    is Connection.Failed, Connection.Offline -> "Sin agente · solo datos del teléfono"
}
