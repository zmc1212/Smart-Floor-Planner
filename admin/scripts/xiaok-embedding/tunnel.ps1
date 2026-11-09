# Run under the existing SSH-key owner. Never change host-key checking or expose the local port.
$ErrorActionPreference = 'Stop'
while ($true) {
    & ssh -N -T -i "$env:USERPROFILE/.ssh/toonflow_remote_ed25519" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 127.0.0.1:18089:127.0.0.1:8089 Administrator@192.168.10.54
    Start-Sleep -Seconds 5
}
