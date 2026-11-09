$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../../..").Path
function Run-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw 'Vector restore operation failed' }
}
$db = 'xiaok_embedding_restore'
Run-Docker exec xiaok-vector-eval pg_dump -U vector_probe_owner -d xiaok_embedding_eval -Fc -f /tmp/with-vector.dump
Run-Docker cp xiaok-vector-eval:/tmp/with-vector.dump "$repo/tmp/xiaok-vector/with-vector.dump"
Run-Docker exec xiaok-vector-eval createdb -U vector_probe_owner $db
Run-Docker exec xiaok-vector-eval pg_restore -U vector_probe_owner -d $db --exit-on-error /tmp/with-vector.dump
$sql = @'
select 'server='||current_setting('server_version');
select 'vector='||extversion from pg_extension where extname='vector';
select 'probe='||count(*)||':'||md5(string_agg(enterprise_id||':'||id||':'||profile||':'||embedding::text,',' order by enterprise_id,id,profile)) from app.assistant_embedding_probe;
select 'tables='||count(*) from pg_tables where schemaname='app';
select 'forced_rls='||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and relrowsecurity and relforcerowsecurity;
select 'policies='||count(*) from pg_policies where schemaname='app';
'@
# Compare restore under the owner; test non-bypass RLS separately with an explicit known tenant.
$summarySql = $sql
$source = $summarySql | docker exec -i xiaok-vector-eval psql -X -At -v ON_ERROR_STOP=1 -U vector_probe_owner -d xiaok_embedding_eval
if ($LASTEXITCODE -ne 0) { throw 'Source comparison failed' }
$restored = $summarySql | docker exec -i xiaok-vector-eval psql -X -At -v ON_ERROR_STOP=1 -U vector_probe_owner -d $db
if ($LASTEXITCODE -ne 0 -or (Compare-Object $source $restored)) { throw 'Restored metadata/vector mismatch' }
$tenant = (Get-Content -Raw "$repo/tmp/xiaok-embedding-evaluation.json" | ConvertFrom-Json).tenantIds[0]
$rlsSql = "set role sfp_app; begin; select set_config('app.current_enterprise_id','$tenant',true); select count(distinct enterprise_id)=1 and min(enterprise_id)=$tenant from app.assistant_embedding_probe; rollback;"
$rls = $rlsSql | docker exec -i xiaok-vector-eval psql -X -At -v ON_ERROR_STOP=1 -U vector_probe_owner -d $db
if ($LASTEXITCODE -ne 0 -or $rls -notcontains 't') { throw 'Restored RLS validation failed' }
$source
Write-Output 'VECTOR_BACKUP_RESTORE_MATCH restored_rls=passed'
