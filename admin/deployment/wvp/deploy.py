"""Fresh, isolated WVP installer. No upgrades, device writes or data deletion."""
import argparse
import contextlib
import datetime
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
STATE = ROOT / ".state"
SERVICES = ("mysql", "redis", "zlm", "storage", "wvp")
SECRET_KEYS = ("MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD", "REDIS_PASSWORD",
               "WVP_ADMIN_PASSWORD", "WVP_PUSH_KEY", "SIP_PASSWORD",
               "ZLM_SECRET", "STORAGE_TOKEN")


def fail(message):
    raise RuntimeError(message)


def run(args, *, timeout=300, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        # Docker/Compose errors can contain environment values. Keep them private.
        fail("Command failed (exit %s): %s" % (result.returncode, " ".join(args[:3])))
    return result.stdout.decode("utf-8")


def write_private(path, value):
    # Atomic replacement also prevents a killed installer from leaving partial JSON.
    temporary = path.with_name(path.name + ".new")
    with temporary.open("w", encoding="utf-8", newline="\n") as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output, indent=2)
        output.write("\n")
    temporary.replace(path)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def verify_package():
    checksum = ROOT / "SHA256SUMS"
    if not checksum.is_file():
        fail("Missing SHA256SUMS. Use the exported release package, not this source directory.")
    checked = set()
    for line in checksum.read_text(encoding="utf-8").splitlines():
        digest, name = line.split("  ", 1)
        path = ROOT / name
        if not re.fullmatch(r"[a-f0-9]{64}", digest) or path.resolve().parent != ROOT or path.is_symlink():
            fail("Unsafe package checksum entry")
        with path.open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest() if sys.version_info >= (3, 11) else file_hash(source)
        if actual != digest:
            fail("Package checksum mismatch: " + name)
        checked.add(name)
    required = {"images.tar", "images.json", "deploy.sh", "deploy.py",
                "application.yml", "start-zlm.sh", "verify.py"}
    if not required.issubset(checked):
        fail("Package checksum list is incomplete")
    return read_json(ROOT / "images.json")


def file_hash(source):
    digest = hashlib.sha256()
    for block in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(block)
    return digest.hexdigest()


def validate_rtp_range(minimum, maximum):
    # The pinned ZLM PortManager asserts during the first RTP allocation below 36 ports.
    if not (1024 <= minimum <= maximum <= 65535) or not (36 <= maximum - minimum + 1 <= 500):
        fail("RTP range must contain 36..500 ports in 1024..65535; the pinned ZLM requires at least 36 ports")


def validate_options(args):
    if not args.public_ip:
        fail("--public-ip is required before the first installation.")
    try:
        address = ipaddress.IPv4Address(args.public_ip)
        if address.is_unspecified or address.is_multicast or address.is_loopback:
            fail("Use the server's camera-reachable IPv4 address.")
    except ipaddress.AddressValueError:
        fail("A valid --public-ip IPv4 address is required.")
    if not re.fullmatch(r"sfp-wvp[-a-z0-9]{0,40}", args.project):
        fail("Project must start with sfp-wvp and contain only lowercase letters, digits and hyphens.")
    ports = [args.sip_port, args.http_port, args.media_port, args.storage_port]
    if any(port < 1024 or port > 65535 for port in ports):
        fail("Service ports must be in 1024..65535")
    validate_rtp_range(args.rtp_min, args.rtp_max)
    if len(set(ports)) != len(ports) or any(args.rtp_min <= port <= args.rtp_max for port in ports):
        fail("Service ports and RTP range must not overlap")
    root = Path(args.data_dir)
    if not root.is_absolute() or root.resolve() in (Path("/"), Path("/datas"), Path("/var"), Path("/opt"), Path("/home")):
        fail("Choose a dedicated absolute data directory, such as /datas/sfp-wvp-data.")
    return {
        "project": args.project, "publicIp": str(address), "dataRoot": str(root.resolve()),
        "sipPort": args.sip_port, "httpPort": args.http_port, "mediaPort": args.media_port,
        "storagePort": args.storage_port, "rtpMin": args.rtp_min, "rtpMax": args.rtp_max,
    }


def preflight(settings):
    validate_rtp_range(settings["rtpMin"], settings["rtpMax"])
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        fail("This package requires Linux x86_64. ARM and Windows are not deployment targets.")
    if not shutil.which("docker"):
        fail("Install Docker Engine and Docker Compose v2 first.")
    context = json.loads(run(["docker", "context", "inspect"]))[0]
    endpoint = os.environ.get("DOCKER_HOST") or context["Endpoints"]["docker"]["Host"]
    if not endpoint.startswith("unix://"):
        fail("Run on the target Linux host using its local Docker socket, not a remote Docker context.")
    info = json.loads(run(["docker", "info", "--format", "{{json .}}"]))
    if info.get("ServerErrors") or not info.get("ServerVersion"):
        fail("Docker daemon is unavailable; check the local socket and user permissions.")
    if info["OSType"] != "linux" or info["Architecture"] not in ("x86_64", "amd64"):
        fail("Docker must run Linux amd64 containers.")
    if "rootless" in " ".join(info.get("SecurityOptions", [])):
        fail("This first release requires a standard rootful Docker Engine.")
    version = run(["docker", "compose", "version", "--short"]).strip().lstrip("v")
    match = re.match(r"(\d+)\.(\d+)", version)
    if not match or tuple(map(int, match.groups())) < (2, 24):
        fail("Docker Compose v2.24 or later is required.")
    parent = Path(settings["dataRoot"])
    while not parent.exists():
        parent = parent.parent
    available = shutil.disk_usage(parent).free
    if available < 10 * 1024 ** 3:
        fail("At least 10 GiB of free data-disk space is required for a small trial.")
    if info["MemTotal"] < 4 * 1024 ** 3 - 64 * 1024 ** 2:
        fail("This trial profile requires at least 4 GiB available to Docker; review a smaller host separately.")
    print(json.dumps({"preflight": "passed", "engine": info["ServerVersion"], "compose": version,
                      "dockerMemoryMiB": info["MemTotal"] // 1024 ** 2,
                      "dataFreeGiB": round(available / 1024 ** 3, 1),
                      "scope": "Host/package checks only; public network and physical camera remain unverified"}))


def project_containers(settings):
    ids = run(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + settings["project"]]).split()
    return json.loads(run(["docker", "inspect", *ids])) if ids else []


def assert_owner(state):
    marker = Path(state["settings"]["dataRoot"]) / ".sfp-wvp-owner.json"
    if not marker.is_file() or read_json(marker) != state["owner"]:
        fail("Data directory ownership does not match this installation.")
    for item in project_containers(state["settings"]):
        labels = item["Config"].get("Labels") or {}
        if labels.get("com.smartfloor.wvp.install") != state["owner"]["installId"]:
            fail("Refusing to operate on a project/container owned by another installation.")


def check_ports(settings):
    endpoints = [(settings["sipPort"], kind) for kind in (socket.SOCK_STREAM, socket.SOCK_DGRAM)]
    endpoints += [(settings[key], socket.SOCK_STREAM) for key in ("httpPort", "mediaPort", "storagePort")]
    endpoints += [(port, kind) for port in range(settings["rtpMin"], settings["rtpMax"] + 1)
                  for kind in (socket.SOCK_STREAM, socket.SOCK_DGRAM)]
    with contextlib.ExitStack() as stack:
        for port, kind in endpoints:
            try:
                sock = stack.enter_context(socket.socket(socket.AF_INET, kind))
                sock.bind(("0.0.0.0", port))
            except OSError:
                fail("Port is occupied: %s/%s; no existing service was stopped." %
                     (port, "tcp" if kind == socket.SOCK_STREAM else "udp"))


def mount(source, target, readonly=False):
    return {"type": "bind", "source": str(source), "target": target, "read_only": readonly,
            "bind": {"create_host_path": False}}


def make_compose(state, manifest):
    settings, credentials = state["settings"], state["credentials"]
    validate_rtp_range(settings["rtpMin"], settings["rtpMax"])
    data = Path(settings["dataRoot"])
    images = manifest["images"]
    common = {"TZ": "Asia/Shanghai"}
    runtime = {**common, **credentials, "PUBLIC_IP": settings["publicIp"],
               "SIP_PORT": str(settings["sipPort"]), "SIP_DOMAIN": "3402000000",
               "SIP_SERVER_ID": "34020000002000000001",
               "MEDIA_HTTP_PORT": str(settings["mediaPort"]),
               "RTP_MIN": str(settings["rtpMin"]), "RTP_MAX": str(settings["rtpMax"])}

    def service(name, env, mounts, health, limit):
        return {"image": images[name], "pull_policy": "never", "restart": "unless-stopped",
                "platform": "linux/amd64", "environment": env, "volumes": mounts,
                "mem_limit": limit, "pids_limit": 256,
                "labels": {"com.smartfloor.wvp.install": state["owner"]["installId"]},
                "logging": {"driver": "json-file", "options": {"max-size": "10m", "max-file": "3"}},
                "healthcheck": {"test": health, "interval": "10s", "timeout": "5s",
                                "start_period": "60s", "retries": 24}}

    mysql = service("mysql", {**common, **{key: credentials[key] for key in
                    ("MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD", "WVP_ADMIN_PASSWORD", "WVP_PUSH_KEY")},
                    "MYSQL_DATABASE": "wvp", "MYSQL_USER": "wvp"},
                    [mount(data / "mysql", "/var/lib/mysql")],
                    ["CMD-SHELL", 'MYSQL_PWD="$$MYSQL_PASSWORD" mysql --protocol=tcp -h 127.0.0.1 -u wvp wvp -Nse "SELECT COUNT(*) FROM wvp_user" > /dev/null'], "1g")
    mysql["command"] = ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci"]
    redis = service("redis", {"REDIS_PASSWORD": credentials["REDIS_PASSWORD"]},
                    [mount(data / "redis", "/data")],
                    ["CMD-SHELL", 'REDISCLI_AUTH="$$REDIS_PASSWORD" redis-cli ping | grep -q PONG'], "128m")
    redis["command"] = ["sh", "-ec", 'exec redis-server --appendonly yes --requirepass "$$REDIS_PASSWORD"']
    zlm_env = {key: runtime[key] for key in ("TZ", "ZLM_SECRET", "MEDIA_HTTP_PORT", "RTP_MIN", "RTP_MAX")}
    zlm = service("zlm", zlm_env,
                  [mount(data / "media", "/opt/media/www"), mount(data / "zlm-logs", "/opt/media/log"),
                   mount(data / "zlm-snap", "/opt/media/bin/www/snap"),
                   mount(ROOT / "start-zlm.sh", "/bootstrap/start-zlm.sh", True)],
                  ["CMD-SHELL", 'curl -fsS --get --data-urlencode "secret=$$ZLM_SECRET" http://127.0.0.1:$$MEDIA_HTTP_PORT/index/api/getThreadsLoad | grep -q \'"code" *: *0\''], "512m")
    zlm["ports"] = ["127.0.0.1:{0}:{0}".format(settings["mediaPort"])]
    zlm["ports"] += ["{0}-{1}:{0}-{1}/{2}".format(settings["rtpMin"], settings["rtpMax"], protocol)
                     for protocol in ("tcp", "udp")]
    wvp_keys = ("TZ", "REDIS_PASSWORD", "MYSQL_PASSWORD", "PUBLIC_IP", "SIP_PORT",
                "SIP_DOMAIN", "SIP_SERVER_ID", "SIP_PASSWORD", "MEDIA_HTTP_PORT", "ZLM_SECRET", "RTP_MIN", "RTP_MAX")
    wvp = service("wvp", {**{key: runtime[key] for key in wvp_keys},
                          "JAVA_TOOL_OPTIONS": "-Xms128m -Xmx768m"},
                  [mount(data / "wvp-state", "/home/wvp"), mount(data / "media", "/opt/media/www"),
                   mount(data / "wvp-logs", "/opt/wvp/logs"), mount(data / "wvp-snap", "/opt/wvp/snap"),
                   mount(ROOT / "application.yml", "/config/application.yml", True)],
                  ["CMD", "curl", "-fsS", "http://127.0.0.1:18080/"], "1536m")
    wvp["command"] = ["--user-settings.jwk-file=/home/wvp/jwk.json"]
    wvp["depends_on"] = {name: {"condition": "service_healthy"} for name in ("mysql", "redis", "zlm")}
    wvp["ports"] = ["127.0.0.1:%s:18080" % settings["httpPort"]]
    wvp["ports"] += ["{0}:{0}/{1}".format(settings["sipPort"], protocol) for protocol in ("tcp", "udp")]
    storage = service("storage", {"STORAGE_TOKEN": credentials["STORAGE_TOKEN"],
                      "STORAGE_NODE_ID": "wvp-zlm-01", "STORAGE_INODE_MODE": "reported"},
                      [mount(data / "media", "/media", True)],
                      ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:18082/health',timeout=2).read()"], "64m")
    storage.update({"read_only": True, "cap_drop": ["ALL"],
                    "security_opt": ["no-new-privileges:true"],
                    "ports": ["127.0.0.1:%s:18082" % settings["storagePort"]]})
    checker = {"image": images["storage"], "pull_policy": "never", "profiles": ["tools"],
               "environment": {key: runtime[key] for key in ("WVP_ADMIN_PASSWORD", "ZLM_SECRET", "MEDIA_HTTP_PORT")},
               "entrypoint": ["python", "/bundle/verify.py"], "mem_limit": "128m",
               "volumes": [mount(ROOT / "verify.py", "/bundle/verify.py", True)],
               "labels": {"com.smartfloor.wvp.install": state["owner"]["installId"]}}
    checker["environment"]["STORAGE_TOKEN"] = credentials["STORAGE_TOKEN"]
    return {"name": settings["project"],
            "services": {"mysql": mysql, "redis": redis, "zlm": zlm, "wvp": wvp,
                         "storage": storage, "checker": checker}}


def compose(state, *args, **kwargs):
    return run(["docker", "compose", "-p", state["settings"]["project"],
                "-f", str(STATE / "compose.private.json"), *args], **kwargs)


def load_state():
    if not (STATE / "installation.private.json").is_file():
        fail("This directory has no installation. Run install first.")
    state = read_json(STATE / "installation.private.json")
    assert_owner(state)
    return state


def install(args):
    manifest = verify_package()
    if (STATE / "installation.private.json").exists():
        state = load_state()
        if state["owner"]["release"] != manifest["release"]:
            fail("This installer does not perform in-place upgrades.")
        settings = state["settings"]
        if args.public_ip and args.public_ip != settings["publicIp"]:
            fail("Existing public IP differs. Do not silently reconfigure an active installation.")
    else:
        if not args.public_ip:
            fail("First install requires --public-ip.")
        settings = validate_options(args)
        root = Path(settings["dataRoot"])
        if root.exists() and any(root.iterdir()):
            fail("Fresh installation requires an empty dedicated data directory.")
        preflight(settings)
        if project_containers(settings):
            fail("Project already exists and is not owned by this release directory.")
        check_ports(settings)
        state = {"settings": settings, "owner": {"installId": secrets.token_hex(16),
                  "release": manifest["release"], "project": settings["project"],
                  "dataRoot": settings["dataRoot"]},
                 "credentials": {key: secrets.token_hex(16 if key in ("WVP_PUSH_KEY", "SIP_PASSWORD") else 24)
                                 for key in SECRET_KEYS}}
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        write_private(root / ".sfp-wvp-owner.json", state["owner"])
        write_private(STATE / "installation.private.json", state)
    preflight(settings)
    assert_owner(state)
    for directory in ("mysql", "redis", "media/record", "wvp-state", "wvp-logs", "wvp-snap", "zlm-logs", "zlm-snap"):
        (Path(settings["dataRoot"]) / directory).mkdir(parents=True, exist_ok=True)
    # The pinned WVP image runs as 10001, while ZLM writes shared files as root.
    # Do not recursively rewrite existing recordings or database ownership.
    uid, gid = manifest["wvpUser"]["uid"], manifest["wvpUser"]["gid"]
    for directory in ("wvp-state", "wvp-logs", "wvp-snap", "media", "media/record"):
        path = Path(settings["dataRoot"]) / directory
        os.chown(path, uid, gid)
        os.chmod(path, 0o2775 if directory.startswith("media") else 0o700)
    print("Loading pinned offline images...", flush=True)
    run(["docker", "load", "-i", str(ROOT / "images.tar")], timeout=1200)
    for image in manifest["images"].values():
        actual = json.loads(run(["docker", "image", "inspect", image]))[0]
        if actual["Id"] != image or actual["Os"] != "linux" or actual["Architecture"] != "amd64":
            fail("Imported image identity/platform mismatch")
    write_private(STATE / "compose.private.json", make_compose(state, manifest))
    compose(state, "config", "--quiet")
    print("Starting this isolated project; waiting for five healthy services...", flush=True)
    compose(state, "up", "-d", "--pull", "never", "--no-build", "--wait", "--wait-timeout", "300",
            *SERVICES, timeout=420)
    print(compose(state, "--profile", "tools", "run", "--rm", "--no-deps", "checker"), end="")
    write_private(STATE / "ready.json", {"release": manifest["release"],
                  "verifiedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "scope": "Infrastructure only; camera/public-network/product acceptance not performed"})
    print("Infrastructure checks passed. Credentials: .state/installation.private.json (private).")
    print("Management HTTP is loopback-only; use the README SSH tunnel.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preflight", "install", "verify", "status", "stop", "backup"))
    parser.add_argument("--public-ip")
    parser.add_argument("--data-dir", default="/datas/sfp-wvp-data")
    parser.add_argument("--project", default="sfp-wvp")
    for flag, default in (("sip-port", 15060), ("http-port", 18080), ("media-port", 8080),
                          ("storage-port", 18082), ("rtp-min", 30000), ("rtp-max", 30099)):
        parser.add_argument("--" + flag, type=int, default=default)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "preflight":
        verify_package()
        settings = read_json(STATE / "installation.private.json")["settings"] if (
            STATE / "installation.private.json").exists() else validate_options(args)
        preflight(settings)
        if not project_containers(settings):
            check_ports(settings)
        return
    STATE.mkdir(mode=0o700, exist_ok=True)
    import fcntl
    with (STATE / "operation.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("Another operation owns this deployment lock.")
        if args.command == "install":
            install(args)
            return
        state = load_state()
        if args.command == "verify":
            print(compose(state, "--profile", "tools", "run", "--rm", "--no-deps", "checker"), end="")
        elif args.command == "status":
            print(compose(state, "ps", "--all"), end="")
        elif args.command == "stop":
            print(compose(state, "stop", *SERVICES), end="")
            print("Only this installation was stopped. All data and configuration were retained.")
        elif args.command == "backup":
            # A transaction-consistent SQL backup, not a recording-filesystem snapshot.
            backup = STATE / ("backup-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
            backup.mkdir(mode=0o700)
            sql = compose(state, "exec", "-T", "mysql", "sh", "-ec",
                          'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --events --triggers --no-tablespaces --set-gtid-purged=OFF wvp')
            dump = backup / "wvp.sql"
            dump.write_text(sql, encoding="utf-8")
            shutil.copy2(STATE / "installation.private.json", backup / "installation.private.json")
            (backup / "SHA256SUMS").write_text(hashlib.sha256(dump.read_bytes()).hexdigest() + "  wvp.sql\n")
            print("Private database/configuration backup saved: " + str(backup))
            print("Recordings, JWK and other data files are NOT included; this is not full disaster recovery.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        # Do not render command arguments or private configuration on failure.
        message = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        print("FAILED: " + message, file=sys.stderr)
        print("Existing services/data were not automatically removed. Inspect status before retrying.", file=sys.stderr)
        sys.exit(1)
