[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [ValidatePattern('^\d{8}-\d{3}$')]
  [string]$Version,
  # Full release validation, including the isolated PostgreSQL suite.
  [switch]$Full,
  # Hotfix path: skip local checks. The image still builds Next.js.
  [switch]$Fast
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Full -and $Fast) {
  throw 'Choose either -Full or -Fast.'
}

$imageRepository = 'zmc1212/sfp-admin'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseRoot = Join-Path $scriptDir 'release'

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host "[RUN] $Description"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

function New-ReleaseVersion {
  $datePrefix = (Get-Date).ToString('yyyyMMdd')
  $highestSequence = 0
  if (Test-Path -LiteralPath $releaseRoot) {
    Get-ChildItem -LiteralPath $releaseRoot -File -Filter "sfp-admin-release-$datePrefix-*.zip" |
      ForEach-Object {
        if ($_.BaseName -match "^sfp-admin-release-$datePrefix-(\d{3})$") {
          $highestSequence = [Math]::Max($highestSequence, [int]$Matches[1])
        }
      }
  }
  return '{0}-{1:D3}' -f $datePrefix, ($highestSequence + 1)
}

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
      $entry = $archive.CreateEntry(
        "$baseName/$relative",
        [System.IO.Compression.CompressionLevel]::Optimal
      )
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

function Write-LfAscii {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string[]]$Lines
  )

  $content = if ($Lines.Count -gt 0) {
    ($Lines -join "`n") + "`n"
  } else {
    ''
  }
  [System.IO.File]::WriteAllText(
    $Path,
    $content,
    [System.Text.Encoding]::ASCII
  )
}

function Write-Sha256Manifest {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string[]]$RelativePaths,
    [Parameter(Mandatory = $true)][string]$OutputPath
  )

  $lines = foreach ($relativePath in $RelativePaths) {
    $absolutePath = Join-Path $Root $relativePath
    if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
      throw "Checksum input is missing: $absolutePath"
    }
    $hash = (Get-FileHash -LiteralPath $absolutePath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($relativePath.Replace('\', '/'))"
  }
  Write-LfAscii -Path $OutputPath -Lines $lines
}

if (-not $Version) {
  $Version = New-ReleaseVersion
}

$imageName = "${imageRepository}:$Version"
$packageDir = Join-Path $releaseRoot 'sfp-admin-release'
$packageZip = Join-Path $releaseRoot "sfp-admin-release-$Version.zip"
$releaseMode = if ($Full) { 'full' } elseif ($Fast) { 'fast' } else { 'standard' }
$postgresTests = 'not_run'

$requiredCommands = @('docker', 'git')
if (-not $Fast) { $requiredCommands += 'npm' }
if ($Full) { $requiredCommands += 'node' }
foreach ($command in $requiredCommands) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is not available on PATH."
  }
}

Push-Location $scriptDir
try {
  Write-Host "Release version: $Version"
  Write-Host "Docker image: $imageName"
  Write-Host "Build mode: $releaseMode"

  Write-Host '[PRECHECK] Checking Docker before the release...'
  & docker info --format '{{.ServerVersion}}'
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker engine is unavailable. Start Docker Desktop, wait for the engine to be ready, then rerun release.bat.'
  }
  if ($Full) {
    Write-Host '[PRECHECK] Checking PostgreSQL before the release quality gate...'
    & npm run db:check
    if ($LASTEXITCODE -ne 0) {
      throw 'PostgreSQL preflight failed. Check the local DATABASE_URL, start the local PostgreSQL service, and apply pending local migrations before rerunning release.bat -Full. See docs/production-deployment.md.'
    }

    # The contract suite indexes vectors, so it must never fall back to the regular
    # development database. Resolve the isolated clone explicitly instead of
    # depending on the shell that launched release.bat.
    $contractDatabaseUrl = $env:DATABASE_URL
    $contractMigrationUrl = $null
    $isolatedConfigPath = Join-Path $scriptDir '..\tmp\xiaok-vector\connection.private.json'
    if (Test-Path -LiteralPath $isolatedConfigPath -PathType Leaf) {
      $isolatedConfig = Get-Content -Raw -LiteralPath $isolatedConfigPath | ConvertFrom-Json
      if ($isolatedConfig.DATABASE_URL -match '@(127\.0\.0\.1|localhost):55432/xiaok_embedding_eval') {
        if (-not $contractDatabaseUrl -or $contractDatabaseUrl -notmatch '@(127\.0\.0\.1|localhost):55432/xiaok_embedding_eval') {
          $contractDatabaseUrl = $isolatedConfig.DATABASE_URL
        }
      }
      if ($isolatedConfig.EMBEDDING_EVAL_OWNER_URL -match '@(127\.0\.0\.1|localhost):55432/xiaok_embedding_eval') {
        $contractMigrationUrl = $isolatedConfig.EMBEDDING_EVAL_OWNER_URL
      }
    }
    if (-not $contractDatabaseUrl -or $contractDatabaseUrl -notmatch '@(127\.0\.0\.1|localhost):55432/xiaok_embedding_eval') {
      throw 'PostgreSQL contract tests require the isolated evaluation clone at 127.0.0.1:55432/xiaok_embedding_eval. Start the tunnel/database and rerun release.bat -Full (see scripts/xiaok-embedding/prepare-vector-clone.ps1).'
    }
    if (-not $contractMigrationUrl) {
      throw 'PostgreSQL contract tests require EMBEDDING_EVAL_OWNER_URL from tmp/xiaok-vector/connection.private.json so isolated fixtures do not fall back to the local development database.'
    }

    Write-Host '[PRECHECK] Checking the isolated acceptance database...'
    Invoke-CheckedCommand 'Isolated acceptance database preflight' {
      $previousDatabaseUrl = $env:DATABASE_URL
      try {
        $env:DATABASE_URL = $contractDatabaseUrl
        node scripts/postgres-contract-tests.mjs --preflight
        if ($LASTEXITCODE -ne 0) { throw "Isolated acceptance database preflight failed with exit code $LASTEXITCODE." }
      } finally {
        $env:DATABASE_URL = $previousDatabaseUrl
      }
    }
  }

  Write-Host '[1/6] Running local build checks...'
  if ($Fast) {
    Write-Warning '[FAST] ESLint and test suites skipped. The Docker builder still runs the production Next.js build.'
  } else {
    Invoke-CheckedCommand 'ESLint' { npm run lint }
    Invoke-CheckedCommand 'Survey canvas tests' { npm run test:survey-canvas }
    Invoke-CheckedCommand 'AI tests' { npm run test:ai }
  }
  if ($Full) {
    Invoke-CheckedCommand 'PostgreSQL contract tests' {
      $previousDatabaseUrl = $env:DATABASE_URL
      $previousMigrationUrl = $env:DATABASE_MIGRATION_URL
      $previousWorkflowFile = $env:XIAOK_FASTGPT_WORKFLOWS_FILE
      $previousOpeningsFile = $env:XIAOK_OPENINGS_FILE
      try {
        $env:DATABASE_URL = $contractDatabaseUrl
        # Fixtures that create a disposable schema must stay inside the same
        # isolated clone; never let .env.local point them at the development DB.
        $env:DATABASE_MIGRATION_URL = $contractMigrationUrl
        # Machine-local private bindings often point at removed tmp files. The
        # suites that exercise them create their own fixture files; an empty
        # value keeps the gate independent of stale developer state.
        $env:XIAOK_FASTGPT_WORKFLOWS_FILE = ''
        $env:XIAOK_OPENINGS_FILE = ''
        npm run test:postgresql
        if ($LASTEXITCODE -ne 0) { throw "npm run test:postgresql failed with exit code $LASTEXITCODE." }
      } finally {
        $env:DATABASE_URL = $previousDatabaseUrl
        $env:DATABASE_MIGRATION_URL = $previousMigrationUrl
        $env:XIAOK_FASTGPT_WORKFLOWS_FILE = $previousWorkflowFile
        $env:XIAOK_OPENINGS_FILE = $previousOpeningsFile
      }
    }
    $postgresTests = 'passed'
    Invoke-CheckedCommand 'Next.js production build' { npm run build }
  } elseif (-not $Fast) {
    Write-Host '[SKIP] PostgreSQL contract tests. Use release.bat -Full to run the full release gate.'
  }

  $dockerBuildArgs = @('build')
  if ($Full) { $dockerBuildArgs += '--no-cache' }
  Write-Host ('[2/6] Building the versioned Docker image ({0})...' -f $(if ($Full) { 'no cache' } else { 'reusing cache' }))
  Invoke-CheckedCommand "Docker build $imageName" {
    docker @dockerBuildArgs --build-arg "SFP_RELEASE_VERSION=$Version" -t $imageName .
  }

  Write-Host '[3/6] Preparing the secret-free offline package...'
  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
  Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path (Join-Path $packageDir 'docker\postgres\init') -Force | Out-Null
  Copy-Item -LiteralPath 'deploy.sh', 'docker-compose.yml' -Destination $packageDir
  Copy-Item -LiteralPath 'docker\postgres\init\001-roles.sql' -Destination (Join-Path $packageDir 'docker\postgres\init')
  Copy-Item -LiteralPath 'drizzle' -Destination $packageDir -Recurse
  Copy-Item -LiteralPath 'auto_deploy.sh' -Destination (Join-Path $releaseRoot 'auto_deploy.sh') -Force

  $Version | Set-Content -LiteralPath (Join-Path $packageDir 'VERSION') -Encoding ascii
  $imageName | Set-Content -LiteralPath (Join-Path $packageDir 'IMAGE_NAME') -Encoding ascii
  $gitCommit = (& git rev-parse HEAD).Trim()
  $gitDirty = if (& git status --porcelain) { 'true' } else { 'false' }
  @(
    "version=$Version",
    "image=$imageName",
    "git_commit=$gitCommit",
    "git_dirty=$gitDirty",
    "release_mode=$releaseMode",
    "postgresql_contract_tests=$postgresTests",
    "built_at=$((Get-Date).ToString('o'))"
  ) | Set-Content -LiteralPath (Join-Path $packageDir 'BUILD_INFO') -Encoding ascii

  @'
Smart Floor Planner Admin versioned offline release

This archive intentionally contains no .env.production or other runtime secret.
Keep the server runtime environment file outside release directories.

Recommended server layout:
  /datas/smartfloor/.env.production
  /datas/smartfloor/auto_deploy.sh
  /datas/smartfloor/sfp-admin-release-<version>.zip

First-time server preparation:
  chmod 600 /datas/smartfloor/.env.production
  chmod +x /datas/smartfloor/auto_deploy.sh

Deploy the newest uploaded archive:
  ./auto_deploy.sh deploy

Deploy an exact archive:
  ./auto_deploy.sh deploy sfp-admin-release-<version>.zip

Show deployment state:
  ./auto_deploy.sh status

Roll back the application to the recorded previous version:
  ./auto_deploy.sh rollback

Rollback never reverses a PostgreSQL migration. Migrations must remain backward
compatible with the immediately previous application release.
'@ | Set-Content -LiteralPath (Join-Path $packageDir 'README.txt') -Encoding utf8

  Write-Host '[4/6] Exporting and verifying the Docker image...'
  Invoke-CheckedCommand "Docker save $imageName" {
    docker save --output (Join-Path $packageDir 'sfp-admin.tar') $imageName
  }
  Invoke-CheckedCommand 'Image runtime prerequisite check' {
    docker run --rm --entrypoint sh $imageName -c 'test -f /app/scripts/postgres-migrate.mjs'
  }
  $imageInspectJson = & docker image inspect $imageName
  if ($LASTEXITCODE -ne 0) {
    throw "Docker image inspection failed with exit code $LASTEXITCODE."
  }
  $imageInspect = $imageInspectJson | ConvertFrom-Json
  $imageLabel = [string]$imageInspect[0].Config.Labels.'org.opencontainers.image.version'
  if ($imageLabel -ne $Version) {
    throw "Docker image version label mismatch: expected $Version, got $imageLabel."
  }

  Write-Host '[5/6] Creating integrity manifests...'
  $drizzleRelativePaths = Get-ChildItem -LiteralPath (Join-Path $packageDir 'drizzle') -Recurse -File |
    Sort-Object FullName |
    ForEach-Object { $_.FullName.Substring($packageDir.Length).TrimStart([char[]]@('\', '/')) }
  Write-Sha256Manifest -Root $packageDir -RelativePaths $drizzleRelativePaths -OutputPath (Join-Path $packageDir 'DRIZZLE_SHA256SUMS')
  Write-Sha256Manifest -Root $packageDir -RelativePaths @(
    'VERSION',
    'IMAGE_NAME',
    'BUILD_INFO',
    'deploy.sh',
    'docker-compose.yml',
    'docker/postgres/init/001-roles.sql',
    'DRIZZLE_SHA256SUMS',
    'sfp-admin.tar'
  ) -OutputPath (Join-Path $packageDir 'SHA256SUMS')

  Write-Host '[6/6] Creating the versioned ZIP package...'
  New-ForwardSlashZip -SourceDir $packageDir -ZipPath $packageZip
  $zipHash = (Get-FileHash -LiteralPath $packageZip -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-LfAscii -Path "$packageZip.sha256" -Lines @(
    "$zipHash  $([System.IO.Path]::GetFileName($packageZip))"
  )

  Write-Host ''
  Write-Host '================================================================'
  Write-Host '[SUCCESS] Release package created:'
  Write-Host $packageZip
  Write-Host "[INFO] Version: $Version"
  Write-Host "[INFO] Image: $imageName"
  Write-Host "[INFO] PostgreSQL contract tests: $postgresTests"
  Write-Host "[INFO] ZIP SHA-256: $zipHash"
  Write-Host '[INFO] No production environment file is included.'
  Write-Host 'Upload the ZIP, its .sha256 file, and the updated auto_deploy.sh.'
  Write-Host '================================================================'
} finally {
  Pop-Location
}
