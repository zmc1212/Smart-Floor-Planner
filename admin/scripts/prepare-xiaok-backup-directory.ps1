[CmdletBinding()]
param(
  [string]$Directory = 'C:\sfp-backups\i795-20261115',
  [int]$MinFreeGB = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  Write-Error $Message
  exit 1
}

try {
  if ($MinFreeGB -le 0) { Fail 'MinFreeGB must be positive.' }

  $full = [IO.Path]::GetFullPath($Directory)

  # Refuse paths inside a Git work tree. Do not create anything before this check.
  $cursor = $full
  while ($true) {
    if (Test-Path -LiteralPath (Join-Path $cursor '.git')) {
      Fail "Refusing a directory inside a Git repository: $full"
    }
    $parent = Split-Path -Parent $cursor
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { break }
    $cursor = $parent
  }

  $root = [IO.Path]::GetPathRoot($full)
  $drive = [IO.DriveInfo]::new($root)
  $freeGB = [math]::Round($drive.AvailableFreeSpace / 1GB, 2)
  if ($freeGB -lt $MinFreeGB) {
    Fail "Insufficient free space: $freeGB GB available, $MinFreeGB GB required."
  }

  if (-not (Test-Path -LiteralPath $full)) {
    New-Item -ItemType Directory -Path $full -Force | Out-Null
  }
  if (-not (Test-Path -LiteralPath $full -PathType Container)) {
    Fail "Path is not a directory: $full"
  }

  # Remove inheritance and grant full control only to local Administrators and SYSTEM.
  # SIDs are locale-independent.
  $icacls = & icacls.exe $full /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "icacls failed: $($icacls -join ' ')" }

  $acl = Get-Acl -LiteralPath $full
  $broad = @($acl.Access | Where-Object {
    $_.AccessControlType -eq 'Allow' -and
    $_.IdentityReference.Value -match '(?i)(Authenticated Users|Everyone)' -and
    $_.FileSystemRights.ToString() -match '(?i)(Modify|FullControl|Write|CreateFiles|AppendData|Delete)'
  })
  if ($broad.Count -gt 0) {
    Fail "Unsafe ACL remains: $($broad | ForEach-Object { "$($_.IdentityReference):$($_.FileSystemRights)" } | Out-String)"
  }
  if ($acl.Owner -match '(?i)(Authenticated Users|Everyone)') {
    Fail "Unsafe owner: $($acl.Owner)"
  }

  $access = @($acl.Access | ForEach-Object {
    [pscustomobject]@{
      Identity = $_.IdentityReference.Value
      Rights = $_.FileSystemRights.ToString()
      Type = $_.AccessControlType.ToString()
      Inherited = $_.IsInherited
    }
  })
  [pscustomobject]@{
    Status = 'passed'
    Directory = $full
    FreeGB = $freeGB
    MinFreeGB = $MinFreeGB
    Owner = $acl.Owner
    Access = $access
    CreatedBackupFiles = $false
  } | ConvertTo-Json -Depth 5 -Compress
} catch {
  Fail $_.Exception.Message
}
