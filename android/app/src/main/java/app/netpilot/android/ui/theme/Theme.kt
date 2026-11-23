package app.netpilot.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Tema oscuro, alineado con public/styles.css de la PWA.
private val NetPilotColors = darkColorScheme(
    primary = Color(0xFF38BDF8),
    onPrimary = Color(0xFF0F172A),
    secondary = Color(0xFF94A3B8),
    background = Color(0xFF0F172A),
    onBackground = Color(0xFFE2E8F0),
    surface = Color(0xFF111C33),
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF1E293B),
    onSurfaceVariant = Color(0xFFCBD5E1),
    error = Color(0xFFF87171),
    onError = Color(0xFF0F172A),
)

object StatusColors {
    val ok = Color(0xFF22C55E)
    val warn = Color(0xFFF59E0B)
    val bad = Color(0xFFEF4444)
    val info = Color(0xFF38BDF8)
    val muted = Color(0xFF64748B)
}

@Composable
fun NetPilotTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = NetPilotColors, content = content)
}
