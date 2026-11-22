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
| 2 | Servicio Windows + bandeja + instalador | Claude | pendiente | `feat/windows-service` | `service/*`, `docs/instalacion.md` |
| 3 | App Android nativa | Claude | **hecho** (no compilado con SDK) | `feat/android` | `android/*` |
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

### 2026-11-22 — Tarea 3: app Android nativa (Claude) — hecho, no compilado con SDK de Android
- `android/`: Gradle 8.11.1 (wrapper con SHA-256), AGP 8.7.3, Kotlin 2.0.21, Compose BOM 2024.12.01, Material 3, minSdk 26 / target 35. Versiones comprobadas en Maven.
- Pantallas: Conectar (IP/puerto manual + búsqueda opcional en la /24), Resumen, Equipos (lista + detalle con evidencia, tipo, confianza, método), Wi-Fi (PC y teléfono), Pruebas (trabajos del agente con progreso + medición local), Router (gateway, ONT, capacidades con estado y evidencia).
- Sin agente: red/Wi-Fi del teléfono (WifiManager/ConnectivityManager), escaneo (permiso de ubicación, límite de Android 4/2 min), latencia TCP al router y HTTPS a generate_204. Inventario, router y capacidades se declaran «No disponible» con el motivo.
- Seguridad: sin credenciales (el acceso administrativo queda en el panel web); solo se guarda la última IP/puerto; HTTP solo a IPv4 privadas (mismo criterio que `isPrivateIp`); el parser ignora `mac` y enmascara BSSID.
- mDNS: **no viable hoy**, el agente no anuncia servicio. Alternativa: sondeo TCP del puerto + `/manifest.webmanifest`.
- Paquete Kotlin `core` (no `data`): el `.gitignore` raíz ignora cualquier carpeta `data/`.
- Probado aquí: kotlinc 2.0.21 (el de la distribución de Gradle) compila las clases JVM puras (`core/` sin Android + pruebas); **19/19 pruebas JUnit OK**. Fixture `bootstrap.json` contrastada con las claves reales de `/api/bootstrap`. Prueba de humo del cliente contra el agente real: bootstrap OK, trabajo DNS hasta `done`, 404 y puerto cerrado con mensaje claro, búsqueda encuentra el agente.
- **No probado:** `./gradlew assembleDebug` (no hay SDK de Android), pantallas Compose, `LocalProbe`, permisos y ejecución en un teléfono. Lista en `android/README.md` § «Qué falta verificar».

### 2026-11-22 — Observaciones en `agent/` para OpenCode (Claude, sin tocar código)
- `/api/bootstrap` entrega MAC completas: `system.interfaces[].mac`, `network.gatewayMac`, `state.devices[].mac` y `.key`. `/api/wifi` y `state.wifi` entregan BSSID completos. Choca con la regla 1 si se considera la API como «mensaje»; la app Android los ignora, la PWA convendría revisarla.
- `speed.mjs` `stats()`: el jitter se calcula sobre las muestras **ordenadas**, lo que da (máx − mín)/(n − 1), no la variación entre muestras consecutivas.
- Propuesta: anunciar `_netpilot._tcp` por mDNS para que Android descubra el agente con NsdManager.

## Pendientes de verificación

- Adaptadores MikroTik/OpenWrt: **sin hardware de prueba**. Marcar "no verificado en hardware" hasta conectar un equipo real.
- App Android: **no compilado aquí** (sin SDK). Ejecutar `cd android && ./gradlew assembleDebug testDebugUnitTest` y probar en Android 8 y 13+.
- Servicio Windows: probar logoff/logon y desinstalación.

## Cómo verificar el estado actual

```powershell
cd netpilot
node --check agent/index.mjs
node agent/index.mjs
curl.exe -s http://localhost:8787/api/bootstrap
```
