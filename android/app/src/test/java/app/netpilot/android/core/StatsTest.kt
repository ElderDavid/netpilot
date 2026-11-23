package app.netpilot.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StatsTest {
    @Test fun percentilesUseAgentIndexing() {
        val s = Stats.summarize(listOf(10.0, 30.0, 20.0, 40.0))
        assertEquals(30.0, s.p50!!, 0.0) // sorted[floor(4*0.5)] = sorted[2]
        assertEquals(40.0, s.p95!!, 0.0) // sorted[min(3, floor(3.8))] = sorted[3]
        assertEquals(10.0, s.min!!, 0.0)
        assertEquals(40.0, s.max!!, 0.0)
    }

    @Test fun jitterFollowsSampleOrder() {
        // |30-10| + |20-30| + |40-20| = 50 → 50 / 3
        assertEquals(16.7, Stats.summarize(listOf(10.0, 30.0, 20.0, 40.0)).jitter!!, 0.0)
    }

    @Test fun lossCountsNulls() {
        val s = Stats.summarize(listOf(10.0, null, 12.0, null))
        assertEquals(4, s.sent)
        assertEquals(2, s.received)
        assertEquals(50.0, s.lossPct, 0.0)
    }

    @Test fun allLost() {
        val s = Stats.summarize(listOf(null, null))
        assertNull(s.p50)
        assertNull(s.jitter)
        assertEquals(100.0, s.lossPct, 0.0)
    }

    @Test fun wifiChannels() {
        assertEquals(1, WifiFreq.channel(2412))
        assertEquals(14, WifiFreq.channel(2484))
        assertEquals(40, WifiFreq.channel(5200))
        assertEquals(1, WifiFreq.channel(5955))
        assertEquals("5 GHz", WifiFreq.band(5200))
        assertNull(WifiFreq.channel(900))
    }
}
