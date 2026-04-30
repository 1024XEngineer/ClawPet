$ErrorActionPreference = "Stop"

$skillRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot "generate.py"
$distRoot = Join-Path $skillRoot "runtime"
$tempBuildRoot = Join-Path ([System.IO.Path]::GetTempPath()) "student-ppt-pet-build"
$workRoot = Join-Path $tempBuildRoot "build-runtime"
$specRoot = Join-Path $tempBuildRoot "spec"
$runtimeDir = Join-Path $distRoot "ppt_engine"
$finalExe = Join-Path $runtimeDir "ppt_engine.exe"
$templateDir = Join-Path $skillRoot "assets\\templates"

New-Item -ItemType Directory -Force -Path $tempBuildRoot | Out-Null
New-Item -ItemType Directory -Force -Path $specRoot | Out-Null

if (Test-Path $runtimeDir) {
  Remove-Item -LiteralPath $runtimeDir -Recurse -Force
}

python -m PyInstaller `
  --noconfirm `
  --onedir `
  --name ppt_engine `
  --distpath $distRoot `
  --workpath $workRoot `
  --specpath $specRoot `
  --add-data "${templateDir};assets/templates" `
  $source

Write-Host "Built:" $finalExe
