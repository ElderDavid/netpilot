<#
.SYNOPSIS
  Icono de bandeja de NetPilot: Abrir panel, Reiniciar agente, Ver registro y Salir.

.DESCRIPTION
  Usa System.Windows.Forms.NotifyIcon (incluido en .NET Framework de Windows). Sin dependencias.
  El icono indica el estado: verde = el agente responde, rojo = no responde, gris = comprobando.
  "Salir" cierra solo la bandeja; el agente sigue en segundo plano (lo gestiona la tarea programada).
  Una sola instancia por sesión. No necesita privilegios de administrador.
#>
[CmdletBinding()]
param(
  [ValidateRange(1, 65535)][int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\NetPilotTray', [ref]$created)
if (-not $created) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$panelUrl = "http://localhost:$Port/"

function New-DotIcon {
  param([System.Drawing.Color]$Color)
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush $Color
  $g.FillEllipse($brush, 1, 1, 14, 14)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, 255, 255, 255)), 1.5
  $g.DrawEllipse($pen, 1, 1, 14, 14)
  $brush.Dispose(); $pen.Dispose(); $g.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $bmp.Dispose()
  return $icon
}

$icons = @{
  ok      = New-DotIcon ([System.Drawing.Color]::FromArgb(34, 197, 94))
  down    = New-DotIcon ([System.Drawing.Color]::FromArgb(239, 68, 68))
  pending = New-DotIcon ([System.Drawing.Color]::FromArgb(148, 163, 184))
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icons.pending
$tray.Text = 'NetPilot — comprobando…'
$tray.Visible = $true

function Update-Status {
  if (Test-NetPilotAgent -Port $Port -TimeoutMs 1500) {
    $tray.Icon = $icons.ok
    $tray.Text = "NetPilot — agente activo (puerto $Port)"
  } else {
    $tray.Icon = $icons.down
    $tray.Text = 'NetPilot — el agente no responde'
  }
}

function Open-Panel { Start-Process $panelUrl }

function Restart-Agent {
  $tray.Icon = $icons.pending
  $tray.Text = 'NetPilot — reiniciando…'
  $runner = @(Get-NetPilotScriptProcess -ScriptName 'run-agent.ps1')
  if ($runner.Count -gt 0) {
    # El supervisor relanza node en cuanto termina.
    Get-NetPilotAgentProcess | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-NetPilotLog '[tray] reinicio solicitado desde la bandeja'
  } else {
    try {
      Start-ScheduledTask -TaskPath $NetPilotTaskPath -TaskName $NetPilotTaskAgent
    } catch {
      $tray.ShowBalloonTip(5000, 'NetPilot', 'No se pudo iniciar la tarea del agente. Revisa la instalación (docs/instalacion.md).', [System.Windows.Forms.ToolTipIcon]::Error)
      return
    }
  }
  $tray.ShowBalloonTip(3000, 'NetPilot', 'Reiniciando el agente…', [System.Windows.Forms.ToolTipIcon]::Info)
}

function Open-Log {
  if (Test-Path -LiteralPath $NetPilotLogFile) {
    Start-Process -FilePath "$env:SystemRoot\System32\notepad.exe" -ArgumentList ('"{0}"' -f $NetPilotLogFile)
  } else {
    $tray.ShowBalloonTip(4000, 'NetPilot', 'Todavía no hay registro. Se crea cuando el agente arranca como tarea.', [System.Windows.Forms.ToolTipIcon]::Warning)
  }
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemOpen = $menu.Items.Add('Abrir panel')
$itemOpen.Font = New-Object System.Drawing.Font($itemOpen.Font, [System.Drawing.FontStyle]::Bold)
$itemRestart = $menu.Items.Add('Reiniciar agente')
$itemLog = $menu.Items.Add('Ver registro')
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$itemExit = $menu.Items.Add('Salir')

$itemOpen.add_Click({ Open-Panel })
$itemRestart.add_Click({ Restart-Agent })
$itemLog.add_Click({ Open-Log })
$itemExit.add_Click({ [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu
$tray.add_MouseDoubleClick({ Open-Panel })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 10000
$timer.add_Tick({ Update-Status })
$timer.Start()
Update-Status

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  $timer.Stop()
  $tray.Visible = $false
  $tray.Dispose()
  foreach ($i in $icons.Values) { $i.Dispose() }
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
