package app.netpilot.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.netpilot.android.ui.KeyValue
import app.netpilot.android.ui.Muted
import app.netpilot.android.ui.SectionCard
import app.netpilot.android.ui.UiState
import app.netpilot.android.ui.Unavailable
import app.netpilot.android.ui.fmtAgo
import app.netpilot.android.ui.fmtDbm
import app.netpilot.android.ui.fmtIso
import app.netpilot.android.ui.fmtMbps
import app.netpilot.android.ui.fmtMs
import app.netpilot.android.ui.fmtPct

@Composable
fun SummaryScreen(state: UiState) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val boot = state.boot
        if (state.connected && boot != null) {
            SectionCard("Agente") {
                KeyValue("Equipo", boot.agent.hostname)
                KeyValue("Versión", boot.agent.version)
                KeyValue("Sistema", boot.agent.platform)
                KeyValue("Actualizado", fmtAgo(state.updatedAtMillis))
            }

            SectionCard("Red del PC") {
                val n = boot.network
                if (n == null) {
                    Muted("El agente no encontró una interfaz de red activa.")
                } else {
                    KeyValue("Subred", n.subnet)
                    KeyValue("Puerta de enlace", n.gateway)
                    KeyValue("Fabricante (OUI)", n.gatewayVendor)
                    KeyValue("MAC del router", n.gatewayMacMasked)
                }
            }

            SectionCard("Dispositivos") {
                val online = boot.devices.count { it.online }
                KeyValue("En línea", "$online de ${boot.devices.size}")
                val pending = boot.alerts.filter { !it.ack }
                KeyValue("Alertas sin revisar", pending.size.toString())
                pending.take(3).forEach { a ->
                    Text("• ${a.title}: ${a.detail ?: ""}", fontWeight = FontWeight.Normal)
                    Muted(fmtIso(a.at))
                }
            }

            SectionCard("Últimas mediciones (desde el PC)") {
                val lat = boot.tests.latency.firstOrNull()
                val sp = boot.tests.speed.firstOrNull()
                val dns = boot.tests.dns.firstOrNull()
                KeyValue("Latencia router p50", fmtMs(lat?.gateway?.p50))
                KeyValue("Latencia router p95", fmtMs(lat?.gateway?.p95))
                KeyValue("Pérdida router", fmtPct(lat?.gateway?.lossPct))
                KeyValue("Latencia Internet p50", fmtMs(lat?.internet?.p50))
                KeyValue("Bajada / subida", if (sp == null) null else "${fmtMbps(sp.downloadMbps)} / ${fmtMbps(sp.uploadMbps)}")
                KeyValue("DNS sistema / público", if (dns == null) null else "${fmtMs(dns.systemP50)} / ${fmtMs(dns.publicP50)}")
                if (lat == null && sp == null && dns == null) Muted("Aún no hay pruebas. Ve a «Pruebas».")
            }

            SectionCard("Router") {
                val r = boot.router
                KeyValue("Familia", r?.familyLabel)
                KeyValue("Acceso administrativo", if (boot.access.connected) "Conectado (${boot.access.label ?: "—"})" else "No conectado")
            }
        } else {
            Text("Modo sin agente", style = androidx.compose.material3.MaterialTheme.typography.headlineSmall)
            Muted("Solo se muestra lo que Android permite leer en este teléfono.")
            PhoneNetworkCard(state)
            Unavailable("Inventario de la red", "Android 10+ no permite leer la tabla ARP ni enumerar equipos de la LAN. Requiere el agente.")
            Unavailable("Pruebas desde el PC y router", "Velocidad, DNS, traceroute, identificación del router y capacidades las hace el agente.")
        }
    }
}

@Composable
fun PhoneNetworkCard(state: UiState) {
    val l = state.local
    SectionCard("Este teléfono") {
        val n = l.network
        if (n == null) {
            Muted("Sin red activa.")
        } else {
            KeyValue("Conexión", if (n.onWifi) "Wi-Fi" else "No es Wi-Fi")
            KeyValue("IP", n.ipv4?.let { ip -> n.prefix?.let { "$ip/$it" } ?: ip })
            KeyValue("Puerta de enlace", n.gateway)
            KeyValue("DNS", n.dns.joinToString(", ").ifEmpty { null })
        }
        val w = l.wifi
        if (w != null) {
            KeyValue("Red (SSID)", w.ssid ?: "Oculta por Android (permiso/ubicación)")
            KeyValue("Señal", fmtDbm(w.rssi))
            KeyValue("Velocidad de enlace", w.linkMbps?.let { "$it Mbps" })
            KeyValue("Banda / canal", listOfNotNull(w.band, w.channel?.let { "canal $it" }).joinToString(" · ").ifEmpty { null })
        }
    }
}
