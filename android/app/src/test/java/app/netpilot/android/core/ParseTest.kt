package app.netpilot.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ParseTest {
    private val json = requireNotNull(javaClass.classLoader?.getResource("bootstrap.json")).readText()
    private val boot = Parse.bootstrap(json)

    @Test fun neverExposesFullMac() {
        // La fixture pone "FULL-MAC-SENTINEL" en todo campo que el agente llena con una MAC/BSSID completa.
        assertFalse(boot.toString().contains("FULL-MAC-SENTINEL"))
    }

    @Test fun agentAndNetwork() {
        assertEquals("0.1.0", boot.agent.version)
        assertEquals("pc-prueba", boot.agent.hostname)
        assertEquals("192.168.80.1", boot.network?.gateway)
        assertEquals("AA:BB:CC:··:··:··", boot.network?.gatewayMacMasked)
    }

    @Test fun devicesSkipInvalidAndKeepEvidence() {
        assertEquals(2, boot.devices.size) // el tercero no tiene id
        val gw = boot.devices[0]
        assertTrue(gw.isGateway)
        assertEquals(listOf("Es la puerta de enlace", "Responde HTTP"), gw.reasons)
        assertEquals("high", gw.confidence)
        val tv = boot.devices[1]
        assertEquals("TV sala", tv.displayName)
        assertNull(tv.macMasked)
        assertNull(tv.ttl)
        assertFalse(tv.online)
    }

    @Test fun nullsStayNull() {
        val lat = boot.tests.latency.first()
        assertEquals(18.2, lat.gateway?.p50!!, 0.0)
        assertEquals(0.0, lat.gateway?.lossPct!!, 0.0)
        assertNull(lat.internet?.p95)
        assertTrue(boot.tests.speed.isEmpty())
    }

    @Test fun wifiMasksBssid() {
        val w = assertNotNullAndGet(boot.wifi)
        assertNull(w.link?.bssidMasked) // el centinela no es una MAC: se descarta, no se muestra
        assertEquals(40, w.link?.channel)
        assertEquals(-44, w.link?.rssi)
        assertEquals("Vecino", w.networks.single().ssid)
        assertFalse(w.recommendation!!.shouldChange)
    }

    @Test fun routerCapabilities() {
        val r = assertNotNullAndGet(boot.router)
        assertEquals("Genérico", r.familyLabel)
        assertTrue(r.webReachable)
        assertEquals(listOf("supported", "unavailable"), r.capabilities.map { it.status })
        assertFalse(r.ont!!.manageable)
    }

    @Test fun jobsAndErrors() {
        val j = Parse.job("""{"id":"x","type":"dns","status":"running","progress":0.5,"message":"Consultando","error":null}""")
        assertEquals("running", j.status)
        assertEquals(0.5, j.progress, 0.0)
        assertNull(j.error)
        assertNull(Parse.scanStart("""{"job":null,"already":true}"""))
        assertEquals("Ruta no encontrada", Parse.errorMessage("""{"error":"Ruta no encontrada"}"""))
        assertNull(Parse.errorMessage("<html>"))
    }

    private fun <T> assertNotNullAndGet(v: T?): T {
        assertNotNull(v)
        return v!!
    }
}
