param(
  [switch]$Setup,
  [string]$PythonExecutable,
  [string]$ListenAddress = '0.0.0.0',
  [int]$Port = 7010
)

$ErrorActionPreference = 'Stop'
$serviceDirectory = $PSScriptRoot
$projectDirectory = Split-Path (Split-Path $serviceDirectory -Parent) -Parent
$servicePython = Join-Path $serviceDirectory '.venv\Scripts\python.exe'

if ($Setup -or !(Test-Path -LiteralPath $servicePython)) {
  if (!$PythonExecutable) {
    $installedPython = Get-Command python -ErrorAction SilentlyContinue
    if ($installedPython) { $PythonExecutable = $installedPython.Source }
    else {
      $PythonExecutable = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    }
  }
  if (!(Test-Path -LiteralPath $PythonExecutable)) {
    throw 'Python 3.12 yolunu -PythonExecutable ile belirt.'
  }
  if (!(Test-Path -LiteralPath $servicePython)) {
    & $PythonExecutable -m venv (Join-Path $serviceDirectory '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python sanal ortamı oluşturulamadı.' }
  }
  & $servicePython -m pip install -r (Join-Path $serviceDirectory 'requirements.txt') --disable-pip-version-check
  if ($LASTEXITCODE -ne 0) { throw 'Mevcut rembg CPU bağımlılıkları kurulamadı.' }
}

# Read only the two settings needed by the existing service, without logging keys.
$settings = @{}
Get-Content -LiteralPath (Join-Path $projectDirectory '.env') | ForEach-Object {
  if ($_ -match '^\s*(EXPO_PUBLIC_SUPABASE_URL|EXPO_PUBLIC_SUPABASE_ANON_KEY)\s*=\s*(.*)$') {
    $settings[$Matches[1]] = $Matches[2].Trim().Trim('"', "'")
  }
}
if (!$settings['EXPO_PUBLIC_SUPABASE_URL'] -or !$settings['EXPO_PUBLIC_SUPABASE_ANON_KEY']) {
  throw 'Mevcut .env dosyasındaki Supabase URL/anon key eksik.'
}
$env:SUPABASE_URL = $settings['EXPO_PUBLIC_SUPABASE_URL']
$env:SUPABASE_ANON_KEY = $settings['EXPO_PUBLIC_SUPABASE_ANON_KEY']
$env:HOST = $ListenAddress
$env:PORT = [string]$Port
$env:OMP_NUM_THREADS = '2'
$env:U2NET_HOME = Join-Path $serviceDirectory '.models'
$env:NUMBA_CACHE_DIR = Join-Path $serviceDirectory '.models\numba-cache'
$env:PYTHONDONTWRITEBYTECODE = '1'
New-Item -ItemType Directory -Path $env:U2NET_HOME -Force | Out-Null
Set-Location -LiteralPath $serviceDirectory
Write-Output "Wardrobe cutout: CPU, $ListenAddress`:$Port"
& $servicePython (Join-Path $serviceDirectory 'server.py')
if ($LASTEXITCODE -ne 0) { throw 'Wardrobe cutout servisi durdu.' }
