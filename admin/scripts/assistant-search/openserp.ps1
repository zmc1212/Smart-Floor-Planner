param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [string]$BrowserPath='C:/Program Files/Google/Chrome/Application/chrome.exe',
  [ValidateRange(1024,65535)][int]$Port=18098
)
$ErrorActionPreference='Stop'
# Windows amd64 v0.8.17 binary extracted from the official release archive.
# Archive SHA256: 5c03543863c00fc16e4285380bb6b066b1d130d8624cd06285fe52f711ddc21d
$sfpExpectedHash='511e6bb6c1977a4dda8be5bf1454843bb4edd794f709028b2011efa8914e0394'
$sfpExecutable=(Resolve-Path -LiteralPath $Executable).Path
$sfpBrowser=(Resolve-Path -LiteralPath $BrowserPath).Path
$sfpHasher=[Security.Cryptography.SHA256]::Create()
$sfpStream=[IO.File]::OpenRead($sfpExecutable)
try { $sfpActualHash=[BitConverter]::ToString($sfpHasher.ComputeHash($sfpStream)).Replace('-','').ToLowerInvariant() }
finally { $sfpStream.Dispose(); $sfpHasher.Dispose() }
if ($sfpActualHash -ne $sfpExpectedHash) {
  throw 'Pinned OpenSERP v0.8.17 Windows amd64 binary is required'
}
& $sfpExecutable serve --config (Join-Path $PSScriptRoot 'openserp.yaml') --host 127.0.0.1 --port $Port --browser-path $sfpBrowser --max_retries=0 --timeout=8 --insecure=false --save_log=false --leakless
if ($LASTEXITCODE -ne 0) { throw 'OpenSERP development API exited unsuccessfully' }
