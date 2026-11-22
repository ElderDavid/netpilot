# NetPilot — constantes y funciones compartidas por los scripts de service/.
# Se carga con dot-sourcing: . "$PSScriptRoot\common.ps1"
# Compatible con Windows PowerShell 5.1 (incluido en Windows 10/11). Sin módulos externos.

Set-StrictMode -Version 3.0

$script:NetPilotServiceDir = $PSScriptRoot
$script:NetPilotRoot      = Split-Path -Parent $PSScriptRoot
$script:NetPilotEntry     = Join-Path $NetPilotRoot 'agent\index.mjs'
$script:NetPilotDataDir   = Join-Path $NetPilotRoot 'data'
$script:NetPilotLogDir    = Join-Path $NetPilotDataDir 'logs'
$script:NetPilotLogFile   = Join-Path $NetPilotLogDir 'agent.log'
$script:NetPilotTaskPath  = '\NetPilot\'
$script:NetPilotTaskAgent = 'Agente'
$script:NetPilotTaskTray  = 'Bandeja'
$script:NetPilotFwGroup   = 'NetPilot'
$script:NetPilotMinNode   = 22
$script:NetPilotStartMenu = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\NetPilot'

function Get-NetPilotAgentProcess {
  # Procesos node.exe que ejecutan ESTE agente (ruta absoluta en la línea de comandos).
  $needle = $script:NetPilotEntry.ToLowerInvariant()
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) }
}

function Get-NetPilotScriptProcess {
  param([Parameter(Mandatory)][string]$ScriptName)
  # Procesos powershell.exe que ejecutan service\<ScriptName> de esta instalación.
  $needle = (Join-Path $script:NetPilotServiceDir $ScriptName).ToLowerInvariant()
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) }
}

function Test-NetPilotAgent {
  param([int]$Port = 8787, [int]$TimeoutMs = 3000)
  # Comprueba que el servidor HTTP del agente responde (recurso estático, sin efectos).
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/manifest.webmanifest")
    $req.Method = 'GET'
    $req.Timeout = $TimeoutMs
    $req.ReadWriteTimeout = $TimeoutMs
    $req.Proxy = $null
    $res = $req.GetResponse()
    $ok = ([int]$res.StatusCode -eq 200)
    $res.Close()
    return $ok
  } catch {
    return $false
  }
}

function Test-NetPilotAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-NetPilotLog {
  param([Parameter(Mandatory)][string]$Message)
  # UTF-8 sin BOM, en el mismo archivo donde node escribe su salida.
  if (-not (Test-Path $script:NetPilotLogDir)) { New-Item -ItemType Directory -Path $script:NetPilotLogDir -Force | Out-Null }
  $line = '{0} {1}{2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message, [Environment]::NewLine
  [System.IO.File]::AppendAllText($script:NetPilotLogFile, $line, (New-Object System.Text.UTF8Encoding $false))
}
