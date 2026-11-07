param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Version','Help','Hardware','DownloadModels','VerifyModels','Parse')]
    [string]$Action,
    [string]$InputFile = 'input/jingyi.pdf',
    [string]$OutputFile = 'output/jingyi-standard.zip',
    [ValidateSet('basic','standard','advanced')][string]$Tier = 'standard'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$rootPath = 'D:\Smart-Floor-Planner-Dev\mineru-pilot'
$env:MINERU_HOME = Join-Path $rootPath 'state'
$env:MINERU_TELEMETRY_DISABLED = '1'
$env:MODELSCOPE_CACHE = Join-Path $rootPath 'cache/modelscope'
$env:HF_HOME = Join-Path $rootPath 'cache/huggingface'
$env:MINERU_MODEL_SMALL_BACKEND = 'onnx'
$env:MINERU_MODEL_VLM_ENGINE = 'llama-cpp'
$env:OMP_NUM_THREADS = '6'
$kit = Join-Path $rootPath '.venv/Scripts/mineru-kit.exe'
$mineru = Join-Path $rootPath '.venv/Scripts/mineru.exe'
if (!(Test-Path -LiteralPath (Join-Path $rootPath 'installation.json'))) { throw 'Install and inspect the dedicated environment first' }
if ($Action -eq 'Version') { & $mineru version --json }
elseif ($Action -eq 'Help') { & $kit parse --help }
elseif ($Action -eq 'Hardware') { & $kit hardware info --json }
elseif ($Action -eq 'DownloadModels') {
    $env:MINERU_MODEL_SOURCE = 'modelscope'
    & $kit models download --tier standard --small-backend onnx --vlm-engine llama-cpp --source modelscope
}
elseif ($Action -eq 'VerifyModels') {
    $env:MINERU_MODEL_SOURCE = 'local'
    & $kit models verify --tier standard --small-backend onnx --vlm-engine llama-cpp
}
elseif ($Action -eq 'Parse') {
    $inputPath = [IO.Path]::GetFullPath((Join-Path $rootPath $InputFile))
    $outputPath = [IO.Path]::GetFullPath((Join-Path $rootPath $OutputFile))
    foreach ($candidate in @($inputPath,$outputPath)) {
        if (!$candidate.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Parse paths must remain inside the dedicated root' }
    }
    if (Test-Path -LiteralPath $outputPath) { throw 'Preserve prior output; choose a new output filename' }
    if (!(Test-Path -LiteralPath $inputPath -PathType Leaf)) { throw 'Missing input file' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null
    $env:MINERU_MODEL_SOURCE = 'local'
    & $kit parse $inputPath -o $outputPath --tier $Tier --format zip --ocr-mode ocr
}
if ($LASTEXITCODE -ne 0) { throw "MinerU $Action failed: $LASTEXITCODE" }
