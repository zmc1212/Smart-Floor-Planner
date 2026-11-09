$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../../..").Path
$evidence = Join-Path $root 'tmp/xiaok-vector'
New-Item -ItemType Directory -Force $evidence | Out-Null
$image = 'pgvector/pgvector:0.8.2-pg17@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966'
function Run-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw 'Docker operation failed' }
}
if ((docker ps -a --filter 'name=^xiaok-vector-eval$' --format '{{.Names}}')) { throw 'Evaluation container already exists; inspect before reuse' }
# The source stays running and its volume is never mounted into the new container.
Run-Docker exec smart-floor-planner-postgres pg_dump -U sfp_owner -d smart_floor_planner -Fc -f /tmp/xiaok-before-vector.dump
Run-Docker exec smart-floor-planner-postgres pg_dumpall -U sfp_owner --roles-only --no-role-passwords -f /tmp/xiaok-roles.sql
Run-Docker cp smart-floor-planner-postgres:/tmp/xiaok-before-vector.dump "$evidence/before-vector.dump"
Run-Docker cp smart-floor-planner-postgres:/tmp/xiaok-roles.sql "$evidence/roles.sql"
$env:POSTGRES_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
Run-Docker run -d --name xiaok-vector-eval -p 127.0.0.1:55432:5432 -e POSTGRES_USER=vector_probe_owner -e POSTGRES_PASSWORD -e POSTGRES_DB=xiaok_embedding_eval -v xiaok_vector_eval_data:/var/lib/postgresql/data $image
for ($i = 0; $i -lt 30; $i++) {
    docker exec xiaok-vector-eval pg_isready -U vector_probe_owner -d xiaok_embedding_eval *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
}
Run-Docker cp "$evidence/roles.sql" xiaok-vector-eval:/tmp/roles.sql
Run-Docker cp "$evidence/before-vector.dump" xiaok-vector-eval:/tmp/before-vector.dump
Run-Docker exec xiaok-vector-eval psql -v ON_ERROR_STOP=1 -U vector_probe_owner -d xiaok_embedding_eval -f /tmp/roles.sql
Run-Docker exec xiaok-vector-eval pg_restore -U vector_probe_owner -d xiaok_embedding_eval --exit-on-error /tmp/before-vector.dump
$appPassword = [Guid]::NewGuid().ToString('N')
"ALTER ROLE sfp_app PASSWORD '$appPassword';" | docker exec -i xiaok-vector-eval psql -v ON_ERROR_STOP=1 -U vector_probe_owner -d xiaok_embedding_eval | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Evaluation app password failed' }
$config = @{
    DATABASE_URL = "postgresql://sfp_app:${appPassword}@127.0.0.1:55432/xiaok_embedding_eval"
    EMBEDDING_EVAL_OWNER_URL = "postgresql://vector_probe_owner:$($env:POSTGRES_PASSWORD)@127.0.0.1:55432/xiaok_embedding_eval"
}
$config | ConvertTo-Json | Set-Content -Encoding utf8 "$evidence/connection.private.json"
Remove-Item Env:POSTGRES_PASSWORD
Write-Output 'ISOLATED_CLONE_READY port=55432 original_volume_unchanged=true'
