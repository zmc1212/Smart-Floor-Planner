# Dedicated database-only SSH forwarder. Keep this separate from the Embedding tunnel.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$mutexName = 'Local\SFP-Remote-Dev-Tunnel'
$localPorts = @(5432, 55432)

function Get-ListeningLocalPort {
    try {
        @(Get-NetTCPConnection -State Listen -LocalPort $localPorts -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty LocalPort -Unique)
    } catch {
        throw 'SFP remote tunnel cannot inspect local listening ports.'
    }
}

function Assert-LocalPortsFree {
    $busyPorts = @(Get-ListeningLocalPort | Sort-Object -Unique)
    if ($busyPorts.Count -gt 0) {
        $portList = ($busyPorts | ForEach-Object { [string]$_ }) -join ', '
        throw "SFP remote tunnel cannot start: local port(s) already listening: $portList."
    }
}

$mutex = $null
$createdNew = $false
try {
    $mutex = [System.Threading.Mutex]::new($true, $mutexName, [ref]$createdNew)
    if (-not $createdNew) {
        $mutex.Dispose()
        $mutex = $null
        throw 'SFP remote tunnel is already running.'
    }

    Assert-LocalPortsFree

    $identityPath = Join-Path $env:USERPROFILE '.ssh/toonflow_remote_ed25519'
    $sshArguments = @(
        '-N'
        '-T'
        '-p'
        '22'
        '-i'
        $identityPath
        '-o'
        'BatchMode=yes'
        '-o'
        'StrictHostKeyChecking=yes'
        '-o'
        'ExitOnForwardFailure=yes'
        '-o'
        'ServerAliveInterval=15'
        '-o'
        'ServerAliveCountMax=3'
        '-L'
        '127.0.0.1:5432:127.0.0.1:15432'
        '-L'
        '127.0.0.1:55432:127.0.0.1:15433'
        'Administrator@192.168.10.54'
    )

    while ($true) {
        Assert-LocalPortsFree
        & ssh.exe @sshArguments
        Start-Sleep -Seconds 5
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
} finally {
    if ($mutex) {
        if ($createdNew) {
            try { $mutex.ReleaseMutex() } catch { }
        }
        $mutex.Dispose()
    }
}
