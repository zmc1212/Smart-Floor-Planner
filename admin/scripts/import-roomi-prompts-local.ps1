$ErrorActionPreference = 'Stop'

$adminDirectory = Split-Path -Parent $PSScriptRoot
$secretDirectory = Join-Path $adminDirectory '.roomi-import'
$authorizationFile = Join-Path $secretDirectory 'roomi-authorization.txt'
$cookieFile = Join-Path $secretDirectory 'roomi-cookie.txt'
$importSucceeded = $false

function Read-SecretFile([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    New-Item -ItemType File -Path $Path -Force | Out-Null
  }

  $value = (Get-Content -Raw -LiteralPath $Path).Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Host "$Label file is empty. Paste the complete value into Notepad, save it, and close Notepad." -ForegroundColor Yellow
    Start-Process -FilePath 'notepad.exe' -ArgumentList @($Path) -Wait
    $value = (Get-Content -Raw -LiteralPath $Path).Trim()
  }
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Label file is still empty: $Path"
  }
  return $value
}

try {
  Set-Location -LiteralPath $adminDirectory
  $env:ROOMI_IMPORT_AUTHORIZATION = Read-SecretFile $authorizationFile 'Authorization'

  if (Test-Path -LiteralPath $cookieFile -PathType Leaf) {
    $env:ROOMI_IMPORT_COOKIE = Read-SecretFile $cookieFile 'Cookie'
  }

  Write-Host '[1/2] Running prompt-library dry-run...'
  & npm.cmd run import:roomi-prompts
  if ($LASTEXITCODE -ne 0) {
    throw "Dry-run failed with exit code $LASTEXITCODE"
  }

  Write-Host '[2/2] Publishing the validated prompt-library revision...'
  & npm.cmd run import:roomi-prompts -- --execute
  if ($LASTEXITCODE -ne 0) {
    throw "Execute import failed with exit code $LASTEXITCODE"
  }

  $importSucceeded = $true
} finally {
  Remove-Item Env:ROOMI_IMPORT_AUTHORIZATION -ErrorAction SilentlyContinue
  Remove-Item Env:ROOMI_IMPORT_COOKIE -ErrorAction SilentlyContinue

  if ($importSucceeded) {
    Remove-Item -LiteralPath $authorizationFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $cookieFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Credentials were cleared and the local secret files were deleted.' -ForegroundColor Green
  } else {
    Write-Host 'Environment credentials were cleared. Local secret files were retained for retry.' -ForegroundColor Yellow
  }
}
