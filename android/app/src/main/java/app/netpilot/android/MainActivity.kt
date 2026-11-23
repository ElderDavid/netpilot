package app.netpilot.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import app.netpilot.android.ui.AppViewModel
import app.netpilot.android.ui.NetPilotApp
import app.netpilot.android.ui.theme.NetPilotTheme

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            NetPilotTheme {
                NetPilotApp(vm)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Al volver (p. ej. tras conceder permisos o cambiar de red) se releen los datos del teléfono.
        vm.refreshLocal()
    }
}
