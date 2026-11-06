param(
  [Parameter(Mandatory=$true)][ValidateSet('Prepare','Pull','PullDirect','Up','Status','Tunnel')][string]$Action
)
$ErrorActionPreference = 'Stop'
$RemoteHostName = 'Administrator@192.168.10.54'
$RemoteDirectory = 'D:/Smart-Floor-Planner-Dev/fastgpt-pilot'
$IdentityPath = 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519'
$SshArgs = @('-i',$IdentityPath,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8')
function Invoke-PilotRemote([string]$Script) {
  $Prelude = '[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $ErrorActionPreference="Stop"; $ProgressPreference="SilentlyContinue"; '
  $Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Prelude + $Script))
  & ssh @SshArgs $RemoteHostName "powershell -NoProfile -EncodedCommand $Encoded"
  if ($LASTEXITCODE -ne 0) { throw "Remote FastGPT $Action failed ($LASTEXITCODE)" }
}
if ($Action -eq 'Prepare') {
  Invoke-PilotRemote @'
if ($env:COMPUTERNAME -ne 'User-2026PKPRRP') { throw 'Unexpected host' }
$PilotDirectory='D:/Smart-Floor-Planner-Dev/fastgpt-pilot'
New-Item -ItemType Directory -Path $PilotDirectory -Force | Out-Null
$SecretFile=Join-Path $PilotDirectory '.env.fastgpt'
if (!(Test-Path -LiteralPath $SecretFile)) {
  $Names='MONGO_PASSWORD','VECTOR_PASSWORD','REDIS_PASSWORD','STORAGE_PASSWORD','PROXY_DB_PASSWORD','PROXY_TOKEN','ROOT_KEY','ROOT_PASSWORD','FILE_TOKEN_KEY','AES256_SECRET_KEY','INVOKE_TOKEN_SECRET','SANDBOX_TOKEN'
  $Rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  $Values=foreach($Name in $Names) {
    $Bytes=New-Object byte[] 32; $Rng.GetBytes($Bytes)
    $Value=([BitConverter]::ToString($Bytes)).Replace('-','').ToLowerInvariant()
    if ($Name -eq 'AES256_SECRET_KEY') { $Value=$Value.Substring(0,32) }
    "$Name=$Value"
  }
  [IO.File]::WriteAllLines($SecretFile,$Values,[Text.UTF8Encoding]::new($false))
  $Rng.Dispose()
}
if (!(Get-Content -LiteralPath $SecretFile | Where-Object { $_ -like 'PLUGIN_TOKEN=*' })) {
  $PluginBytes=New-Object byte[] 32; $PluginRng=[Security.Cryptography.RandomNumberGenerator]::Create(); $PluginRng.GetBytes($PluginBytes); $PluginRng.Dispose()
  $PluginToken=([BitConverter]::ToString($PluginBytes)).Replace('-','').ToLowerInvariant()
  [IO.File]::AppendAllText($SecretFile,"PLUGIN_TOKEN=$PluginToken`r`n",[Text.UTF8Encoding]::new($false))
}
$Acl=New-Object Security.AccessControl.FileSecurity
$Acl.SetAccessRuleProtection($true,$false)
foreach($Name in @('SYSTEM','Administrators','Administrator')) {
  $Rule=New-Object Security.AccessControl.FileSystemAccessRule($Name,'FullControl','Allow'); $Acl.AddAccessRule($Rule)
}
Set-Acl -LiteralPath $SecretFile -AclObject $Acl
Write-Output 'Pilot directory and protected runtime credentials ready (values omitted).'
'@
  $Deployment = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../deployment/fastgpt'))
  foreach($FileName in @('compose.yml','config.json','disable-openai-retries.cjs','secure-pilot-root.cjs')) {
    & scp @SshArgs (Join-Path $Deployment $FileName) "${RemoteHostName}:${RemoteDirectory}/$FileName"
    if ($LASTEXITCODE -ne 0) { throw 'Pilot file transfer failed' }
  }
  & scp @SshArgs (Join-Path $PSScriptRoot 'pull_official_images.py') "${RemoteHostName}:${RemoteDirectory}/pull_official_images.py"
  if ($LASTEXITCODE -ne 0) { throw 'Pilot transport helper transfer failed' }
}
elseif ($Action -eq 'PullDirect') {
  Invoke-PilotRemote "Set-Location -LiteralPath '$RemoteDirectory'; & D:/XiaoK-Embedding/python/python.exe ./pull_official_images.py; exit `$LASTEXITCODE"
}
elseif ($Action -eq 'Tunnel') {
  if (Get-NetTCPConnection -LocalPort 18300 -State Listen -ErrorAction SilentlyContinue) { throw 'Local 18300 is occupied; inspect ownership before reusing' }
  & ssh @SshArgs -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L '127.0.0.1:18300:127.0.0.1:18300' $RemoteHostName
}
else {
  # The pinned PG17 image is already present on this approved Docker host.
  # Pull only the new vendor images; do not contact Docker Hub for cached PG.
  $Operation = switch($Action) { 'Pull' { 'pull --quiet mongo redis minio aiproxy code-sandbox plugin app' }; 'Up' { 'up -d --pull never --wait --wait-timeout 180' }; 'Status' { 'ps --format json' } }
  Invoke-PilotRemote "Set-Location -LiteralPath '$RemoteDirectory'; docker --config D:/Smart-Floor-Planner-Dev/docker-cli compose --env-file .env.fastgpt -f compose.yml config --quiet; if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }; docker --config D:/Smart-Floor-Planner-Dev/docker-cli compose --env-file .env.fastgpt -f compose.yml $Operation; exit `$LASTEXITCODE"
  if ($Action -eq 'Up') { Invoke-PilotRemote 'docker exec sfp-fastgpt-pilot-app-1 node /app/pilot/secure-pilot-root.cjs; exit $LASTEXITCODE' }
}
