# Dedicated remote Docker dependency forwards. Database and Embedding tunnels stay separate.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$mutexName = 'Local\SFP-Remote-Docker-Services'
$localPorts = @(8080, 18080, 18081, 18082, 11935, 18554, 18084, 55434)

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
        '127.0.0.1:8080:127.0.0.1:8080'
        '-L'
        '127.0.0.1:18080:127.0.0.1:18080'
        '-L'
        '127.0.0.1:18081:127.0.0.1:18081'
        '-L'
        '127.0.0.1:18082:127.0.0.1:18082'
        '-L'
        '127.0.0.1:11935:127.0.0.1:11935'
        '-L'
        '127.0.0.1:18554:127.0.0.1:18554'
        '-L'
        '127.0.0.1:18084:127.0.0.1:18084'
        '-L'
        '127.0.0.1:55434:127.0.0.1:55434'
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
