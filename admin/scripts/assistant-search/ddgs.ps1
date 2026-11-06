param(
  [Parameter(Mandatory=$true)][string]$Python,
  [string]$Proxy,
  [ValidateRange(1024,65535)][int]$Port=18098
)
$ErrorActionPreference='Stop'
$sfpProxyBefore=$env:DDGS_PROXY
try {
  & $Python -c 'import importlib.metadata as m; assert m.version("ddgs")=="9.16.1", "Install ddgs-requirements-lock.txt first"'
  if ($LASTEXITCODE -ne 0) { throw 'Pinned DDGS runtime is required' }
  $env:DDGS_PROXY=$Proxy
  & $Python -m uvicorn ddgs.api_server.api:app --host 127.0.0.1 --port $Port --no-access-log
  if ($LASTEXITCODE -ne 0) { throw 'DDGS development API exited unsuccessfully' }
} finally { $env:DDGS_PROXY=$sfpProxyBefore }
