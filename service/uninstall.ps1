<#
.SYNOPSIS
  Desinstala NetPilot del inicio de Windows. Requiere administrador.

.DESCRIPTION
  Detiene el agente y la bandeja, elimina las tareas "\NetPilot\*", la carpeta de tareas,
  las reglas de firewall del grupo "NetPilot" y los accesos directos del menú Inicio.
  Conserva data\ (inventario, historial, registro) salvo que se pase -PurgeData.
  No borra el código del proyecto ni desinstala Node.js. Usa -WhatIf para ver qué haría.

.PARAMETER PurgeData
  Borra también la carpeta data\ (estado, historial, caché OUI y registros). No se puede deshacer.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File service\uninstall.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File service\uninstall.ps1 -PurgeData
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

function Write-Step { param([string]$Text) Write-Host "==> $Text" -ForegroundColor Cyan }

if (-not (Test-NetPilotAdmin)) {
  Write-Host 'ERROR: el desinstalador necesita permisos de administrador. Abre PowerShell con "Ejecutar como administrador".' -ForegroundColor Red
  exit 1
}

# 1. Tareas: detener y eliminar ------------------------------------------------------------------
$tasks = @(Get-ScheduledTask -TaskPath $NetPilotTaskPath -ErrorAction SilentlyContinue)
foreach ($t in $tasks) {
  if ($PSCmdlet.ShouldProcess("$($t.TaskPath)$($t.TaskName)", 'Detener y eliminar tarea')) {
    Write-Step "Eliminando tarea $($t.TaskPath)$($t.TaskName)"
    Stop-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName -Confirm:$false
  }
}
# Carpeta vacía \NetPilot\ (Register-ScheduledTask la crea; Unregister no la borra).
if ($PSCmdlet.ShouldProcess($NetPilotTaskPath, 'Eliminar carpeta de tareas')) {
  try {
    $svc = New-Object -ComObject Schedule.Service
    $svc.Connect()
    $svc.GetFolder('\').DeleteFolder($NetPilotTaskPath.Trim('\'), 0)
  } catch { }  # no existe o no está vacía: se informa en la verificación final
}

# 2. Procesos que sigan vivos (supervisor, bandeja, node de esta carpeta) ------------------------
$procs = @()
$procs += @(Get-NetPilotScriptProcess -ScriptName 'run-agent.ps1')
$procs += @(Get-NetPilotScriptProcess -ScriptName 'tray.ps1')
$procs += @(Get-NetPilotAgentProcess)
foreach ($p in $procs) {
  if ($PSCmdlet.ShouldProcess("$($p.Name) (PID $($p.ProcessId))", 'Detener proceso')) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
if ($procs.Count -gt 0) { Write-Step "Detenidos $($procs.Count) proceso(s) de NetPilot" }

# 3. Firewall -------------------------------------------------------------------------------------
$rules = @(Get-NetFirewallRule -Group $NetPilotFwGroup -ErrorAction SilentlyContinue)
if ($rules.Count -gt 0 -and $PSCmdlet.ShouldProcess("grupo '$NetPilotFwGroup' ($($rules.Count) regla/s)", 'Eliminar reglas de firewall')) {
  Write-Step 'Eliminando reglas de firewall de NetPilot'
  $rules | Remove-NetFirewallRule
}

# 4. Accesos directos -----------------------------------------------------------------------------
if ((Test-Path -LiteralPath $NetPilotStartMenu) -and $PSCmdlet.ShouldProcess($NetPilotStartMenu, 'Eliminar accesos directos')) {
  Write-Step 'Eliminando accesos directos del menú Inicio'
  Remove-Item -LiteralPath $NetPilotStartMenu -Recurse -Force
}

# 5. Datos ----------------------------------------------------------------------------------------
if ($PurgeData) {
  if ((Test-Path -LiteralPath $NetPilotDataDir) -and $PSCmdlet.ShouldProcess($NetPilotDataDir, 'Borrar datos (inventario, historial, registros)')) {
    Write-Step "Borrando $NetPilotDataDir"
    Remove-Item -LiteralPath $NetPilotDataDir -Recurse -Force
  }
} elseif (Test-Path -LiteralPath $NetPilotDataDir) {
  Write-Host "  Se conservan los datos en $NetPilotDataDir (usa -PurgeData para borrarlos)."
}

if ($WhatIfPreference) { exit 0 }

# 6. Verificación ---------------------------------------------------------------------------------
$left = @()
if (@(Get-ScheduledTask -TaskPath $NetPilotTaskPath -ErrorAction SilentlyContinue).Count -gt 0) { $left += 'tareas programadas' }
if (@(Get-NetFirewallRule -Group $NetPilotFwGroup -ErrorAction SilentlyContinue).Count -gt 0) { $left += 'reglas de firewall' }
if (Test-Path -LiteralPath $NetPilotStartMenu) { $left += 'accesos directos' }
if (@(Get-NetPilotAgentProcess).Count -gt 0) { $left += 'proceso node del agente' }
if ($PurgeData -and (Test-Path -LiteralPath $NetPilotDataDir)) { $left += 'carpeta data' }

Write-Host ''
if ($left.Count -eq 0) {
  Write-Host 'NetPilot se desinstaló del inicio de Windows. No quedan tareas, reglas ni accesos directos.' -ForegroundColor Green
} else {
  Write-Warning ("Quedaron elementos: {0}. Revisa los mensajes anteriores." -f ($left -join ', '))
  exit 1
}
Write-Host 'Nota: si alguna vez aceptaste el aviso del firewall de Windows para node.exe, esa regla la creó Windows (no NetPilot) y no se toca.'
