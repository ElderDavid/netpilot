# Instalación en Windows (arranque automático + bandeja)

> Estado: scripts escritos y revisados, **no ejecutados en Windows todavía** (se escribieron en un
> entorno Linux sin PowerShell). Ver «Qué falta verificar» al final.

Con esto NetPilot arranca solo al iniciar sesión, sin consola, y se administra desde un icono en la
bandeja. Todo queda en tu equipo; no se instala nada de Internet.

## Requisitos

- Windows 10 u 11 con Windows PowerShell 5.1 (viene incluido).
- Node.js 22 o superior en el `PATH` (`node --version`). Si no está en el `PATH`, usa `-NodePath`.
- Una cuenta con permisos de administrador **solo para instalar y desinstalar**. El agente y la
  bandeja corren después con tu usuario normal, sin privilegios.
- El proyecto en una carpeta tuya (p. ej. `Documentos\netpilot`). Evita `Archivos de programa`:
  el agente necesita escribir en `data\`.

## Instalar

1. Cierra NetPilot si lo tienes abierto con `run.cmd` (ocupa el puerto 8787).
2. Abre **PowerShell como administrador** y ve a la carpeta del proyecto:

   ```powershell
   cd $HOME\Documents\netpilot
   powershell -ExecutionPolicy Bypass -File service\install.ps1
   ```

3. El instalador pregunta si crear la regla de firewall. Responde **s** solo si quieres abrir el
   panel desde el móvil u otro equipo de tu red. La regla:
   - permite entrada TCP 8787 **solo en redes privadas** (no públicas ni de dominio),
   - y **solo para el `node.exe`** detectado.
   Sin regla, el panel funciona igual en este equipo (`http://localhost:8787`).
4. Al terminar debe decir `Listo. El agente responde en http://localhost:8787/` y aparecer un
   punto verde en la bandeja.

`-ExecutionPolicy Bypass` aplica solo a ese proceso: los scripts no están firmados y no se cambia la
política del sistema.

### Opciones

| Parámetro | Qué hace |
|---|---|
| `-Port 8787` | Puerto del agente (las tareas lo pasan como `PORT`). |
| `-Firewall Ask\|Yes\|No` | Preguntar (por defecto), crear o no crear la regla. |
| `-NodePath C:\...\node.exe` | Node a usar si no está en el `PATH` o hay varios. |
| `-User EQUIPO\usuario` | Cuenta para la que se instala. Por defecto, la del usuario con sesión abierta. |
| `-NoTray` | Sin bandeja ni su acceso directo. |
| `-NoStart` | Registra todo pero no arranca ahora. |
| `-WhatIf` | Muestra qué haría sin cambiar nada. |

Volver a ejecutar el instalador reemplaza las tareas y la regla (es idempotente). Si mueves la
carpeta del proyecto o cambias de versión de Node, reinstala.

## Qué instala

| Elemento | Dónde | Detalle |
|---|---|---|
| Tarea `\NetPilot\Agente` | Programador de tareas | Al iniciar sesión tu usuario. Sin ventana. Ejecuta `service\run-agent.ps1`, que lanza `node agent\index.mjs` con el directorio del proyecto y lo **reinicia si se cae** (espera de 2 s a 60 s). Sin límite de duración; si el propio supervisor falla, el Programador lo reintenta 3 veces cada minuto. |
| Tarea `\NetPilot\Bandeja` | Programador de tareas | Al iniciar sesión. Ejecuta `service\tray.ps1`. |
| Regla de firewall (opcional) | Grupo `NetPilot` | Entrada TCP 8787, perfil Privado, programa `node.exe`. |
| Accesos directos | Menú Inicio › NetPilot | «NetPilot (panel)» abre el navegador; «NetPilot (bandeja)» abre la bandeja si la cerraste. |
| Registro | `data\logs\agent.log` | Salida del agente y del supervisor. Rota a `agent.1.log` al superar 5 MB. |

Nada de esto toca `agent/` ni `public/`; el agente sigue siendo el mismo `node agent\index.mjs`.

## Bandeja

Clic derecho sobre el punto de NetPilot:

- **Abrir panel** (o doble clic): abre `http://localhost:8787/`.
- **Reiniciar agente**: detiene el `node` del agente; el supervisor lo relanza en ~2 s. Si el
  supervisor no corre, arranca la tarea `\NetPilot\Agente`.
- **Ver registro**: abre `data\logs\agent.log` en el Bloc de notas.
- **Salir**: cierra **solo la bandeja**. El agente sigue funcionando. Para volver a verla:
  menú Inicio › NetPilot › NetPilot (bandeja).

Color del punto: verde = el agente responde; rojo = no responde; gris = comprobando (cada 10 s).

## Desinstalar

En **PowerShell como administrador**, desde la carpeta del proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File service\uninstall.ps1
```

Elimina las tareas `\NetPilot\*` y su carpeta, detiene el agente y la bandeja, borra las reglas del
grupo `NetPilot` y los accesos directos, y al final verifica que no quede nada. **Conserva `data\`**
(inventario, historial y registros). Para borrarla también:

```powershell
powershell -ExecutionPolicy Bypass -File service\uninstall.ps1 -PurgeData
```

No borra la carpeta del proyecto ni desinstala Node.js. Si alguna vez aceptaste el aviso de firewall
de Windows para `node.exe`, esa regla la creó Windows (no NetPilot) y no se toca: revísala en
*Firewall de Windows › Aplicaciones permitidas* si quieres quitarla.

## Solución de problemas

| Síntoma | Qué revisar |
|---|---|
| Punto rojo en la bandeja | Bandeja › Ver registro. `EADDRINUSE` = otro proceso usa el puerto (¿`run.cmd` abierto?). |
| No arranca al iniciar sesión | `Get-ScheduledTask -TaskPath \NetPilot\ \| Get-ScheduledTaskInfo` (campo `LastTaskResult`). |
| Se ve una consola un instante al iniciar sesión | Esperado: es PowerShell arrancando oculto. |
| El móvil no abre el panel | ¿Creaste la regla? ¿La red de Windows es «Privada»? (*Configuración › Red › Propiedades*). |

## Qué falta verificar (pruebas manuales en Windows)

Aún no se ha probado nada de esto en Windows. Pasos para dejar la evidencia en `docs/estado.md`:

1. `service\install.ps1 -WhatIf` → lista acciones sin cambiar nada.
2. `service\install.ps1` → «Listo. El agente responde…»; `curl.exe -s http://localhost:8787/api/bootstrap` responde JSON.
3. Cerrar sesión y volver a entrar → el agente responde sin abrir consola; punto verde en la bandeja.
4. Bandeja › Abrir panel, Reiniciar agente (el punto vuelve a verde en ≤ 15 s), Ver registro, Salir.
5. Matar `node.exe` desde el Administrador de tareas → vuelve solo en unos segundos (ver registro).
6. Con regla de firewall: abrir `http://<IP-del-PC>:8787` desde el móvil en una red privada.
7. `service\uninstall.ps1` → «No quedan tareas, reglas ni accesos directos»; `data\` sigue ahí.
   Comprobar en el Programador de tareas, en `wf.msc` (grupo NetPilot) y en el menú Inicio.
8. `service\uninstall.ps1 -PurgeData` tras reinstalar → `data\` borrada.
