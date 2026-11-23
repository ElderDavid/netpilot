package app.netpilot.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import app.netpilot.android.core.LocalLatency
import app.netpilot.android.core.LocalProbe
import app.netpilot.android.ui.ErrorBanner
import app.netpilot.android.ui.JobProgress
import app.netpilot.android.ui.KeyValue
import app.netpilot.android.ui.Muted
import app.netpilot.android.ui.SectionCard
import app.netpilot.android.ui.UiState
import app.netpilot.android.ui.Unavailable
import app.netpilot.android.ui.fmtIso
import app.netpilot.android.ui.fmtMbps
import app.netpilot.android.ui.fmtMs
import app.netpilot.android.ui.fmtPct

@Composable
fun TestsScreen(state: UiState, onRunJob: (String) -> Unit, onMeasureLocal: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val boot = state.boot
        if (state.connected && boot != null) {
            Muted("Estas pruebas las ejecuta el agente en el PC: miden la red del PC, no la del teléfono.")

            AgentTest(state, "latency", "Latencia y pérdida", "20 pings al router y a 8.8.8.8.", onRunJob) {
                boot.tests.latency.firstOrNull()?.let { r ->
                    KeyValue("Router p50 / p95", "${fmtMs(r.gateway?.p50)} / ${fmtMs(r.gateway?.p95)}")
                    KeyValue("Router pérdida", fmtPct(r.gateway?.lossPct))
                    KeyValue("Internet p50", fmtMs(r.internet?.p50))
                    KeyValue("Internet pérdida", fmtPct(r.internet?.lossPct))
                    Muted(fmtIso(r.at))
                }
            }
            AgentTest(state, "dns", "DNS", "Resolver del sistema frente a 8.8.8.8.", onRunJob) {
                boot.tests.dns.firstOrNull()?.let { r ->
                    KeyValue(r.systemLabel ?: "Sistema", fmtMs(r.systemP50))
                    KeyValue(r.publicLabel ?: "Público", fmtMs(r.publicP50))
                    Muted(fmtIso(r.at))
                }
            }
            AgentTest(
                state, "speed", "Velocidad y bufferbloat",
                "Descarga y subida contra speed.cloudflare.com (~30 s). Cloudflare puede limitar tras varias pruebas seguidas.",
                onRunJob,
            ) {
                boot.tests.speed.firstOrNull()?.let { r ->
                    KeyValue("Bajada", fmtMbps(r.downloadMbps))
                    KeyValue("Subida", fmtMbps(r.uploadMbps))
                    KeyValue("Latencia en reposo / en carga", "${fmtMs(r.idleLatency)} / ${fmtMs(r.loadedLatency)}")
                    KeyValue("Bufferbloat", fmtMs(r.bufferbloatMs))
                    Muted(fmtIso(r.at))
                }
            }
        } else {
            Unavailable(
                "Pruebas desde el PC",
                "Velocidad, DNS y latencia ICMP las hace el agente. Sin agente solo se mide desde el teléfono (abajo).",
            )
        }

        SectionCard("Desde este teléfono") {
            Muted(
                "TCP al puerto 80 del router (10 intentos) y HTTPS a ${LocalProbe.HTTPS_PROBE_URL} (5 intentos). " +
                    "No es ping ICMP: Android no lo permite a las apps de forma fiable. La prueba HTTPS contacta un servidor de Google.",
            )
            val l = state.local
            if (l.measuring) Muted("Midiendo…")
            l.measureError?.let { ErrorBanner(it) }
            l.gatewayLatency?.let { LocalResult("Router (TCP)", it) }
            l.internetLatency?.let { LocalResult("Internet (HTTPS)", it) }
            OutlinedButton(onClick = onMeasureLocal, enabled = !l.measuring) { Text("Medir desde el teléfono") }
        }
    }
}

@Composable
private fun AgentTest(
    state: UiState,
    kind: String,
    title: String,
    description: String,
    onRunJob: (String) -> Unit,
    lastResult: @Composable () -> Unit,
) {
    SectionCard(title) {
        Muted(description)
        val job = state.jobs[kind]
        if (job != null && job.status == "running") {
            JobProgress(job)
        } else {
            Button(onClick = { onRunJob(kind) }) { Text("Ejecutar") }
        }
        state.jobErrors[kind]?.let { ErrorBanner(it) }
        Text("Último resultado", style = MaterialTheme.typography.titleSmall)
        lastResult()
    }
}

@Composable
private fun LocalResult(title: String, r: LocalLatency) {
    Text("$title · ${r.target}", style = MaterialTheme.typography.titleSmall)
    val s = r.summary
    KeyValue("p50 / p95", "${fmtMs(s.p50)} / ${fmtMs(s.p95)}")
    KeyValue("Mín / máx", "${fmtMs(s.min)} / ${fmtMs(s.max)}")
    KeyValue("Jitter", fmtMs(s.jitter))
    KeyValue("Sin respuesta", "${s.sent - s.received} de ${s.sent} (${fmtPct(s.lossPct)})")
    r.note?.let { Muted(it) }
}
