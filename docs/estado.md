# NetPilot — Estado compartido

> Fuente de verdad para los dos agentes. Actualizar al empezar y al terminar cada tarea.
> Última actualización: 2026-11-22

## Reglas de convivencia

1. Una tarea, un responsable. No trabajes en una tarea marcada `en curso` por el otro agente.
2. Antes de tocar un archivo listado como "en curso", anótalo y espera.
3. Rama por tarea. Commits pequeños. Nunca `push --force`.
4. Al terminar: evidencia (comando + resultado), qué falta verificar y limitaciones.
5. Sin secretos en el repo. Ni contraseñas, ni MACs completas, ni seriales.

## Tablero

| # | Tarea | Responsable | Estado | Rama | Archivos |
|---|---|---|---|---|---|
| 1 | Adaptadores MikroTik/OpenWrt + bloqueo | OpenCode | **hecho** (sin hardware) | `main` | `agent/adapters.mjs`, `agent/index.mjs`, `public/app.js` |
| 2 | Servicio Windows + bandeja + instalador | Claude | **hecho** (probado en Windows 11) | `main` | `service/*`, `docs/instalacion.md` |
| 3 | App Android nativa | Claude | **hecho** (compila; sin probar en teléfono) | `main` | `android/*` |
| 4 | Historial y comparación | OpenCode | **hecho** | `main` | `public/app.js`, `agent/store.mjs`, `agent/index.mjs` |
| 4.5 | Servidor MCP | OpenCode | pendiente | `feat/mcp` | `mcp/*`, `docs/mcp.md` |

Estados: `pendiente` · `en curso` · `bloqueado` · `hecho`

## Propiedad de archivos

| Zona | Dueño actual |
|---|---|
| `agent/` (núcleo, adaptadores) | OpenCode |
| `public/` (UI) | OpenCode |
| `service/`, instalador Windows | Claude |
| `android/` | Claude |
| `mcp/` | OpenCode |
| `docs/` | compartido (añadir, no reescribir sin avisar) |

## Decisiones

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-11-22 | Agente sin dependencias npm | Portabilidad y auditoría simple |
| 2026-11-22 | Capacidades con evidencia y caducidad | No prometer compatibilidad |
| 2026-11-22 | Credenciales solo en memoria (MVP) | Evitar persistir secretos sin almacén del SO |
| 2026-11-22 | UI en español, código en inglés | Consistencia |
| 2026-11-22 | `?v=N` para assets | Evitar caché del service worker |

## Bitácora

### 2026-11-22 — MVP base (OpenCode)
- Agente Windows + PWA local: descubrimiento (ICMP/ARP/SSDP), inventario con evidencia, Wi-Fi, latencia/jitter/pérdida, DNS, speed test, router/ONT, capacidades.
- Verificado en red real: 4 equipos, Fiberhome de solo lectura, ONT sin web, 5 GHz canal 40.
- Limitaciones: speed test variable, sin escritura, sin Android nativo ni servicio.

### 2026-11-22 — Tarea 1: adaptadores (OpenCode) — hecho, sin hardware
- `agent/adapters.mjs`: MikroTik REST (system, leases, ARP, registration-table) y OpenWrt ubus (login, iwinfo, dhcp/file).
- Bloqueo: MikroTik `address-list netpilot-block` + regla `forward drop`; OpenWrt marcado no disponible.
- UI: tarjeta "Acceso administrativo" con formulario, clientes, señal/PHY y bloqueo con confirmación.
- Credenciales **solo en memoria**; no se persisten ni se registran. Se limpian al desconectar.
- Probado: validación de entrada, host no privado rechazado, error 502 claro contra un equipo que no es MikroTik/OpenWrt.
- **Pendiente:** probar contra RouterOS y OpenWrt reales; ajustar campos de `registration-table` según versión.

### 2026-11-22 — Tarea 4: historial y comparación (OpenCode) — hecho
- Snapshots locales (máx. 50) con latencia, velocidad, DNS, señal y equipos.
- Vista Historial con 4 gráficas SVG (latencia p50, velocidad, pérdida, equipos).
- Comparador A/B con veredicto por métrica (mejor/peor/igual) y umbral del 5 %.
- Exportación: JSON completo saneado (MAC enmascarada, sin credenciales) y CSV de mediciones.
- API: `POST /api/snapshots`, `DELETE /api/snapshots/:id`, `GET /api/export?format=json|csv`.
- Probado: snapshot con etiqueta, comparación 23 ms → 15 ms (2 mejor / 2 peor), export sin MAC completas.

### 2026-11-22 — Tarea 2: servicio Windows + bandeja (Claude) — hecho, sin probar en Windows
- `service/install.ps1` (admin): tareas `\NetPilot\Agente` y `\NetPilot\Bandeja` al iniciar sesión del usuario (Interactive, RunLevel Limited), regla de firewall opcional y preguntada (TCP 8787, perfil Privado, solo `node.exe`, grupo `NetPilot`), accesos directos en el menú Inicio (todos los usuarios). Idempotente, `-WhatIf`.
- `service/run-agent.ps1`: supervisor sin ventana; `node <ruta>\agent\index.mjs` con cwd en la raíz, salida a `data/logs/agent.log` (rota a 5 MB), reinicio con espera 2→60 s. Mutex por sesión.
- `service/tray.ps1`: NotifyIcon con Abrir panel, Reiniciar agente, Ver registro y Salir (solo cierra la bandeja). Estado por color sondeando `GET /manifest.webmanifest` cada 10 s.
- `service/uninstall.ps1` (admin): detiene procesos, quita tareas + carpeta, reglas y accesos directos; conserva `data/` salvo `-PurgeData`; verifica que no quede nada.
- **Sin cambios en `agent/`**: el registro se hace redirigiendo la salida; la sonda usa un recurso estático existente.
- Probado aquí (Linux, Node 22.23.5): `PORT=8799 node /ruta/abs/agent/index.mjs` desde `/` → `/manifest.webmanifest` 200 y `/api/bootstrap` 200.
- **No probado:** nada de PowerShell se ejecutó (no hay Windows ni PowerShell en este entorno). Archivos en UTF-8 con BOM para que Windows PowerShell 5.1 lea bien los acentos. Lista de verificación manual en `docs/instalacion.md` § «Qué falta verificar».
- Limitaciones: puede verse una consola un instante al iniciar sesión; «Reiniciar agente» desde un usuario sin privilegios asume que puede arrancar su propia tarea (no verificado).
### 2026-11-22 — Tarea 3: app Android nativa (Claude) — hecho, no compilado con SDK de Android
- `android/`: Gradle 8.11.1 (wrapper con SHA-256), AGP 8.7.3, Kotlin 2.0.21, Compose BOM 2024.12.01, Material 3, minSdk 26 / target 35. Versiones comprobadas en Maven.
- Pantallas: Conectar (IP/puerto manual + búsqueda opcional en la /24), Resumen, Equipos (lista + detalle con evidencia, tipo, confianza, método), Wi-Fi (PC y teléfono), Pruebas (trabajos del agente con progreso + medición local), Router (gateway, ONT, capacidades con estado y evidencia).
- Sin agente: red/Wi-Fi del teléfono (WifiManager/ConnectivityManager), escaneo (permiso de ubicación, límite de Android 4/2 min), latencia TCP al router y HTTPS a generate_204. Inventario, router y capacidades se declaran «No disponible» con el motivo.
- Seguridad: sin credenciales (el acceso administrativo queda en el panel web); solo se guarda la última IP/puerto; HTTP solo a IPv4 privadas (mismo criterio que `isPrivateIp`); el parser ignora `mac` y enmascara BSSID.
- mDNS: **no viable hoy**, el agente no anuncia servicio. Alternativa: sondeo TCP del puerto + `/manifest.webmanifest`.
- Paquete Kotlin `core` (no `data`): el `.gitignore` raíz ignora cualquier carpeta `data/`.
- Probado aquí: kotlinc 2.0.21 (el de la distribución de Gradle) compila las clases JVM puras (`core/` sin Android + pruebas); **19/19 pruebas JUnit OK**. Fixture `bootstrap.json` contrastada con las claves reales de `/api/bootstrap`. Prueba de humo del cliente contra el agente real: bootstrap OK, trabajo DNS hasta `done`, 404 y puerto cerrado con mensaje claro, búsqueda encuentra el agente.
- **No probado:** `./gradlew assembleDebug` (no hay SDK de Android), pantallas Compose, `LocalProbe`, permisos y ejecución en un teléfono. Lista en `android/README.md` § «Qué falta verificar».

### 2026-11-22 — Tarea 3: compilación con SDK (Claude)
- SDK de Android instalado en el entorno de Claude (Platform 35, Build-Tools 35.0.0, JDK 21; licencias aceptadas con autorización del usuario).
- `./gradlew assembleDebug testDebugUnitTest lintDebug` → **OK**: `app-debug.apk` (~10 MB), 19/19 pruebas, Lint sin errores (avisos explicados en `android/README.md`).
- Ajustes de Lint: icono monocromo (Android 13+) y `dataExtractionRules` sin copia en la nube.
- **No probado:** ejecución. No hay emulador (falta KVM). Falta instalarla en un teléfono real.

### 2026-11-22 — Tarea 2 verificada en Windows (OpenCode)
- Clon en `Documents\netpilot-prueba` (rama `feat/windows-service`). `install.ps1 -WhatIf -Firewall No` → exit 0, sin cambios.
- Instalación real `-Firewall Yes` → exit 0. Tareas `\NetPilot\Agente` y `\NetPilot\Bandeja` en Running; regla de firewall Privada activa; accesos directos creados; `GET /api/bootstrap` → 200.
- Supervisor: se mató `node` (PID 25928) y volvió solo en 4 s (PID nuevo, HTTP 200).
- Bandeja: proceso `tray.ps1` activo.
- Desinstalación: 0 tareas, 0 reglas, 0 accesos directos, 0 procesos, puerto cerrado; `data/` conservado.
- Reinstalado desde el proyecto real (`Downloads\OpenCode\netpilot`) con `-Firewall Yes`.
- La Wi-Fi está marcada como **red Pública**, así que la regla Privada no servía para el móvil: se añadió una segunda regla del grupo `NetPilot`, perfil Público y `RemoteAddress LocalSubnet` (solo subred local, se borra con el desinstalador).
- **No verificado:** cierre y apertura de sesión (no se puede cerrar la sesión del usuario desde el agente) y los clics de la bandeja. El disparador es `AtLogOn` del usuario `LAPTOP-QU745GBU\Elder`.

### 2026-11-22 — Correcciones tras revisión (OpenCode)
- API: `/api/bootstrap`, `/api/devices/:id` y `/api/wifi` ya no entregan MAC completas, `gatewayMac`, `interfaces[].mac` ni `key`. BSSID enmascarados y bandera `current` calculada en el servidor.
- Adaptadores: los clientes usan un id opaco; el bloqueo resuelve la MAC en el servidor.
- `speed.mjs`: el jitter se calcula sobre muestras consecutivas, no sobre la lista ordenada.
- Probado: bootstrap sin campos `mac`/`key`, export sin MAC completas, `current` marca RPEMN.

### 2026-11-22 — Observaciones en `agent/` para OpenCode (Claude, sin tocar código)
- `/api/bootstrap` entrega MAC completas: `system.interfaces[].mac`, `network.gatewayMac`, `state.devices[].mac` y `.key`. `/api/wifi` y `state.wifi` entregan BSSID completos. Choca con la regla 1 si se considera la API como «mensaje»; la app Android los ignora, la PWA convendría revisarla.
- `speed.mjs` `stats()`: el jitter se calcula sobre las muestras **ordenadas**, lo que da (máx − mín)/(n − 1), no la variación entre muestras consecutivas.
- Propuesta: anunciar `_netpilot._tcp` por mDNS para que Android descubra el agente con NsdManager.

## Pendientes de verificación

- Adaptadores MikroTik/OpenWrt: **sin hardware de prueba**. Marcar "no verificado en hardware" hasta conectar un equipo real.
- App Android: compila y pasa pruebas/Lint; **falta ejecutarla** en un teléfono (Android 8 y 13+): permisos, SSID, escaneo, conexión al agente y pruebas.
- Servicio Windows: instalación, supervisor, bandeja y desinstalación verificados en Windows 11. **Falta:** cierre/apertura de sesión y clics de la bandeja.
- Red doméstica marcada como Pública: el móvil solo entra por la regla `LocalSubnet` añadida; si se cambia a Privada, basta la regla del instalador.

## Cómo verificar el estado actual

```powershell
cd netpilot
node --check agent/index.mjs
node agent/index.mjs
curl.exe -s http://localhost:8787/api/bootstrap
```
