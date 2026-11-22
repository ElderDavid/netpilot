<#
.SYNOPSIS
  Instala NetPilot para que arranque solo al iniciar sesión en Windows. Requiere administrador.

.DESCRIPTION
  1. Registra la tarea programada "\NetPilot\Agente" (al iniciar sesión del usuario, sin ventana,
     reinicio automático) que ejecuta service\run-agent.ps1 -> node agent\index.mjs.
  2. Registra "\NetPilot\Bandeja" (icono de bandeja al iniciar sesión).
  3. Pregunta si crear la regla de firewall de entrada TCP <Port> solo en redes privadas.
  4. Crea accesos directos en el menú Inicio (todos los usuarios): panel y bandeja.
  5. Arranca ambas tareas y comprueba que el agente responde.
  Es idempotente: volver a ejecutarlo reemplaza lo anterior. Usa -WhatIf para ver qué haría.

.PARAMETER Port
  Puerto HTTP del agente. Por defecto 8787.
.PARAMETER Firewall
  Ask (por defecto) pregunta; Yes crea la regla sin preguntar; No no la crea.
.PARAMETER NodePath
  Ruta a node.exe. Por defecto, el que esté en el PATH.
.PARAMETER User
  Cuenta (DOMINIO\usuario) para la que se registran las tareas. Por defecto, la del usuario con
  sesión abierta en la consola (no la de administrador que eleva, si son distintas).
.PARAMETER NoTray
  No registra la tarea de la bandeja ni su acceso directo.
.PARAMETER NoStart
  Registra todo pero no arranca las tareas ahora.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File service\install.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateRange(1, 65535)][int]$Port = 8787,
  [ValidateSet('Ask', 'Yes', 'No')][string]$Firewall = 'Ask',
  [string]$NodePath,
  [string]$User,
  [switch]$NoTray,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

function Write-Step { param([string]$Text) Write-Host "==> $Text" -ForegroundColor Cyan }
function Fail { param([string]$Text) Write-Host "ERROR: $Text" -ForegroundColor Red; exit 1 }

# --- Comprobaciones ---------------------------------------------------------------------------
if (-not (Test-NetPilotAdmin)) {
  Fail 'Este instalador necesita permisos de administrador. Abre PowerShell con "Ejecutar como administrador" y vuelve a intentarlo.'
}
if (-not (Test-Path -LiteralPath $NetPilotEntry)) { Fail "No se encontró $NetPilotEntry. Ejecuta el script desde la carpeta service del proyecto." }

$pf = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
foreach ($dir in $pf) {
  if ($NetPilotRoot.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Warning "El proyecto está dentro de '$dir'. El agente corre sin privilegios y puede no poder escribir en data\. Recomendado: una carpeta del usuario (p. ej. Documentos\netpilot)."
  }
}

if (-not $NodePath) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { Fail 'No se encontró node.exe en el PATH. Instala Node.js 22 o superior, o indica -NodePath.' }
  $NodePath = $cmd.Source
}
if (-not (Test-Path -LiteralPath $NodePath)) { Fail "No existe $NodePath" }
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$nodeVersion = (& $NodePath --version).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt $NetPilotMinNode) {
  Fail "Se requiere Node.js $NetPilotMinNode o superior; encontrado $nodeVersion en $NodePath."
}

if (-not $User) {
  $User = (Get-CimInstance Win32_ComputerSystem).UserName
  if (-not $User) { $User = "$env:USERDOMAIN\$env:USERNAME" }
}

Write-Host ''
Write-Host 'NetPilot — instalación' -ForegroundColor White
Write-Host "  Proyecto : $NetPilotRoot"
Write-Host "  Node     : $NodePath ($nodeVersion)"
Write-Host "  Usuario  : $User"
Write-Host "  Puerto   : $Port"
Write-Host ''

if (Get-NetPilotAgentProcess) {
  Write-Warning 'Ya hay un agente de esta carpeta en ejecución (p. ej. run.cmd). Ciérralo para que la tarea pueda usar el puerto.'
}

# --- Tareas programadas -----------------------------------------------------------------------
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited

$agentArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -NodePath "{1}" -Port {2}' -f `
  (Join-Path $PSScriptRoot 'run-agent.ps1'), $NodePath, $Port
$agentAction = New-ScheduledTaskAction -Execute $psExe -Argument $agentArgs -WorkingDirectory $NetPilotRoot
# Sin límite de duración; si el supervisor mismo falla, el Programador lo reintenta 3 veces cada minuto.
$agentSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

if ($PSCmdlet.ShouldProcess("$NetPilotTaskPath$NetPilotTaskAgent", 'Registrar tarea programada')) {
  Write-Step "Registrando tarea $NetPilotTaskPath$NetPilotTaskAgent"
  Register-ScheduledTask -TaskPath $NetPilotTaskPath -TaskName $NetPilotTaskAgent -Action $agentAction `
    -Trigger $trigger -Principal $principal -Settings $agentSettings -Force `
    -Description 'NetPilot: agente local de diagnóstico Wi-Fi (solo lectura). Se instala con service\install.ps1.' | Out-Null
}

if (-not $NoTray) {
  $trayArgs = '-NoProfile -NonInteractive -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Port {1}' -f `
    (Join-Path $PSScriptRoot 'tray.ps1'), $Port
  $trayAction = New-ScheduledTaskAction -Execute $psExe -Argument $trayArgs -WorkingDirectory $NetPilotRoot
  $traySettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  if ($PSCmdlet.ShouldProcess("$NetPilotTaskPath$NetPilotTaskTray", 'Registrar tarea programada')) {
    Write-Step "Registrando tarea $NetPilotTaskPath$NetPilotTaskTray"
    Register-ScheduledTask -TaskPath $NetPilotTaskPath -TaskName $NetPilotTaskTray -Action $trayAction `
      -Trigger $trigger -Principal $principal -Settings $traySettings -Force `
      -Description 'NetPilot: icono de bandeja.' | Out-Null
  }
}

# --- Firewall ---------------------------------------------------------------------------------
$createRule = $false
switch ($Firewall) {
  'Yes' { $createRule = $true }
  'No'  { $createRule = $false }
  'Ask' {
    Write-Host ''
    Write-Host "Para abrir el panel desde el móvil u otro equipo de tu red, hace falta permitir la entrada TCP $Port."
    Write-Host 'La regla aplica SOLO a redes privadas (no públicas ni de dominio) y SOLO a este node.exe.'
    $answer = Read-Host '¿Crear la regla de firewall? [s/N]'
    $createRule = ($answer -match '^(s|si|sí|y|yes)$')
  }
}
# Siempre se eliminan primero las reglas previas de NetPilot (instalación idempotente).
$oldRules = @(Get-NetFirewallRule -Group $NetPilotFwGroup -ErrorAction SilentlyContinue)
if ($oldRules.Count -gt 0 -and $PSCmdlet.ShouldProcess("grupo '$NetPilotFwGroup'", 'Eliminar reglas de firewall anteriores')) {
  $oldRules | Remove-NetFirewallRule
}
if ($createRule) {
  if ($PSCmdlet.ShouldProcess("TCP $Port (privada)", 'Crear regla de firewall')) {
    Write-Step "Creando regla de firewall (TCP $Port, solo redes privadas)"
    New-NetFirewallRule -DisplayName "NetPilot agente (TCP $Port, redes privadas)" -Group $NetPilotFwGroup `
      -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private -Program $NodePath `
      -Description 'Creada por NetPilot service\install.ps1. Se elimina con service\uninstall.ps1.' | Out-Null
  }
} else {
  Write-Host '  Sin regla de firewall: el panel funcionará en este equipo (localhost).'
}

# --- Accesos directos -------------------------------------------------------------------------
if ($PSCmdlet.ShouldProcess($NetPilotStartMenu, 'Crear accesos directos del menú Inicio')) {
  Write-Step 'Creando accesos directos en el menú Inicio'
  New-Item -ItemType Directory -Path $NetPilotStartMenu -Force | Out-Null
  $urlFile = Join-Path $NetPilotStartMenu 'NetPilot (panel).url'
  $urlContent = "[InternetShortcut]`r`nURL=http://localhost:$Port/`r`n"
  [System.IO.File]::WriteAllText($urlFile, $urlContent, [System.Text.Encoding]::ASCII)
  if (-not $NoTray) {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path $NetPilotStartMenu 'NetPilot (bandeja).lnk'))
    $lnk.TargetPath = $psExe
    $lnk.Arguments = $trayArgs
    $lnk.WorkingDirectory = $NetPilotRoot
    $lnk.WindowStyle = 7  # minimizada
    $lnk.Description = 'Icono de bandeja de NetPilot'
    $lnk.Save()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
  }
}

# --- Arranque y verificación ------------------------------------------------------------------
if ($NoStart -or $WhatIfPreference) {
  Write-Host ''
  Write-Host 'Listo. Las tareas arrancarán en el próximo inicio de sesión.' -ForegroundColor Green
  exit 0
}

Write-Step 'Arrancando el agente'
try {
  Start-ScheduledTask -TaskPath $NetPilotTaskPath -TaskName $NetPilotTaskAgent
  if (-not $NoTray) { Start-ScheduledTask -TaskPath $NetPilotTaskPath -TaskName $NetPilotTaskTray }
} catch {
  Write-Warning "No se pudo arrancar ahora ($($_.Exception.Message)). Arrancará al iniciar sesión $User."
}

$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
  Start-Sleep -Seconds 1
  $ok = Test-NetPilotAgent -Port $Port
}
Write-Host ''
if ($ok) {
  Write-Host "Listo. El agente responde en http://localhost:$Port/" -ForegroundColor Green
} else {
  Write-Warning "El agente aún no responde en el puerto $Port. Revisa $NetPilotLogFile (o la bandeja > Ver registro)."
  Write-Warning "Si instalaste para otra cuenta ($User), arrancará cuando esa cuenta inicie sesión."
}
Write-Host 'Desinstalar: service\uninstall.ps1 (como administrador). Detalles: docs\instalacion.md'
