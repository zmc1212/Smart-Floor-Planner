"""Optional host profile for legacy Docker loopback exposure; not in release 001.

The root-owned JSON pins the new project's subnet and ports. Install before its
containers start. This changes only two exact raw/PREROUTING rules and never
flushes a table, restarts Docker, or opens a port. Recreating the Docker network
requires checking its subnet and updating this host profile before startup.
"""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess


def rules(config):
    if not re.fullmatch(r"sfp-wvp[-a-z0-9]{0,40}", config["project"]):
        raise ValueError("Unexpected project")
    if not re.fullmatch(r"[a-zA-Z0-9_.-]{1,15}", config["externalInterface"]):
        raise ValueError("Unexpected interface")
    subnet = ipaddress.IPv4Network(config["subnet"], strict=True)
    if not subnet.is_private or not 16 <= subnet.prefixlen <= 30 or subnet.is_loopback:
        raise ValueError("Expected a dedicated private Docker subnet")
    result = []
    for suffix, destination, ports in (
        ("loopback", "127.0.0.1/32", config["hostHttpPorts"]),
        ("direct", str(subnet), config["containerPrivatePorts"]),
    ):
        if not 1 <= len(ports) <= 15 or any(type(p) is not int or not 1024 <= p <= 65535 for p in ports):
            raise ValueError("Invalid protected ports")
        result.append(["-i", config["externalInterface"], "-d", destination,
                       "-p", "tcp", "-m", "multiport", "--dports", ",".join(map(str, ports)),
                       "-m", "comment", "--comment", config["project"] + "-" + suffix,
                       "-j", "DROP"])
    return result


def invoke(action, rule):
    return subprocess.run(["/sbin/iptables", "-w", "5", "-t", "raw", action,
                           "PREROUTING"] + rule, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("apply", "check", "remove"))
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    stat = args.config.stat()
    if os.geteuid() != 0 or stat.st_uid != 0 or stat.st_mode & 0o022 or args.config.is_symlink():
        raise ValueError("Run as root with a root-owned configuration, not writable by other users")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    selected = rules(config)
    for rule in selected:
        found = invoke("-C", rule)
        if found.returncode not in (0, 1):
            raise RuntimeError("Could not inspect iptables")
        if args.action == "apply" and found.returncode == 1:
            if invoke("-I", rule).returncode:
                raise RuntimeError("Could not insert dedicated rule")
        elif args.action == "remove" and found.returncode == 0:
            if invoke("-D", rule).returncode:
                raise RuntimeError("Could not remove dedicated rule")
        elif args.action == "check" and found.returncode != 0:
            raise RuntimeError("Dedicated rule is missing")
    print(json.dumps({"project": config["project"], "action": args.action,
                      "rules": len(selected), "result": "passed"}))


if __name__ == "__main__":
    main()
