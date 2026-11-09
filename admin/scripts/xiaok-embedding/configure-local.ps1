$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../../..").Path
$keyPath = Join-Path $repo 'tmp/xiaok-vector/api-key.private.txt'
$key = [IO.File]::ReadAllText($keyPath).Trim()
if ($key.Length -lt 32) { throw 'Service credential missing' }
$envPath = Join-Path $repo 'admin/.env.local'
$content = if (Test-Path $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
$content = [regex]::Replace($content, '(?m)^ASSISTANT_EMBEDDING_(URL|API_KEY)=.*\r?\n?', '')
$content = $content.TrimEnd() + "`nASSISTANT_EMBEDDING_URL=http://127.0.0.1:18089`nASSISTANT_EMBEDDING_API_KEY=$key`n"
[IO.File]::WriteAllText($envPath, $content, (New-Object Text.UTF8Encoding($false)))
Write-Output 'LOCAL_EMBEDDING_CONFIGURED credential_not_printed=true'
