<#
.SYNOPSIS
  Supervisor del agente NetPilot. Lo lanza la tarea programada "\NetPilot\Agente" al iniciar sesión.

.DESCRIPTION
  Ejecuta `node agent\index.mjs` sin ventana, con el directorio de trabajo en la raíz del proyecto,
  envía stdout/stderr a data\logs\agent.log y lo reinicia si termina (espera creciente de 2 s a 60 s;
  vuelve a 2 s si el agente llevaba más de 60 s vivo). Una sola instancia por sesión.
  No necesita privilegios de administrador.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$NodePath,
  [ValidateRange(1, 65535)][int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\NetPilotAgentRunner', [ref]$created)
if (-not $created) { exit 0 }  # ya hay un supervisor en esta sesión

if (-not (Test-Path -LiteralPath $NodePath)) {
  Write-NetPilotLog "[runner] no se encontró Node en la ruta registrada; reinstala con service\install.ps1"
  exit 2
}

$env:PORT = [string]$Port
$maxLogBytes = 5MB
$delay = 2

try {
  while ($true) {
    if ((Test-Path $NetPilotLogFile) -and ((Get-Item $NetPilotLogFile).Length -gt $maxLogBytes)) {
      Move-Item -LiteralPath $NetPilotLogFile -Destination (Join-Path $NetPilotLogDir 'agent.1.log') -Force
    }
    Write-NetPilotLog "[runner] iniciando agente en el puerto $Port"

    $started = Get-Date
    # cmd.exe solo redirige la salida (append, bytes tal cual). /s conserva las comillas internas.
    $cmdArgs = '/d /s /c ""{0}" "{1}" >> "{2}" 2>&1"' -f $NodePath, $NetPilotEntry, $NetPilotLogFile
    $proc = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList $cmdArgs `
      -WorkingDirectory $NetPilotRoot -WindowStyle Hidden -PassThru -Wait
    $alive = [int]((Get-Date) - $started).TotalSeconds

    Write-NetPilotLog ("[runner] el agente terminó (código {0}) tras {1} s" -f $proc.ExitCode, $alive)
    if ($alive -gt 60) { $delay = 2 } else { $delay = [Math]::Min($delay * 2, 60) }
    Write-NetPilotLog "[runner] reinicio en $delay s"
    Start-Sleep -Seconds $delay
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
