"""Install the explicitly authorized, synthetic Weiyun camera trial only.

No connection to the formal business database; no published Docker ports.
Phases retain receipts and never replay a completed data import.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import subprocess
import tarfile

ROOT = Path('/datas/sfp-camera-trial-20261106')
PG = 'sfp-camera-trial-postgres-20261106'
APP = 'sfp-camera-trial-gateway-20261106'
BASE = 'sha256:5cabd2b6207080db1eac1ad65243b78b22ae6e335d5804f39b61bd5035b24651'


def run(args, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        write_private('private/last-error.log',json.dumps(args)+'\n'+result.stdout.decode(errors='replace')+'\n'+result.stderr.decode(errors='replace'))
        # Do not put SQL/credentials or a raw container configuration in output.
        raise RuntimeError('Command failed: {} ({}); inspect protected phase log'.format(args[0], result.returncode))
    return result.stdout


def write_private(name, value):
    p = ROOT / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(value, encoding='utf-8')
    p.chmod(0o600)


def compose(*args):
    return run(['docker', 'compose', '-p', 'sfp-camera-trial', '-f', str(ROOT/'compose.yml')] + list(args))


def sql(text,database='camera_trial'):
    return run(['docker', 'exec', '-i', PG, 'psql', '-X', '-U', 'sfp_owner', '-d', database, '-v', 'ON_ERROR_STOP=1'], text.encode())


def assert_trial_subnet():
    target=ipaddress.ip_network('10.203.207.0/24')
    ids=run(['docker','network','ls','-q']).decode().split()
    for net in json.loads(run(['docker','network','inspect']+ids)):
        for cfg in net['IPAM'].get('Config') or []:
            if cfg.get('Subnet') and ipaddress.ip_network(cfg['Subnet']).overlaps(target) and net['Name']!='sfp-camera-trial_trial':
                raise ValueError('Trial subnet overlaps another Docker network')
    for line in run(['ip','-o','route','show']).decode().splitlines():
        route=line.split();dst=route[0];dev=route[route.index('dev')+1] if 'dev' in route else ''
        if dst!='default' and ipaddress.ip_network(dst,strict=False).overlaps(target) and not dev.startswith('br-'):
            raise ValueError('Trial subnet overlaps a host route')


def repair_trial_network():
    # The first creation failed before PG started: Docker's auto-allocated WVP
    # subnet cannot take static addresses. Keep its network entirely unchanged.
    if (ROOT/'private/imported.json').exists():raise RuntimeError('Network repair is pre-import only')
    assert_trial_subnet()
    guard_file=ROOT/'network-guard.json'
    run(['python3',str(ROOT/'host-network-guard.py'),'remove',str(guard_file)])
    cfg=json.loads(guard_file.read_text());cfg['subnet']='10.203.207.0/24'
    write_private('network-guard.json',json.dumps(cfg))
    run(['python3',str(ROOT/'host-network-guard.py'),'apply',str(guard_file)])
    env=(ROOT/'.env.app').read_text().replace('CAMERA_BIND_HOST=0.0.0.0','CAMERA_BIND_HOST=10.203.207.2')
    write_private('.env.app',env)
    compose('up','-d','postgres')
    print(json.dumps({'phase':'network-repaired','originalWvpNetworkChanged':False}))


def prepare(sha):
    if (ROOT/'.env.app').exists():
        raise RuntimeError('Trial already prepared; inspect receipt instead of regenerating credentials')
    archive = ROOT/'trial-runtime.tar.gz'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != sha:
        raise ValueError('Archive checksum mismatch')
    network = json.loads(run(['docker', 'network', 'inspect', 'sfp-wvp-cloud_default']))[0]
    if network['IPAM']['Config'][0]['Subnet'] != '192.168.80.0/20':
        raise ValueError('Original protected WVP subnet changed')
    assert_trial_subnet()
    if run(['docker', 'image', 'inspect', 'zmc1212/sfp-admin:20260905-001', '--format', '{{.Id}}']).decode().strip() != BASE:
        raise ValueError('Admin runtime image changed')
    ids = run(['docker', 'ps', '-q']).decode().split()
    resources = json.loads(run(['docker', 'inspect']+ids))
    write_private('private/original-resources.json', json.dumps([{'id':c['Id'],'name':c['Name'],'startedAt':c['State']['StartedAt'],'mounts':c['Mounts']} for c in resources]))
    with tarfile.open(str(archive)) as tar:
        for item in tar.getmembers():
            resolved = (ROOT/item.name).resolve()
            if ROOT not in resolved.parents or item.issym() or item.islnk():
                raise ValueError('Unsafe archive member')
        tar.extractall(str(ROOT))
    (ROOT/'private').chmod(0o700)
    for p in (ROOT/'private').iterdir():
        p.chmod(0o600)
    original = Path('/datas/sfp-wvp-production-20261106')
    profile = json.loads((original/'network-guard.json').read_text())
    guard = {'project':'sfp-wvp-camera-trial', 'externalInterface':profile['externalInterface'],
             'subnet':'10.203.207.0/24','hostHttpPorts':[33417], 'containerPrivatePorts':[33417,5432]}
    write_private('network-guard.json',json.dumps(guard))
    run(['python3',str(ROOT/'host-network-guard.py'),'apply',str(ROOT/'network-guard.json')])
    unit = Path('/etc/systemd/system/sfp-camera-trial-network-guard.service')
    if unit.exists():
        raise RuntimeError('Unexpected existing trial guard unit')
    unit.write_text('[Unit]\nDescription=Protect isolated camera trial private ports\nBefore=docker.service\nAfter=network-pre.target\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 '+str(ROOT/'host-network-guard.py')+' apply '+str(ROOT/'network-guard.json')+'\nRemainAfterExit=yes\n\n[Install]\nWantedBy=multi-user.target\n')
    run(['systemctl','daemon-reload']);run(['systemctl','enable','--now',unit.name])
    state=json.loads((original/'sfp-wvp-20261105-001-linux-amd64/.state/installation.private.json').read_text())
    clock=json.loads(Path('/datas/sfp-wvp-sd-clock-20261106/config.private.json').read_text())
    app_password=secrets.token_hex(32)
    env={'NODE_ENV':'production','CAMERA_EMBEDDED_TRIAL':'1','CAMERA_TRIAL_ENTERPRISE_ID':'1454',
         'CAMERA_PUBLIC_ORIGIN':'https://smartfloor.zlyun168.com','CAMERA_APP_ORIGIN':'http://127.0.0.1:33417',
         'CAMERA_GATEWAY_PORT':'33417','CAMERA_BIND_HOST':'10.203.207.2',
         'DATABASE_URL':'postgresql://sfp_app:'+app_password+'@'+PG+':5432/camera_trial',
         'JWT_SECRET':secrets.token_hex(48),'POSTGRES_APPLICATION_NAME':'camera-trial-20261106','POSTGRES_POOL_MAX':'5',
         'CAMERA_WVP_ORIGIN':'http://sfp-wvp-cloud-wvp-1:18080','CAMERA_MEDIA_ORIGIN':'http://sfp-wvp-cloud-zlm-1:28081',
         'CAMERA_WVP_USERNAME':'admin','CAMERA_WVP_PASSWORD':state['credentials']['WVP_ADMIN_PASSWORD'],
         'CAMERA_ZLM_SECRET':state['credentials']['ZLM_SECRET'],'CAMERA_MEDIA_SERVER_ID':'wvp-zlm-01',
         'CAMERA_STORAGE_ORIGIN':'http://sfp-wvp-cloud-storage-1:18082','CAMERA_STORAGE_TOKEN':state['credentials']['STORAGE_TOKEN'],
         'CAMERA_SD_CLOCK_ORIGIN':'http://sfp-wvp-sd-clock-20261106:18083','CAMERA_SD_CLOCK_TOKEN':clock['token'],
         'CAMERA_NODE_RETENTION_DAYS':'7','CAMERA_RECORDING_ROOT':'/opt/media/www/record'}
    write_private('.env.app',''.join(k+'='+v+'\n' for k,v in env.items()))
    write_private('.env.postgres','POSTGRES_USER=sfp_owner\nPOSTGRES_DB=camera_trial\nPOSTGRES_PASSWORD='+secrets.token_hex(32)+'\n')
    write_private('private/setup.json',json.dumps({'archiveSha256':sha,'applicationRolePassword':app_password,'baseline':BASE}))
    compose('up','-d','postgres')
    print(json.dumps({'phase':'prepared','formalDatabaseTouched':False,'hostPortsPublished':False}))


def restore():
    if (ROOT/'private/imported.json').exists():
        raise RuntimeError('Import receipt exists; do not replay writes')
    setup=json.loads((ROOT/'private/setup.json').read_text())
    sql("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sfp_app') THEN CREATE ROLE sfp_app LOGIN PASSWORD '"+setup['applicationRolePassword']+"'; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='vector_probe_owner') THEN CREATE ROLE vector_probe_owner NOLOGIN; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sfp_auditor') THEN CREATE ROLE sfp_auditor NOLOGIN; END IF; END $$;")
    for name in ['schema.sql','ledger.sql']:
        try:
            sql((ROOT/'private'/name).read_text())
        except Exception:
            raise RuntimeError('Schema restore failed; retain isolated database for inspection')
    data=json.loads((ROOT/'private/trial-data.json').read_text())
    order=['system_roles','enterprises','users','admin_users','leads','construction_projects','construction_rooms',
           'construction_members','construction_stage_settings','construction_stage_assignments','construction_cameras',
           'construction_camera_bindings','construction_camera_recording_policies','construction_camera_retention_defaults']
    statements=['BEGIN;']
    for t in order:
        rows=data[t]
        if not rows:continue
        encoded=json.dumps(rows,ensure_ascii=True)
        if '$sfp_fixture$' in encoded:raise ValueError('Unexpected fixture delimiter')
        statements.append('INSERT INTO app.'+t+' OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_recordset(NULL::app.'+t+',$sfp_fixture$'+encoded+'$sfp_fixture$);')
        if 'id' in rows[0]:
            statements.append("SELECT setval(pg_get_serial_sequence('app."+t+"','id'),(SELECT max(id) FROM app."+t+"),true);")
    statements.append('COMMIT;')
    sql('\n'.join(statements))
    counts={k:len(v) for k,v in data.items()}
    write_private('private/imported.json',json.dumps({'counts':counts,'schemaSha256':hashlib.sha256((ROOT/'private/schema.sql').read_bytes()).hexdigest()}))
    print(json.dumps({'phase':'restored','counts':counts,'sessionsCopied':0,'wechatIdentitiesCopied':0}))


def retry_schema():
    if (ROOT/'private/imported.json').exists():raise RuntimeError('Do not replace an imported trial database')
    if sql('SELECT count(*) FROM app.users;').decode().splitlines()[2].strip()!='0':raise RuntimeError('Failed schema database contains users')
    sql('ALTER DATABASE camera_trial RENAME TO camera_trial_failed_schema_01;\nCREATE DATABASE camera_trial OWNER sfp_owner;','postgres')
    restore()


def start():
    if not (ROOT/'private/imported.json').exists():raise RuntimeError('Verified fixture import required')
    output=run(['docker','build','--network=none','-t','sfp-camera-trial:20261106-001',str(ROOT)])
    write_private('private/build.log',output.decode(errors='replace'))
    compose('up','-d','gateway')
    print(json.dumps({'phase':'started','service':APP,'image':run(['docker','image','inspect','sfp-camera-trial:20261106-001','--format','{{.Id}}']).decode().strip()}))


if __name__=='__main__':
    if os.geteuid()!=0:raise RuntimeError('Root required')
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('phase',choices=['prepare','network','restore','schema-retry','start']);parser.add_argument('--sha256')
    args=parser.parse_args()
    ROOT.mkdir(mode=0o700,parents=True,exist_ok=True);ROOT.chmod(0o700)
    if args.phase=='prepare':prepare(args.sha256)
    elif args.phase=='network':repair_trial_network()
    elif args.phase=='restore':restore()
    elif args.phase=='schema-retry':retry_schema()
    else:start()
