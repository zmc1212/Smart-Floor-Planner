$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'D:\XiaoK-Embedding'
New-Item -ItemType Directory -Force $root | Out-Null
$installer = Join-Path $root 'python-3.11.9-amd64.exe'
if (!(Test-Path "$root\python\python.exe")) {
    Invoke-WebRequest -UseBasicParsing 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' -OutFile $installer
    if ((Get-AuthenticodeSignature $installer).Status -ne 'Valid') { throw 'Python installer signature invalid' }
    $p = Start-Process $installer -ArgumentList '/quiet', 'InstallAllUsers=0', "TargetDir=$root\python", 'PrependPath=0', 'Include_test=0', 'Include_launcher=0' -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Python installer exit $($p.ExitCode)" }
}
if (!(Test-Path "$root\venv\Scripts\python.exe")) { & "$root\python\python.exe" -m venv "$root\venv" }
& "$root\venv\Scripts\python.exe" -m pip install --disable-pip-version-check torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124
if ($LASTEXITCODE -ne 0) { throw 'torch installation failed' }
$requirements = if (Test-Path "$root\requirements-lock.txt") { "$root\requirements-lock.txt" } else { "$root\requirements.txt" }
& "$root\venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'service dependencies installation failed' }
& "$root\venv\Scripts\python.exe" "$root\download_model.py"
if ($LASTEXITCODE -ne 0) { throw 'model download failed' }
& "$root\venv\Scripts\python.exe" -m pip freeze | Set-Content -Encoding utf8 "$root\installed-lock.txt"
Write-Output 'BOOTSTRAP_COMPLETE'
