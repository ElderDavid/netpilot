package app.netpilot.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.netpilot.android.ui.CapabilityPill
import app.netpilot.android.ui.KeyValue
import app.netpilot.android.ui.Muted
import app.netpilot.android.ui.SectionCard
import app.netpilot.android.ui.UiState
import app.netpilot.android.ui.Unavailable
import app.netpilot.android.ui.fmtIso
import app.netpilot.android.ui.fmtMs

@Composable
fun RouterScreen(state: UiState, onRefresh: () -> Unit) {
    val boot = state.boot
    if (!state.connected || boot == null) {
        Column(Modifier.padding(16.dp)) {
            Unavailable(
                "Router y capacidades",
                "Identificar el router, el ONT y qué se puede administrar requiere sondas (HTTP, traceroute) que hace el agente. " +
                    "Desde el teléfono solo se conoce la IP de la puerta de enlace (ver «Wi-Fi»).",
            )
        }
        return
    }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val r = boot.router
        OutlinedButton(onClick = onRefresh, enabled = !state.routerRefreshing) {
            Text(if (state.routerRefreshing) "Inspeccionando… (puede tardar)" else "Volver a inspeccionar")
        }
        if (r == null) {
            Muted("El agente aún no ha inspeccionado el router.")
            return@Column
        }
        SectionCard("Puerta de enlace") {
            KeyValue("IP", r.gatewayIp)
            KeyValue("Familia detectada", r.familyLabel)
            KeyValue("Fabricante (OUI)", r.vendor)
            KeyValue("MAC", r.gatewayMacMasked)
            KeyValue("Panel web", if (r.webReachable) "Responde${r.webTitle?.let { " («$it»)" } ?: ""}" else "No responde")
            KeyValue("Inspeccionado", fmtIso(r.inspectedAt))
        }
        r.ont?.let { o ->
            SectionCard("Equipo aguas arriba (ONT/módem)") {
                KeyValue("IP", o.ip)
                KeyValue("Latencia", fmtMs(o.ms))
                KeyValue("Administración web", if (o.manageable) "Expuesta" else "No expuesta")
                o.note?.let { Muted(it) }
            }
        }
        SectionCard("Capacidades") {
            Muted("Cada capacidad declara su estado y la evidencia en que se basa. Sin evidencia = desconocido.")
            r.capabilities.forEach { c ->
                Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(c.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        CapabilityPill(c.status)
                    }
                    c.evidence?.let { Muted("Evidencia: $it") }
                }
                HorizontalDivider()
            }
        }
        SectionCard("Acceso administrativo") {
            KeyValue("Estado", if (boot.access.connected) "Conectado (${boot.access.label ?: "—"})" else "No conectado")
            Muted(
                "La conexión a MikroTik u OpenWrt (y el bloqueo en MikroTik) se hace desde el panel web del agente. " +
                    "Esta app no pide, no envía y no guarda credenciales. Adaptadores no verificados en hardware.",
            )
        }
    }
}
