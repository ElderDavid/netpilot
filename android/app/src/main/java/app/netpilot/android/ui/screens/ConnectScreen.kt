package app.netpilot.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.netpilot.android.ui.Connection
import app.netpilot.android.ui.ErrorBanner
import app.netpilot.android.ui.FinderState
import app.netpilot.android.ui.Muted
import app.netpilot.android.ui.SectionCard
import app.netpilot.android.ui.UiState

@Composable
fun ConnectScreen(
    state: UiState,
    onConnect: (host: String, port: String) -> Unit,
    onFind: (port: String) -> Unit,
    onOffline: () -> Unit,
) {
    var host by rememberSaveable { mutableStateOf(state.lastHost) }
    var port by rememberSaveable { mutableStateOf(state.lastPort.toString()) }
    val connecting = state.connection is Connection.Connecting

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Conectar con el agente", style = MaterialTheme.typography.headlineSmall)
        Muted(
            "El agente NetPilot corre en tu PC (node agent/index.mjs o el servicio de Windows) e imprime su " +
                "dirección al arrancar: «Red: http://192.168.x.x:8787». El teléfono debe estar en la misma Wi-Fi.",
        )

        OutlinedTextField(
            value = host,
            onValueChange = { host = it },
            label = { Text("IP del PC") },
            placeholder = { Text("192.168.1.20") },
            singleLine = true,
            enabled = !connecting,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = port,
            onValueChange = { v -> port = v.filter(Char::isDigit).take(5) },
            label = { Text("Puerto") },
            singleLine = true,
            enabled = !connecting,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )

        when (val c = state.connection) {
            is Connection.Failed -> ErrorBanner(c.message)
            is Connection.Connecting -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.width(20.dp), strokeWidth = 2.dp)
                Text("  Conectando con ${c.host}:${c.port}…")
            }
            else -> Unit
        }

        Button(onClick = { onConnect(host, port) }, enabled = !connecting, modifier = Modifier.fillMaxWidth()) {
            Text("Conectar")
        }

        SectionCard("Buscar el agente en mi red") {
            Muted(
                "Prueba el puerto $port en las 254 direcciones de tu red (/24) y confirma que responde NetPilot. " +
                    "Tarda unos segundos. El agente no anuncia mDNS todavía, por eso no hay descubrimiento automático.",
            )
            when (val f = state.finder) {
                is FinderState.Searching -> {
                    LinearProgressIndicator(progress = { f.done / f.total.toFloat() }, modifier = Modifier.fillMaxWidth())
                    Muted("Probadas ${f.done} de ${f.total}")
                }
                is FinderState.Done ->
                    if (f.found.isEmpty()) {
                        Muted("No se encontró ningún agente. Revisa que esté encendido y que el firewall permita el puerto en redes privadas.")
                    } else {
                        f.found.forEach { a ->
                            TextButton(onClick = {
                                host = a.host
                                port = a.port.toString()
                                onConnect(a.host, a.port.toString())
                            }) { Text("Conectar a ${a.host}:${a.port}") }
                        }
                    }
                is FinderState.Error -> ErrorBanner(f.message)
                FinderState.Idle -> Unit
            }
            OutlinedButton(
                onClick = { onFind(port) },
                enabled = state.finder !is FinderState.Searching && !connecting,
            ) { Text("Buscar") }
        }

        SectionCard("Sin agente") {
            Muted(
                "Puedes usar la app solo con lo que Android permite: la Wi-Fi del teléfono, redes cercanas y " +
                    "latencia TCP/HTTPS. Sin agente no hay inventario de la red, pruebas desde el PC ni router.",
            )
            OutlinedButton(onClick = onOffline, enabled = !connecting) { Text("Continuar sin agente") }
        }
    }
}
