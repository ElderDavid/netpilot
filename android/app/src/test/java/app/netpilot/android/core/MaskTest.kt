package app.netpilot.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MaskTest {
    // Valores ficticios construidos en la prueba; solo se comprueba que se conserva el prefijo OUI.
    private val fake = listOf("aa", "bb", "cc", "dd", "ee", "ff")

    @Test fun keepsOnlyOuiPrefix() {
        assertEquals("AA:BB:CC:··:··:··", Mask.mac(fake.joinToString(":")))
        assertEquals("AA:BB:CC:··:··:··", Mask.mac(fake.joinToString("-")))
    }

    @Test fun rejectsGarbage() {
        assertNull(Mask.mac(null))
        assertNull(Mask.mac(""))
        assertNull(Mask.mac("FULL-MAC-SENTINEL"))
        assertNull(Mask.mac("zz:bb:cc"))
    }
}
