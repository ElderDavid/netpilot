# CLAUDE.md — contexto del proyecto NetPilot

Este archivo lo lee Claude Code al abrir la carpeta. Léelo completo antes de tocar código.

## Qué es

NetPilot es una app **local-first** para diagnosticar y administrar redes Wi-Fi. Sin cuenta, sin nube y sin credenciales obligatorias. Tiene tres clientes previstos (Windows, Android, web) y un **agente local** que ejecuta las tareas de red.

Estado actual: **MVP funcional** construido y probado en una red real (router Fiberhome SR1021D + nodo mesh + ONT Huawei HG8145V5 de Claro). El agente corre en Windows con Node 26 y cero dependencias.

## Stack y convenciones

- **Node.js 22+** (probado con 26), ESM (`.mjs`), **cero dependencias npm** en el agente. No agregues paquetes sin justificarlo y sin aprobación.
- Frontend: HTML/CSS/JS vanilla en `public/`, sin build. PWA con service worker.
- UI en **español**; código, variables y endpoints en inglés.
- Persistencia: `data/state.json` (se crea sola). No commitear `data/`.
- Puerto por defecto **8787** (`PORT` para cambiarlo).
- Windows-first. El agente usa `netsh`, `arp`, `ping`, `tracert` y PowerShell solo para leer interfaces.

## Mapa de archivos

```
agent/
  index.mjs      HTTP + SSE + API + jobs + arranque
  net.mjs        interfaces, ARP, ping, traceroute, TCP probe
  discovery.mjs  barrido ICMP/ARP, SSDP, fingerprint
  wifi.mjs       enlace, vecinos, canales, recomendación
  router.mjs     gateway, ONT, matriz de capacidades
  speed.mjs      latencia, DNS, velocidad, bufferbloat
  store.mjs      estado local y fusión de inventario
  oui.mjs        base OUI (descarga IEEE, cache local)
public/
  index.html     shell (assets con ?v=N)
  app.js         SPA completa
  styles.css     tema oscuro responsive
  sw.js          service worker (subir versión al cambiar assets)
docs/            plan, arquitectura, backlog, protocolo F0
```

## Cómo correr y probar

```powershell
cd netpilot
node agent/index.mjs
# http://localhost:8787   ·   http://<IP-local>:8787
```

Comprobaciones mínimas antes de dar algo por terminado:

```powershell
node --check agent/<archivo>.mjs
node --check public/app.js
curl.exe -s http://localhost:8787/api/bootstrap
```

- Si el puerto está ocupado, detén el proceso que escucha en 8787 antes de arrancar.
- Para reiniciar el estado: borra `data/state.json` (se pierde el inventario y el historial).
- Al cambiar `public/*`, **sube `?v=N`** en `index.html`; si no, el service worker sirve la versión vieja.

## Reglas no negociables

1. **Sin secretos.** Nunca escribas contraseñas, códigos de acceso, números de serie ni MAC completas en código, logs, docs, commits o mensajes. En UI solo prefijo OUI + máscara.
2. **Compatibilidad con evidencia.** Cada capacidad declara estado (`supported`, `config_required`, `read_only`, `unavailable`, `unknown`), evidencia, confianza y fecha. Sin evidencia → `unknown`.
3. **No inventes.** Si no pudiste probarlo en hardware, márcalo **"no verificado en hardware"**.
4. **Descubrir ≠ medir ≠ controlar.** No prometas tráfico por dispositivo ni bloqueo donde no haya API.
5. **Solo lectura por defecto.** Escrituras (bloquear, cambiar SSID, QoS) requieren confirmación explícita, auditoría y reversión.
6. **Nada de clasificación exacta de servicios** con HTTPS/CDN/VPN/DNS cifrado.
7. **No reescribas** archivos marcados como "en curso" por el otro agente en `docs/estado.md`. Si necesitas tocarlos, anótalo y espera.

## Estado verificado en la red del usuario (no asumir en otras redes)

- Gateway `192.168.80.1` = router principal **Fiberhome SR1021D** (no el ONT); nodo mesh en `.11`.
- ONT Huawei HG8145V5 en `192.168.1.254`: responde ICMP, **sin web** desde la subred del router.
- El panel Fiberhome solo expone un asistente mínimo: **sin inventario, tráfico, bloqueo ni QoS**. Clasificado como "genérico de solo lectura".
- PC por Wi-Fi 5 GHz (canal 40, ~433 Mbps PHY, -42 a -47 dBm), backhaul inalámbrico compartido.
- Pruebas: latencia al gateway p50 18–23 ms, p95 ~100 ms, 0 % pérdida; DNS router ≈ 8.8.8.8.
- 4 equipos: router, TV LG (SSDP), nodo Fiberhome, móvil con MAC aleatoria.

Todo esto es **un perfil**, no una garantía en otras redes.

## Limitaciones conocidas

- Prueba de velocidad con Cloudflare: puede limitar la descarga tras varias corridas. Ya se advierte en UI.
- Sin selector de interfaz ni detección de portal cautivo; sin IPv6.
- App Android nativa y servicio de Windows ya en `main`; el servicio está probado en Windows 11 y la app compila, pero **falta probarla en un teléfono**.
- Escritura limitada a bloqueo en MikroTik; OpenWrt solo lectura. **No verificado en hardware.**

## Roadmap y reparto

| # | Tarea | Responsable actual |
|---|---|---|
| 1 | Adaptadores MikroTik (REST) y OpenWrt (ubus) + bloqueo donde haya API | OpenCode |
| 2 | Servicio de Windows + bandeja + instalador | Claude |
| 3 | App Android nativa (Kotlin/Compose) | Claude |
| 4 | Historial y comparación antes/después | OpenCode |
| 4.5 | Servidor MCP de NetPilot | OpenCode |

El reparto puede cambiar: la fuente de verdad es `docs/estado.md`.

## Criterios de terminado

- `node --check` limpio y el agente arranca.
- Función probada manualmente y evidencia anotada en `docs/estado.md`.
- Sin secretos en el diff (`git diff` revisado).
- UI en español y responsive.
- Si aplica, capacidades actualizadas con evidencia o "no verificado".

## Coordinación con el otro agente

- **Antes de empezar:** marca tu tarea como `en curso` en `docs/estado.md` (fecha + rama + archivos).
- **Rama por tarea**, commits pequeños (`feat(service): ...`, `fix(wifi): ...`).
- **Al terminar:** marca `hecho`, escribe qué falta verificar y deja el repo ejecutable.
- No hagas `git push --force` ni reescribas historia compartida.
