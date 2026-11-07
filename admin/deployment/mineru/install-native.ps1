param([string]$Root = 'D:/Smart-Floor-Planner-Dev/mineru-pilot')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
if ($rootPath -ne 'D:\Smart-Floor-Planner-Dev\mineru-pilot') { throw 'Unexpected dedicated MinerU root' }
$mineruVersion = '4.1.7'
$pythonVersion = '3.12.10'
$receiptPath = Join-Path $rootPath 'installation.json'
if (Test-Path -LiteralPath $receiptPath) { throw 'Retained installation exists; inspect before upgrading' }
New-Item -ItemType Directory -Path $rootPath -Force | Out-Null
$downloadDir = Join-Path $rootPath 'downloads'
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
$installer = Join-Path $downloadDir "python-$pythonVersion-amd64.exe"
if (!(Test-Path -LiteralPath $installer)) {
    & curl.exe --fail --location --connect-timeout 8 --max-time 120 --output $installer "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-amd64.exe"
    if ($LASTEXITCODE -ne 0) { throw 'Official Python download failed; retain the partial file for inspection' }
}
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
    throw 'Official Python installer signature verification failed'
}
$pythonDir = Join-Path $rootPath "python/$pythonVersion"
Write-Output 'VERIFIED_OFFICIAL_PYTHON_SIGNATURE'
if (!(Test-Path -LiteralPath (Join-Path $pythonDir 'python.exe'))) {
    $setup = Start-Process -FilePath $installer -WindowStyle Hidden -PassThru -Wait -ArgumentList @(
        '/quiet','InstallAllUsers=0',"TargetDir=$pythonDir",'PrependPath=0','AppendPath=0',
        'AssociateFiles=0','Shortcuts=0','Include_launcher=0','InstallLauncherAllUsers=0',
        'Include_test=0','Include_doc=0','Include_tools=0','Include_pip=1'
    )
    if ($setup.ExitCode -notin @(0,3010)) { throw "Dedicated Python installer failed: $($setup.ExitCode)" }
}
$basePython = Join-Path $pythonDir 'python.exe'
Write-Output 'DEDICATED_PYTHON_READY'
$env:PIP_CACHE_DIR = Join-Path $rootPath 'cache/pip'
$env:MINERU_HOME = Join-Path $rootPath 'state'
$env:MINERU_TELEMETRY_DISABLED = '1'
$env:MODELSCOPE_CACHE = Join-Path $rootPath 'cache/modelscope'
$env:HF_HOME = Join-Path $rootPath 'cache/huggingface'
$venvPath = Join-Path $rootPath '.venv'
if (!(Test-Path -LiteralPath (Join-Path $venvPath 'pyvenv.cfg'))) {
    & $basePython -m venv $venvPath
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated virtual environment failed' }
}
$python = Join-Path $venvPath 'Scripts/python.exe'
Write-Output 'INSTALLING_MINERU_PINNED_4_1_7'
& $python -m pip install --disable-pip-version-check --index-url https://mirrors.aliyun.com/pypi/simple "mineru==$mineruVersion"
if ($LASTEXITCODE -ne 0) { throw 'MinerU installation failed' }
& $python -m pip freeze | Set-Content -LiteralPath (Join-Path $rootPath 'requirements.lock.txt') -Encoding UTF8
if ($LASTEXITCODE -ne 0) { throw 'Dependency snapshot failed' }
$versionJson = & (Join-Path $venvPath 'Scripts/mineru.exe') version --json
if ($LASTEXITCODE -ne 0) { throw 'MinerU version verification failed' }
$versionJson | Set-Content -LiteralPath (Join-Path $rootPath 'version.json') -Encoding UTF8
[pscustomobject]@{
    mineruVersion = $mineruVersion; pythonInstallerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    pythonSigner = $signature.SignerCertificate.Subject
    pythonVersion = $pythonVersion; root = $rootPath; installedAt = (Get-Date).ToUniversalTime().ToString('o')
    scope = 'Dedicated on-demand parser; no global PATH, Python, Docker or customer knowledge change'
    installerSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
    dependenciesSha256 = (Get-FileHash -LiteralPath (Join-Path $rootPath 'requirements.lock.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
Write-Output 'MINERU_INSTALLATION_VERIFIED'
