$ErrorActionPreference = 'Stop'
$root = 'D:\XiaoK-Embedding'
while ($true) {
    $process = Start-Process "$root\venv\Scripts\python.exe" -ArgumentList "$root\server.py" -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
    # Windows Task Scheduler does not reliably retry every forced child exit code.
    # Keep restart supervision in the task's parent process, regardless of Python exit code.
    Start-Sleep -Seconds 5
}
