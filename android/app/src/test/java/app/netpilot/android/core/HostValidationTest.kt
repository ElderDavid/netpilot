package app.netpilot.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostValidationTest {
    private fun ok(host: String, port: String = "") = HostValidation.validate(host, port) as? HostValidation.Result.Ok

    @Test fun acceptsPrivateRangesLikeTheAgent() {
        listOf("10.0.0.5", "127.0.0.1", "192.168.80.20", "172.16.0.1", "172.31.255.254", "169.254.1.1")
            .forEach { assertTrue(it, HostValidation.isPrivateIpv4(it)) }
    }

    @Test fun rejectsPublicAndBorderRanges() {
        listOf("8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.64.0.1", "256.1.1.1", "1.2.3")
            .forEach { assertFalse(it, HostValidation.isPrivateIpv4(it)) }
    }

    @Test fun defaultPortAndTrimming() {
        val r = ok("  http://192.168.1.20/ ")
        assertEquals("192.168.1.20", r?.host)
        assertEquals(8787, r?.port)
    }

    @Test fun localhostAndDotLocal() {
        assertEquals("127.0.0.1", ok("localhost")?.host)
        assertEquals("pc-sala.local", ok("PC-Sala.local", "9000")?.host)
        assertEquals(9000, ok("pc-sala.local", "9000")?.port)
    }

    @Test fun rejectsBadInput() {
        listOf("", "8.8.8.8", "example.com", "192.168.1.20/api", "user@192.168.1.20", ".local", "-x.local")
            .forEach { assertTrue(it, HostValidation.validate(it, "8787") is HostValidation.Result.Invalid) }
        listOf("0", "65536", "abc").forEach {
            assertTrue(it, HostValidation.validate("192.168.1.20", it) is HostValidation.Result.Invalid)
        }
    }
}
