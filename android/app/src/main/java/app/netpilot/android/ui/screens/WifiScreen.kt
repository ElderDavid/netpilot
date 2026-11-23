package app.netpilot.android.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.netpilot.android.ui.KeyValue
import app.netpilot.android.ui.Muted
import app.netpilot.android.ui.SectionCard
import app.netpilot.android.ui.UiState
import app.netpilot.android.ui.fmtDbm
import app.netpilot.android.ui.fmtIso
import app.netpilot.android.ui.fmtMbps

@Composable
fun WifiScreen(
    state: UiState,
    onLocalRefresh: () -> Unit,
    onLocalScan: () -> Unit,
    onAgentRefresh: () -> Unit,
) {
    val permissions = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.NEARBY_WIFI_DEVICES)
    }.toTypedArray()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { onLocalRefresh() }
    val l = state.local

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PhoneNetworkCard(state)

        if (!l.wifiEnabled) Muted("La Wi-Fi del teléfono está apagada.")
        if (!l.hasLocationPermission) {
            SectionCard("Permiso de ubicación") {
                Muted(
                    "Android oculta el nombre de la red (SSID) y las redes cercanas si la app no tiene permiso de " +
                        "ubicación. NetPilot no usa ni guarda tu ubicación.",
                )
                Button(onClick = { launcher.launch(permissions) }) { Text("Conceder permiso") }
            }
        } else if (!l.locationEnabled) {
            Muted("La ubicación del teléfono está apagada: Android no entrega el SSID ni el escaneo hasta que la actives.")
        }

        SectionCard("Redes cercanas (desde el teléfono)") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onLocalScan) { Text("Escanear") }
                OutlinedButton(onClick = onLocalRefresh) { Text("Actualizar") }
            }
            l.scanNote?.let { Muted(it) }
            if (l.scan.isEmpty()) Muted("Sin resultados todavía.")
            l.scan.take(25).forEach { n ->
                Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    Text(n.ssid, style = MaterialTheme.typography.bodyMedium)
                    Muted(listOfNotNull(fmtDbm(n.rssi), n.band, n.channel?.let { "canal $it" }, n.bssidMasked).joinToString(" · "))
                }
            }
            Muted("Android no informa el ancho de canal de forma fiable ni la ocupación del canal; no se hace recomendación desde el teléfono.")
        }

        val agentWifi = state.boot?.wifi
        if (state.connected) {
            SectionCard("Wi-Fi del PC con el agente") {
                Muted("Lo que ve la tarjeta Wi-Fi del PC (netsh), no el teléfono.")
                val link = agentWifi?.link
                if (link == null || !link.connected) {
                    Muted("El PC no reporta un enlace Wi-Fi (¿está por cable o el agente no corre en Windows?).")
                } else {
                    KeyValue("Red (SSID)", link.ssid)
                    KeyValue("Punto de acceso", link.bssidMasked)
                    KeyValue("Banda / canal", listOfNotNull(link.band, link.channel?.let { "canal $it" }).joinToString(" · ").ifEmpty { null })
                    KeyValue("Señal", listOfNotNull(link.rssi?.let { "$it dBm" }, link.signalPct?.let { "$it %" }).joinToString(" · ").ifEmpty { null })
                    KeyValue("Radio", link.radio)
                    KeyValue("PHY rx / tx", "${fmtMbps(link.rxMbps)} / ${fmtMbps(link.txMbps)}")
                    KeyValue("Seguridad", link.auth)
                }
                agentWifi?.recommendation?.let { r ->
                    Text("Recomendación de canal", style = MaterialTheme.typography.titleSmall)
                    r.reason?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                    r.note?.let { Muted(it) }
                }
                KeyValue("Leído", fmtIso(agentWifi?.at))
                OutlinedButton(onClick = onAgentRefresh, enabled = !state.wifiRefreshing) {
                    Text(if (state.wifiRefreshing) "Leyendo…" else "Releer desde el PC")
                }
                if (agentWifi != null && agentWifi.networks.isNotEmpty()) {
                    Text("Vecinos vistos por el PC (${agentWifi.networks.size})", style = MaterialTheme.typography.titleSmall)
                    agentWifi.networks.sortedByDescending { it.signalPct ?: 0 }.take(20).forEach { n ->
                        Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                            Text(n.ssid, style = MaterialTheme.typography.bodyMedium)
                            Muted(listOfNotNull(n.signalPct?.let { "$it %" }, n.band, n.channel?.let { "canal $it" }, n.bssidMasked).joinToString(" · "))
                        }
                    }
                }
            }
        }
    }
}
