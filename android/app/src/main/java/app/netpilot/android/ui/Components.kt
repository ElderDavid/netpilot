package app.netpilot.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.netpilot.android.core.Job
import app.netpilot.android.ui.theme.StatusColors
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun SectionCard(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

@Composable
fun KeyValue(label: String, value: String?) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, Modifier.weight(0.45f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Text(value ?: "—", Modifier.weight(0.55f), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun Muted(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
}

/** Aviso honesto de algo que no se puede hacer en este contexto. */
@Composable
fun Unavailable(title: String, reason: String) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
            .padding(12.dp),
    ) {
        Text("No disponible · $title", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
        Muted(reason)
    }
}

@Composable
fun ErrorBanner(message: String, actionLabel: String? = null, onAction: (() -> Unit)? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(StatusColors.bad.copy(alpha = 0.15f), RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(message, Modifier.weight(1f), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        if (actionLabel != null && onAction != null) TextButton(onClick = onAction) { Text(actionLabel) }
    }
}

@Composable
fun Pill(text: String, color: Color) {
    Text(
        text,
        modifier = Modifier
            .background(color.copy(alpha = 0.18f), RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 2.dp),
        color = color,
        style = MaterialTheme.typography.labelMedium,
    )
}

/** Estados de capacidad definidos en CLAUDE.md. */
@Composable
fun CapabilityPill(status: String) {
    val (label, color) = when (status) {
        "supported" -> "Soportado" to StatusColors.ok
        "config_required" -> "Requiere configuración" to StatusColors.info
        "read_only" -> "Solo lectura" to StatusColors.warn
        "unavailable" -> "No disponible" to StatusColors.bad
        else -> "Desconocido" to StatusColors.muted
    }
    Pill(label, color)
}

@Composable
fun ConfidencePill(confidence: String) {
    val (label, color) = when (confidence) {
        "high" -> "Confianza alta" to StatusColors.ok
        "medium" -> "Confianza media" to StatusColors.warn
        else -> "Confianza baja" to StatusColors.muted
    }
    Pill(label, color)
}

@Composable
fun JobProgress(job: Job) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        LinearProgressIndicator(progress = { job.progress.toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
        Muted(job.message ?: "En curso…")
    }
}

// --- Formato --------------------------------------------------------------------------------------

private val esCO: Locale = Locale.forLanguageTag("es-CO")
private val dateFmt: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM, HH:mm", esCO)

fun fmtMs(v: Double?): String = v?.let { String.format(esCO, "%.1f ms", it) } ?: "—"
fun fmtMbps(v: Double?): String = v?.let { String.format(esCO, "%.1f Mbps", it) } ?: "—"
fun fmtPct(v: Double?): String = v?.let { String.format(esCO, "%.1f %%", it) } ?: "—"
fun fmtDbm(v: Int?): String = v?.let { "$it dBm" } ?: "—"

/** Fecha ISO-8601 del agente → hora local. Si no se puede leer, se muestra tal cual. */
fun fmtIso(iso: String?): String {
    if (iso.isNullOrBlank()) return "—"
    return try {
        dateFmt.format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
    } catch (e: Exception) {
        iso
    }
}

fun fmtAgo(millis: Long?): String {
    if (millis == null) return "—"
    val s = (System.currentTimeMillis() - millis) / 1000
    return when {
        s < 60 -> "hace ${s.coerceAtLeast(0)} s"
        s < 3600 -> "hace ${s / 60} min"
        else -> "hace ${s / 3600} h"
    }
}
