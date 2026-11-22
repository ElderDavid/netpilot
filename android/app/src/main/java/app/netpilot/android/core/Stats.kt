package app.netpilot.android.core

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToLong

data class Summary(
    val sent: Int,
    val received: Int,
    val lossPct: Double,
    val min: Double?,
    val p50: Double?,
    val p95: Double?,
    val max: Double?,
    /** Media de |diferencia| entre muestras CONSECUTIVAS, en el orden en que se tomaron. */
    val jitter: Double?,
)

object Stats {
    /**
     * Resume una serie de tiempos (ms). `null` = muestra perdida.
     * Percentiles con el mismo índice que el agente (agent/speed.mjs): p50 = v[floor(n*0.5)],
     * p95 = v[min(n-1, floor(n*0.95))].
     */
    fun summarize(samples: List<Double?>): Summary {
        val ok = samples.filterNotNull().filter { it.isFinite() }
        val sorted = ok.sorted()
        val n = sorted.size
        val jitter = if (ok.size > 1) ok.zipWithNext { a, b -> abs(b - a) }.average() else if (ok.size == 1) 0.0 else null
        return Summary(
            sent = samples.size,
            received = n,
            lossPct = if (samples.isEmpty()) 0.0 else round1((samples.size - n) * 100.0 / samples.size),
            min = sorted.firstOrNull()?.let { round1(it) },
            p50 = if (n == 0) null else round1(sorted[floor(n * 0.5).toInt()]),
            p95 = if (n == 0) null else round1(sorted[minOf(n - 1, floor(n * 0.95).toInt())]),
            max = sorted.lastOrNull()?.let { round1(it) },
            jitter = jitter?.let { round1(it) },
        )
    }

    fun round1(v: Double): Double = (v * 10).roundToLong() / 10.0
}

/** Convierte frecuencia (MHz) a banda y canal, como los reporta Android en WifiInfo/ScanResult. */
object WifiFreq {
    fun band(mhz: Int): String? = when (mhz) {
        in 2400..2500 -> "2,4 GHz"
        in 4900..5899 -> "5 GHz"
        in 5925..7125 -> "6 GHz"
        else -> null
    }

    fun channel(mhz: Int): Int? = when (mhz) {
        2484 -> 14
        in 2412..2472 -> (mhz - 2407) / 5
        in 4900..5899 -> (mhz - 5000) / 5
        in 5955..7115 -> (mhz - 5950) / 5
        else -> null
    }
}
