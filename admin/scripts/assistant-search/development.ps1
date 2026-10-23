param(
  [Parameter(Mandatory=$true)][ValidatePattern('^ghcr\.io/searxng/searxng@sha256:[a-f0-9]{64}$')][string]$Image,
  [string]$EvidencePath,
  [switch]$UpdateSettings
)
$ErrorActionPreference='Stop'
$sfpRoot=Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$sfpName='sfp-remote-dev-search'
$sfpContext='sfp-remote-dev'
$sfpTarget='Administrator@192.168.10.54'
$sfpIdentity='C:/Users/Administrator/.ssh/toonflow_remote_ed25519'
$sfpReport=@{started=(Get-Date).ToUniversalTime().ToString('o');container=$sfpName;image=$Image;developmentOnly=$true;port=18090}
$sfpTemporary=Join-Path $sfpRoot ('tmp/assistant-search-'+[guid]::NewGuid().ToString('N')+'.private.yml')
try {
  $sfpExisting=& docker --context $sfpContext ps -a --filter ('name=^/'+$sfpName+'$') --format '{{.Names}}'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect approved development Docker context' }
  if ($sfpExisting) {
    $sfpDetails=(& docker --context $sfpContext inspect $sfpName | ConvertFrom-Json)[0]
    if ($sfpDetails.Config.Labels.'com.smart-floor-planner.owner' -ne 'assistant-search-development' -or $sfpDetails.Config.Image -ne $Image) { throw 'Existing search container is not this owned pinned development service' }
    $sfpBindings=@($sfpDetails.HostConfig.PortBindings.'8080/tcp')
    if ($sfpBindings.Count -ne 1 -or $sfpBindings[0].HostIp -ne '127.0.0.1' -or $sfpBindings[0].HostPort -ne '18090') { throw 'Search service must bind the owned loopback port only' }
  }
  if (-not $sfpExisting -or $UpdateSettings) {
    $sfpConfiguration=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'settings.yml')).Replace('REPLACE_DURING_INSTALL',[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant())
    [IO.File]::WriteAllText($sfpTemporary,$sfpConfiguration,[Text.UTF8Encoding]::new($false))
    $sfpAcl=Get-Acl -LiteralPath $sfpTemporary
    $sfpAcl.SetAccessRuleProtection($true,$false)
    $sfpAcl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
    $sfpAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','Allow'))
    Set-Acl -LiteralPath $sfpTemporary -AclObject $sfpAcl
    if (-not $sfpExisting) {
      & docker --context $sfpContext create --name $sfpName --label 'com.smart-floor-planner.owner=assistant-search-development' --restart unless-stopped --memory 512m --cpus 1 --publish '127.0.0.1:18090:8080' $Image | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Create development search container failed' }
      $sfpReport.created=$true
    }
    & docker --context $sfpContext cp $sfpTemporary ($sfpName+':/etc/searxng/settings.yml')
    if ($LASTEXITCODE -ne 0) { throw 'Install owned search settings failed' }
    $sfpReport.settingsHash=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'settings.yml') -Algorithm SHA256).Hash.ToLowerInvariant()
    $sfpReport.settingsUpdated=$true
  }
  if ($sfpExisting -and $UpdateSettings -and $sfpDetails.State.Running) {
    & docker --context $sfpContext restart $sfpName | Out-Null
  } else {
    & docker --context $sfpContext start $sfpName | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw 'Start development search failed' }
  $sfpPort=@(Get-NetTCPConnection -LocalPort 18090 -State Listen -ErrorAction SilentlyContinue)
  if ($sfpPort.Count -eq 0) {
    $sfpSshArgs=@('-i',$sfpIdentity,'-p','22','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-N','-L','127.0.0.1:18090:127.0.0.1:18090',$sfpTarget)
    $sfpTunnel=Start-Process -FilePath 'ssh.exe' -ArgumentList $sfpSshArgs -WindowStyle Hidden -PassThru
    $sfpReport.tunnelPid=$sfpTunnel.Id
    for($sfpTry=0;$sfpTry -lt 30;$sfpTry++) {
      if (@(Get-NetTCPConnection -LocalPort 18090 -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {break}
      if ($sfpTunnel.HasExited) {throw 'Owned development search tunnel exited'}
      Start-Sleep -Milliseconds 300
    }
  } else {
    $sfpOwner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$sfpPort[0].OwningProcess)
    if ($sfpOwner.Name -ne 'ssh.exe' -or $sfpOwner.CommandLine -notlike '*127.0.0.1:18090:127.0.0.1:18090*' -or $sfpOwner.CommandLine -notlike ('*'+$sfpTarget+'*')) {throw 'Local search port belongs to another process'}
    $sfpReport.reusedTunnel=$true
  }
  $sfpDetails=(& docker --context $sfpContext inspect $sfpName | ConvertFrom-Json)[0]
  $sfpReport.running=$sfpDetails.State.Running
  $sfpReport.loopback=$sfpDetails.HostConfig.PortBindings.'8080/tcp'[0].HostIp
  $sfpReport.finished=(Get-Date).ToUniversalTime().ToString('o')
  Write-Output 'Owned pinned free search container and loopback SSH tunnel are ready; actual search acceptance is separate.'
} catch { $sfpReport.error=$_.Exception.Message; throw }
finally {
  if (Test-Path -LiteralPath $sfpTemporary) {Remove-Item -LiteralPath $sfpTemporary}
  if ($EvidencePath) {$sfpReport | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $EvidencePath -Encoding utf8}
}
