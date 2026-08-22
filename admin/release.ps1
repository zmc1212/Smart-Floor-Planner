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

  @'
Smart Floor Planner Admin offline deployment package

1. Upload this ZIP to the server and unzip it.
2. Enter the extracted sfp-admin-release directory.
3. Run: chmod +x deploy.sh && ./deploy.sh

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
  Compress-Archive -LiteralPath $packageDir -DestinationPath $packageZip -CompressionLevel Optimal

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
  Write-Host 'Upload this ZIP to the server, unzip it,'
  Write-Host 'then run: chmod +x deploy.sh && ./deploy.sh'
  Write-Host '================================================================'
} finally {
  Pop-Location
}
