# NetPilot para Android

Cliente nativo (Kotlin + Jetpack Compose + Material 3) del agente NetPilot. Lee la API local del
agente y, sin agente, muestra solo lo que Android permite medir desde el teléfono.

> **Estado: compila; no probado en un dispositivo.** El 2026-11-22, en Linux con JDK 21, SDK
> Platform 35 y Build-Tools 35.0.0: `./gradlew assembleDebug testDebugUnitTest lintDebug` termina
> sin errores (APK debug de ~10 MB, 19/19 pruebas JVM, Lint sin errores). No se pudo ejecutar en un
> emulador porque el entorno no tiene KVM, así que **pantallas, permisos y uso real en un teléfono
> siguen sin verificar**. Ver «Qué falta verificar».

## Requisitos para compilar

- JDK 17 o superior (Android Studio trae uno).
- Android SDK con **Platform 35** y Build-Tools recientes. Lo más simple: Android Studio
  (Ladybug 2024.2 o más nuevo) → *Open* → carpeta `android/`. Studio crea `local.properties` con
  la ruta del SDK.
- Sin Android Studio: instala las *command-line tools*, define `ANDROID_HOME` y ejecuta
  `sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"`.
- Internet la primera vez: el wrapper descarga Gradle 8.11.1 (con verificación SHA-256) y las
  dependencias desde Google Maven y Maven Central.

## Compilar e instalar

```bash
cd android
./gradlew assembleDebug          # APK en app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest      # pruebas JVM (validación de host, máscaras, parser, estadísticas)
./gradlew installDebug           # con un teléfono conectado por USB (depuración activada)
```

En Windows usa `gradlew.bat` en vez de `./gradlew`.

| Componente | Versión |
|---|---|
| Android Gradle Plugin | 8.7.3 |
| Gradle (wrapper) | 8.11.1 |
| Kotlin + plugin Compose | 2.0.21 |
| Compose BOM | 2024.12.01 |
| minSdk / targetSdk / compileSdk | 26 / 35 / 35 |

Dependencias de ejecución: solo AndroidX (core, activity-compose, lifecycle, Compose/Material 3)
y kotlinx-coroutines. HTTP con `HttpURLConnection` y JSON con `org.json` de la plataforma.

## Uso

1. En el PC, arranca el agente (`node agent/index.mjs` o el servicio de Windows,
   ver `docs/instalacion.md`). Al arrancar imprime `Red: http://192.168.x.x:8787`.
2. Para conectarte desde el teléfono, el PC necesita la regla de firewall para el puerto 8787 en
   redes privadas (el instalador la ofrece).
3. En la app: escribe la IP y el puerto, o pulsa **Buscar** para probar la red /24 del teléfono.
   También puedes elegir **Continuar sin agente**.

## Pantallas

| Pantalla | Con agente | Sin agente |
|---|---|---|
| Conectar | IP/puerto manual; búsqueda en la /24 (TCP + `/manifest.webmanifest`) | — |
| Resumen | Agente, red del PC, equipos, alertas, últimas mediciones, router | Red y Wi-Fi del teléfono |
| Equipos | Lista y detalle con tipo, confianza, **evidencia**, método, IP, TTL, RTT, fechas. MAC solo con prefijo OUI | No disponible: Android 10+ bloquea la tabla ARP |
| Wi-Fi | Enlace y vecinos vistos por el PC, recomendación de canal + Wi-Fi del teléfono | SSID, RSSI, enlace, banda/canal y escaneo del teléfono (requiere permiso de ubicación) |
| Pruebas | Latencia, DNS, velocidad y escaneo como trabajos del agente, con progreso + medición desde el teléfono | TCP al router y HTTPS a `gstatic.com/generate_204` |
| Router | Gateway, ONT, matriz de capacidades con estado y evidencia, estado del acceso administrativo | No disponible |

## Decisiones y límites (declarados)

- **Sin credenciales.** La app no pide, no envía ni guarda contraseñas. La conexión administrativa
  al router (MikroTik/OpenWrt) y el bloqueo quedan en el panel web del agente. Solo se guarda la
  última IP y puerto (`SharedPreferences`).
- **Solo lectura.** La app lanza escaneos y pruebas (POST) pero no cambia nada en la red.
- **Sin MAC completas.** El parser ignora el campo `mac` del agente y usa `macMasked`; los BSSID se
  enmascaran en el teléfono (prefijo OUI + `··`).
- **HTTP sin cifrar solo a la LAN.** El agente sirve HTTP. `network_security_config.xml` permite
  texto plano (Android no filtra por rango de IP ahí) y la app solo se conecta a IPv4 privadas
  (mismo criterio que `isPrivateIp` del agente), `localhost` o `.local` que resuelva a una IP privada.
- **mDNS: no viable hoy.** El agente no anuncia ningún servicio mDNS/DNS-SD, así que `NsdManager`
  no encontraría nada. En su lugar, búsqueda opcional en la /24 (254 conexiones TCP, 32 en paralelo,
  timeout 400 ms). Si el agente llega a anunciar `_netpilot._tcp`, se puede añadir NSD.
- **Latencia sin ICMP.** Android no permite ping a las apps de forma fiable: se mide por conexión
  TCP (cuenta el rechazo RST como ida y vuelta) y por HTTPS. No es comparable 1:1 con el ping del agente.
- **Escaneo Wi-Fi limitado por Android** a 4 escaneos cada 2 minutos; el SSID y los vecinos exigen
  permiso de ubicación y la ubicación encendida.
- **Timeouts:** conexión 4 s; lectura 8–90 s según el endpoint (inspección del router: hasta 90 s).
  Escaneo y velocidad se sondean cada 1 s hasta 3 min. Los errores se muestran en pantalla; si un
  refresco falla, se conservan los últimos datos y se indica su antigüedad.
- El agente expone `GET /api/events` (SSE), que la app no usa todavía: refresca bajo demanda.
- Avisos de Lint que se dejan a propósito: `InsecureBaseConfiguration` (texto plano hacia la LAN,
  explicado arriba), `GradleDependency` (hay versiones más nuevas; se fijaron las verificadas) y
  `ObsoleteSdkInt` en `mipmap-anydpi-v26` (sin el `-v26` aapt2 no encuentra el icono adaptativo).

## Qué falta verificar

1. Instalar el APK en un teléfono (`./gradlew installDebug`) y recorrer todas las pantallas.
2. En un teléfono Android 8 (API 26) y uno 13+ (API 33+): permisos de ubicación/dispositivos Wi-Fi
   cercanos, SSID visible y escaneo.
3. Conexión a un agente real por IP y por «Buscar»; trabajos de escaneo, latencia, DNS y velocidad.
4. Comportamiento con el agente apagado a mitad de una prueba (mensaje de error visible).
5. Iconos y textos en pantallas pequeñas.
