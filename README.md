# NetPilot 0.1 — MVP local

Agente de diagnóstico Wi-Fi **local-first**. Sin cuenta, sin nube, sin credenciales.
Descubre equipos, inventaría con evidencia, diagnostica Wi-Fi y mide red.

## Requisitos

- Windows 10/11
- Node.js 22 o superior (probado con Node 26)

## Ejecutar

```bat
cd netpilot
node agent/index.mjs
```

O doble clic en `run.cmd` (queda abierto en una consola).

Abre `http://localhost:8787` en el equipo, o `http://<IP-local>:8787` desde el móvil en la misma red.
El agente imprime ambas URLs al arrancar.

## Qué hace hoy

| Función | Estado | Cómo |
|---|---|---|
| Descubrimiento e inventario | ✅ | ICMP + ARP + DNS inverso + SSDP |
| Identificación estimada | ✅ | OUI IEEE local, hostname, TTL, SSDP |
| Alertas de equipo nuevo | ✅ | SSE en tiempo real |
| Diagnóstico Wi-Fi | ✅ | WlanAPI vía `netsh` |
| Latencia, jitter, pérdida | ✅ | ICMP al gateway e Internet |
| DNS comparativo | ✅ | Resolver del sistema vs 8.8.8.8 |
| Velocidad y bufferbloat | ✅ | Cloudflare, flujos paralelos |
| Router y ONT | ✅ | HTTP sin autenticación + traceroute |
| Matriz de capacidades | ✅ | Estados con evidencia |
| Bloqueo / QoS / SSID | 🟡 | Bloqueo solo en MikroTik conectado (address-list + regla forward). QoS y SSID, fase 2 |

## Acceso administrativo (opcional)

En **Router → Acceso administrativo** puedes conectar un MikroTik (REST) u OpenWrt (ubus):

- Lee sistema, leases, ARP y clientes Wi-Fi (señal y tasas si el firmware lo expone).
- MikroTik: bloquea y desbloquea con `address-list netpilot-block` + regla `forward drop`.
- OpenWrt: solo lectura; el bloqueo requiere nft/shell y está declarado no disponible.
- Las credenciales se usan **solo en memoria**, no se guardan ni se registran.
- Estado honesto: **no verificado en hardware** todavía; la UI lo muestra así.

## Seguridad y límites

- Solo acepta peticiones desde loopback o rangos privados.
- No inicia sesión en routers ni guarda contraseñas.
- No envía telemetría. Todo se guarda en `data/state.json`.
- La MAC completa se queda en el agente; la UI solo muestra el prefijo OUI.
- Windows no reporta el ancho de canal: la recomendación de 5 GHz razona por bloques de 80 MHz y lo advierte.
- Descubrir un equipo no implica medir su tráfico ni poder bloquearlo.

## Estructura

```
netpilot/
  agent/
    index.mjs      HTTP, SSE, API, trabajos
    net.mjs        interfaces, ARP, ping, traceroute
    discovery.mjs  barrido, SSDP, fingerprint
    wifi.mjs       enlace, vecinos, canales
    router.mjs     gateway, ONT, capacidades
    speed.mjs      latencia, DNS, velocidad
    store.mjs      estado local
    oui.mjs        base de fabricantes
  public/          PWA (HTML, CSS, JS, service worker)
  data/            estado y caché OUI (se crea sola)
```

## API

`GET /api/bootstrap` · `GET /api/devices` · `POST /api/scan` · `POST /api/tests/{latency,dns,speed}` ·
`GET /api/wifi` · `GET /api/router` · `GET /api/events` (SSE) · `GET /api/jobs/:id`

## Limitaciones conocidas

- **Prueba de velocidad:** usa `speed.cloudflare.com` con 3 flujos de 8 MB. Cloudflare puede limitar la descarga tras varias pruebas seguidas; cuando detecta subida > 2× bajada, la app lo advierte en vez de ocultarlo. Es una medición puntual, no un benchmark certificado.
- **Latencia "en reposo" vs "bajo carga":** en este enlace mesh la latencia periódica es peor que la de tráfico continuo (ahorro de energía del punto de acceso). La app mide la base con pings consecutivos para que el bufferbloat tenga sentido.
- **Android:** hoy es PWA (se instala desde el navegador). La app nativa queda para la fase 2.
- **Windows:** el agente corre en consola. Servicio + bandeja e instalador quedan pendientes.
- **Sin escritura:** no bloquea, no cambia SSID ni aplica QoS.

## Siguiente fase

1. Adaptador MikroTik (lectura REST) y OpenWrt (ubus).
2. Empaquetado como servicio de Windows con bandeja.
3. App Android nativa (hoy la PWA cubre lectura desde el móvil).
4. Bloqueo y QoS solo donde exista API documentada.
