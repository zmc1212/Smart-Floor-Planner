$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../../..").Path
$config = Get-Content -Raw "$repo/tmp/xiaok-vector/connection.private.json" | ConvertFrom-Json
$env:DATABASE_URL = $config.DATABASE_URL
$env:EMBEDDING_EVAL_OWNER_URL = $config.EMBEDDING_EVAL_OWNER_URL
$env:ASSISTANT_EMBEDDING_URL = 'http://127.0.0.1:18089'
$env:ASSISTANT_EMBEDDING_API_KEY = [IO.File]::ReadAllText("$repo/tmp/xiaok-vector/api-key.private.txt").Trim()
Push-Location "$repo/admin"
try {
    & ./node_modules/.bin/tsx.cmd scripts/xiaok-embedding/evaluate.ts
    if ($LASTEXITCODE -ne 0) { throw 'Embedding evaluation failed' }
} finally { Pop-Location }
