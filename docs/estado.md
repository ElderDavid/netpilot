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
| 3 | App Android nativa | Claude | **en curso** (desde 2026-11-22) | `feat/android` | `android/*` |
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

## Pendientes de verificación

- Adaptadores MikroTik/OpenWrt: **sin hardware de prueba**. Marcar "no verificado en hardware" hasta conectar un equipo real.
- App Android: sin SDK en el entorno actual; se entrega proyecto compilable, no APK.
- Servicio Windows: probar logoff/logon y desinstalación.

## Cómo verificar el estado actual

```powershell
cd netpilot
node --check agent/index.mjs
node agent/index.mjs
curl.exe -s http://localhost:8787/api/bootstrap
```
