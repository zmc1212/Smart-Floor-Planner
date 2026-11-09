param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$OutputRoot,
  [switch]$Finalize
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$dockerConfig = 'D:/Smart-Floor-Planner-Dev/docker-cli'
$allowedRoot = [IO.Path]::GetFullPath('D:/Smart-Floor-Planner-Dev/wvp-bundle-build-20261105-01/')
foreach ($candidate in @($SourceRoot, $OutputRoot)) {
  $resolved = [IO.Path]::GetFullPath($candidate)
  if (-not $resolved.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Bundle sources and output must remain in the dedicated remote build directory.'
  }
}
$manifest = Get-Content -LiteralPath (Join-Path $SourceRoot 'images.json') -Raw | ConvertFrom-Json
$releaseName = "$($manifest.release)-linux-amd64"
$bundleRoot = Join-Path $OutputRoot $releaseName
$files = @('images.json','deploy.sh','deploy.py','application.yml','start-zlm.sh','verify.py','README.md','README.zh-CN.md')
New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
$evidenceRoot = Join-Path $OutputRoot 'evidence'
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
function Save-OriginalState($name) {
  $ids = docker --config $dockerConfig ps -aq
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the original containers.' }
  $containers = docker --config $dockerConfig inspect $ids | ConvertFrom-Json
  $safe = foreach ($item in $containers) {
    [ordered]@{id=$item.Id;name=$item.Name;image=$item.Image;status=$item.State.Status;
      started=$item.State.StartedAt;mounts=$item.Mounts;ports=$item.HostConfig.PortBindings}
  }
  $safe | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot $name) -Encoding UTF8
}
if (-not (Test-Path -LiteralPath (Join-Path $evidenceRoot 'original-containers.json'))) {
  Save-OriginalState 'original-containers.json'
}
$ids = @($manifest.images.PSObject.Properties.Value)
$images = docker --config $dockerConfig image inspect $ids | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'A pinned image is unavailable.' }
foreach ($item in $images) {
  if ($item.Os -ne 'linux' -or $item.Architecture -ne 'amd64' -or $ids -notcontains $item.Id) {
    throw 'Unexpected image platform or identity.'
  }
}
$images | ForEach-Object {
  [ordered]@{id=$_.Id;os=$_.Os;architecture=$_.Architecture;size=$_.Size;layers=$_.RootFS.Layers}
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceRoot 'images.json') -Encoding UTF8
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $SourceRoot $file) -Destination (Join-Path $bundleRoot $file) -Force
}
$imageTar = Join-Path $bundleRoot 'images.tar'
$imageReceipt = Join-Path $evidenceRoot 'image-export.json'
if (-not (Test-Path -LiteralPath $imageTar)) {
  docker --config $dockerConfig image save --output $imageTar $ids
  if ($LASTEXITCODE -ne 0) { throw 'Image export failed; preserve the partial file for diagnosis.' }
  [ordered]@{images=$ids;bytes=(Get-Item -LiteralPath $imageTar).Length;
    sha256=(Get-FileHash -LiteralPath $imageTar -Algorithm SHA256).Hash.ToLowerInvariant()} |
    ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $imageReceipt -Encoding UTF8
} else {
  if (-not (Test-Path -LiteralPath $imageReceipt)) { throw 'Unconfirmed image export exists; inspect it before retrying.' }
  $receipt = Get-Content -LiteralPath $imageReceipt -Raw | ConvertFrom-Json
  if ((Get-FileHash -LiteralPath $imageTar -Algorithm SHA256).Hash.ToLowerInvariant() -ne $receipt.sha256) {
    throw 'Existing image export hash changed.'
  }
}
$hashLines = foreach ($file in @($files + 'images.tar')) {
  '{0}  {1}' -f (Get-FileHash -LiteralPath (Join-Path $bundleRoot $file) -Algorithm SHA256).Hash.ToLowerInvariant(),$file
}
$lf = [string][char]10
[IO.File]::WriteAllText((Join-Path $bundleRoot 'SHA256SUMS'), (($hashLines -join $lf) + $lf), (New-Object Text.UTF8Encoding($false)))
if ($Finalize) {
  $archive = Join-Path $OutputRoot "$releaseName.tar.gz"
  if (Test-Path -LiteralPath $archive) { throw 'Final archive already exists; do not overwrite a delivered release.' }
  # Only the allowlisted clean staging directory is archived. Tests use a separate directory.
  if (Test-Path -LiteralPath (Join-Path $bundleRoot '.state')) { throw 'Private installation state must never enter the release.' }
  tar -czf $archive -C $OutputRoot $releaseName
  if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed.' }
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$archive.sha256", ("$hash  $releaseName.tar.gz" + $lf), (New-Object Text.UTF8Encoding($false)))
  [ordered]@{archive=$archive;bytes=(Get-Item -LiteralPath $archive).Length;sha256=$hash} |
    ConvertTo-Json -Compress
}
Save-OriginalState 'containers-after-export.json'
Write-Output "Bundle staging ready: $bundleRoot"
