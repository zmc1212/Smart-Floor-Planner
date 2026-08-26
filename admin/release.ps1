[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$imageName = 'zmc1212/sfp-admin:latest'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseRoot = Join-Path $scriptDir 'release'
$packageDir = Join-Path $releaseRoot 'sfp-admin-release'
$packageZip = Join-Path $releaseRoot 'sfp-admin-release.zip'
$pushSucceeded = $false

function New-ForwardSlashZip {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$ZipPath
  )

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $sourceRoot = (Resolve-Path -LiteralPath $SourceDir).Path
  $baseName = Split-Path -Leaf $sourceRoot

  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }

  $archive = [System.IO.Compression.ZipFile]::Open(
    $ZipPath,
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
      $relative = $_.FullName.Substring($sourceRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
      $entryName = "$baseName/$relative"
      $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $entryStream = $entry.Open()
      try {
        $fileStream = [System.IO.File]::OpenRead($_.FullName)
        try {
          $fileStream.CopyTo($entryStream)
        } finally {
          $fileStream.Dispose()
        }
      } finally {
        $entryStream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop is not available. Start Docker Desktop and try again.'
}

$envProductionPath = Join-Path $scriptDir '.env.production'
if (-not (Test-Path -LiteralPath $envProductionPath)) {
  throw 'Missing admin/.env.production. Create it from .env.example before packaging.'
}

Push-Location $scriptDir
try {
  Write-Host "[1/4] Building $imageName without Docker cache..."
  & docker build --no-cache -t $imageName .
  if ($LASTEXITCODE -ne 0) { throw "Docker image build failed with exit code $LASTEXITCODE." }

  Write-Host '[2/5] Pushing the image to Docker Hub...'
  & docker push $imageName
  if ($LASTEXITCODE -eq 0) {
    $pushSucceeded = $true
    Write-Host '[OK] Docker Hub push completed.'
  } else {
    Write-Warning 'Docker Hub push failed. The local offline package will still be created.'
    Write-Warning 'Check docker login status and network access if the server should pull from Docker Hub.'
  }

  Write-Host '[3/5] Preparing the offline deployment package...'
  Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $packageZip -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path (Join-Path $packageDir 'docker\postgres\init') -Force | Out-Null
  Copy-Item -LiteralPath 'deploy.sh', 'docker-compose.yml', '.env.production' -Destination $packageDir
  Copy-Item -LiteralPath 'docker\postgres\init\001-roles.sql' -Destination (Join-Path $packageDir 'docker\postgres\init')
  Copy-Item -LiteralPath 'drizzle' -Destination $packageDir -Recurse

  Copy-Item -LiteralPath (Join-Path $scriptDir 'auto_deploy.sh') -Destination (Join-Path $releaseRoot 'auto_deploy.sh') -Force

  @'
Smart Floor Planner Admin offline deployment package

One-click (recommended):
1. Upload sfp-admin-release.zip to the server directory (for example /datas/smartfloor).
2. First time only: also upload auto_deploy.sh to that same directory, then:
   chmod +x auto_deploy.sh
3. Every release after the ZIP is uploaded:
   ./auto_deploy.sh

auto_deploy.sh unzips with overwrite (no "replace? [A]" prompt), chmod +x
deploy.sh, and runs it.

Manual fallback:
1. unzip -o sfp-admin-release.zip
2. cd sfp-admin-release
3. chmod +x deploy.sh && ./deploy.sh

This package already includes the build machine's .env.production.
The Docker image is stored in sfp-admin.tar. deploy.sh loads it before starting
the PostgreSQL migration and admin service. Do not run docker compose down -v
unless deleting the PostgreSQL data volume is intentional.
'@ | Set-Content -LiteralPath (Join-Path $packageDir 'README.txt') -Encoding utf8

  Write-Host '[4/5] Exporting the Docker image...'
  & docker save --output (Join-Path $packageDir 'sfp-admin.tar') $imageName
  if ($LASTEXITCODE -ne 0) { throw "Docker image export failed with exit code $LASTEXITCODE." }

  Write-Host 'Verifying the exported image prerequisites...'
  & docker run --rm --entrypoint sh $imageName -c 'test -f /app/scripts/postgres-migrate.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'The built image is missing /app/scripts/postgres-migrate.mjs.' }

  $imageId = (& docker image inspect $imageName --format '{{.Id}}').Trim()
  $tarHash = (Get-FileHash -LiteralPath (Join-Path $packageDir 'sfp-admin.tar') -Algorithm SHA256).Hash.ToLowerInvariant()
  @(
    "# Image: $imageName",
    "# Image ID: $imageId",
    "# Built at: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss K'))",
    "$tarHash  sfp-admin.tar"
  ) | Set-Content -LiteralPath (Join-Path $packageDir 'SHA256SUMS') -Encoding ascii

  Write-Host '[5/5] Creating the ZIP release package...'
  New-ForwardSlashZip -SourceDir $packageDir -ZipPath $packageZip

  Write-Host ''
  Write-Host '================================================================'
  Write-Host '[SUCCESS] Release package created:'
  Write-Host $packageZip
  Write-Host "[INFO] Image ID: $imageId"
  Write-Host "[INFO] sfp-admin.tar SHA-256: $tarHash"
  Write-Host '[INFO] Included local .env.production in the package.'
  if ($pushSucceeded) {
    Write-Host '[SUCCESS] Docker Hub image updated: zmc1212/sfp-admin:latest'
  } else {
    Write-Host '[WARNING] Docker Hub image was not updated; use the included sfp-admin.tar on the server.'
  }
  Write-Host ''
  Write-Host 'First time: upload auto_deploy.sh next to the ZIP, then chmod +x auto_deploy.sh'
  Write-Host 'Every release: upload the ZIP and run ./auto_deploy.sh'
  Write-Host '================================================================'
} finally {
  Pop-Location
}
