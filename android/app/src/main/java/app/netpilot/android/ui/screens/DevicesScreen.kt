package app.netpilot.android.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.netpilot.android.core.Device
import app.netpilot.android.ui.ConfidencePill
import app.netpilot.android.ui.ErrorBanner
import app.netpilot.android.ui.JobProgress
import app.netpilot.android.ui.KeyValue
import app.netpilot.android.ui.Muted
import app.netpilot.android.ui.Pill
import app.netpilot.android.ui.SectionCard
import app.netpilot.android.ui.UiState
import app.netpilot.android.ui.Unavailable
import app.netpilot.android.ui.fmtIso
import app.netpilot.android.ui.fmtMs
import app.netpilot.android.ui.theme.StatusColors

@Composable
fun DevicesScreen(state: UiState, onOpen: (String) -> Unit, onScan: () -> Unit) {
    val boot = state.boot
    if (!state.connected || boot == null) {
        Column(Modifier.padding(16.dp)) {
            Unavailable(
                "Inventario de dispositivos",
                "Android 10 y posteriores no permiten a las apps leer la tabla ARP ni ver qué equipos hay en la red. " +
                    "El inventario lo hace el agente en el PC (ICMP, ARP, DNS inverso y SSDP). Conéctate a un agente para verlo.",
            )
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val job = state.jobs["scan"]
                if (job != null && job.status == "running") JobProgress(job)
                else Button(onClick = onScan) { Text("Escanear la red ahora") }
                state.jobErrors["scan"]?.let { ErrorBanner(it) }
                Muted("${boot.devices.count { it.online }} en línea · ${boot.devices.size} conocidos. Identificación estimada: revisa la evidencia de cada equipo.")
            }
        }
        if (boot.devices.isEmpty()) item { Muted("El agente todavía no ha encontrado equipos.") }
        items(boot.devices, key = { it.id }) { d -> DeviceRow(d) { onOpen(d.id) } }
    }
}

@Composable
private fun DeviceRow(d: Device, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(d.displayName, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 1)
            if (d.isGateway) Pill("Router", StatusColors.info)
            Pill(if (d.online) "En línea" else "Fuera de línea", if (d.online) StatusColors.ok else StatusColors.muted)
        }
        Muted(listOfNotNull(d.ip, d.typeLabel, d.vendor).joinToString(" · "))
        HorizontalDivider(Modifier.padding(top = 6.dp))
    }
}

@Composable
fun DeviceDetailScreen(device: Device?) {
    if (device == null) {
        Column(Modifier.padding(16.dp)) { Muted("El dispositivo ya no está en el inventario.") }
        return
    }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(device.displayName, style = MaterialTheme.typography.headlineSmall)
        SectionCard("Identificación") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pill(device.typeLabel, StatusColors.info)
                ConfidencePill(device.confidence)
            }
            KeyValue("Fabricante (OUI)", device.vendor)
            KeyValue("MAC", device.macMasked ?: "Sin MAC (solo IP)")
            KeyValue("Nombre de host", device.hostname)
            KeyValue("Nombre SSDP", device.ssdpName)
        }
        SectionCard("Evidencia") {
            if (device.reasons.isEmpty()) Muted("El agente no registró evidencia para este equipo.")
            device.reasons.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
            KeyValue("Detectado por", device.method.joinToString(", ").ifEmpty { null })
            Muted("La identificación es una estimación a partir de estas señales; no es exacta.")
        }
        SectionCard("Red") {
            KeyValue("IP actual", device.ip)
            if (device.ips.size > 1) KeyValue("IP anteriores", device.ips.filter { it != device.ip }.joinToString(", "))
            KeyValue("Respuesta (RTT)", fmtMs(device.rttMs))
            KeyValue("TTL", device.ttl?.toString())
            KeyValue("Visto por primera vez", fmtIso(device.firstSeen))
            KeyValue("Visto por última vez", fmtIso(device.lastSeen))
        }
        SectionCard("Control") {
            Unavailable(
                "Bloqueo, tráfico y QoS desde Android",
                "Descubrir un equipo no implica poder medir su tráfico ni bloquearlo. El bloqueo existe solo para " +
                    "MikroTik conectado desde el panel web (no verificado en hardware) y requiere credenciales, que esta app no pide ni guarda.",
            )
        }
    }
}
