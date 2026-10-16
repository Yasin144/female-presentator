<#
.SYNOPSIS
Prepare a dedicated local CPU runtime for Caption Eraser AI.
.DESCRIPTION
Creates .caption-eraser-venv beside this script in the source project, or in
the user's caption cache when the script is distributed separately. Existing
voice, singing and system Python environments are left in place. A working
caption runtime is verified and reused without reinstalling packages.
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup-Caption-Eraser-AI.ps1
.EXAMPLE
.\Setup-Caption-Eraser-AI.ps1 -Python 'C:\Python310\python.exe' -InstallRoot 'D:\voice'
#>
[CmdletBinding()]
param(
  [string]$Python = '',
  [string]$InstallRoot = '',
  [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $InstallRoot) {
  if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json') -PathType Leaf) {
    $InstallRoot = $PSScriptRoot
  } else {
    $InstallRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache\pattan-caption-eraser'
  }
}
$captionRuntimeRoot = [IO.Path]::GetFullPath($InstallRoot)
$captionVenv = Join-Path $captionRuntimeRoot '.caption-eraser-venv'
$captionPython = Join-Path $captionVenv 'Scripts\python.exe'
$captionModel = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache\pattan-caption-eraser\big-lama.pt'

function Test-CaptionPythonCode {
  param([string]$Executable, [string[]]$PrefixArguments, [string]$Code)
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Executable @PrefixArguments '-I' '-c' $Code > $null 2> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Invoke-CaptionPython {
  param([string]$Executable, [string[]]$PythonArguments)
  & $Executable @PythonArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Caption Eraser AI setup command failed (exit $LASTEXITCODE). Check the displayed error, internet access and free disk space; then retry setup."
  }
}

$runtimeCheck = "import sys, struct, cv2, numpy, torch; assert sys.prefix != sys.base_prefix; assert struct.calcsize('P') == 8; assert hasattr(torch, 'jit') and hasattr(torch, 'inference_mode'); torch.zeros(1).numpy()"
if ((Test-Path -LiteralPath $captionPython -PathType Leaf) -and
    (Test-CaptionPythonCode -Executable $captionPython -PrefixArguments @() -Code $runtimeCheck)) {
  Write-Host 'Caption Eraser AI runtime is already ready. No packages were reinstalled.'
  Write-Host "Python: $captionPython"
  Write-Host "Model cache: $captionModel"
  exit 0
}
if ($CheckOnly) {
  throw "Caption Eraser AI runtime is not ready at $captionPython. Run this script without -CheckOnly to prepare it."
}

if (Test-Path -LiteralPath $captionVenv) {
  $captionEnvironment = Get-Item -LiteralPath $captionVenv -Force
  if (($captionEnvironment.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'The caption environment path is a link. Choose a separate -InstallRoot to preserve existing environments.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $captionVenv 'pyvenv.cfg') -PathType Leaf) -or
      -not (Test-Path -LiteralPath $captionPython -PathType Leaf)) {
    throw "The existing $captionVenv is not a complete Python environment. Choose another -InstallRoot; this script preserves the existing folder."
  }
} else {
  $baseCheck = "import sys, struct, venv; assert (3, 10) <= sys.version_info[:2] <= (3, 14); assert struct.calcsize('P') == 8"
  $baseCandidates = @()
  if ($Python) {
    if (Test-Path -LiteralPath $Python -PathType Leaf) {
      $baseCandidates += @{ Executable = [IO.Path]::GetFullPath($Python); Arguments = @() }
    } else {
      $pythonCommand = Get-Command -Name $Python -CommandType Application -ErrorAction SilentlyContinue
      if ($pythonCommand) { $baseCandidates += @{ Executable = $pythonCommand.Source; Arguments = @() } }
    }
  } else {
    if ($env:LOCALAPPDATA) {
      foreach ($version in @('Python310', 'Python311', 'Python312', 'Python313', 'Python314')) {
        $candidate = Join-Path $env:LOCALAPPDATA "Programs\Python\$version\python.exe"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
          $baseCandidates += @{ Executable = $candidate; Arguments = @() }
        }
      }
    }
    foreach ($commandName in @('python', 'python3')) {
      $pythonCommand = Get-Command -Name $commandName -CommandType Application -ErrorAction SilentlyContinue
      if ($pythonCommand) { $baseCandidates += @{ Executable = $pythonCommand.Source; Arguments = @() } }
    }
    $launcher = Get-Command -Name 'py' -CommandType Application -ErrorAction SilentlyContinue
    if ($launcher) {
      foreach ($version in @('-3.10', '-3.11', '-3.12', '-3.13', '-3.14')) {
        $baseCandidates += @{ Executable = $launcher.Source; Arguments = @($version) }
      }
    }
  }
  $basePython = $null
  foreach ($candidate in $baseCandidates) {
    if (Test-CaptionPythonCode -Executable $candidate.Executable -PrefixArguments $candidate.Arguments -Code $baseCheck) {
      $basePython = $candidate
      break
    }
  }
  if (-not $basePython) {
    throw 'Install 64-bit Python 3.10 through 3.14, or pass -Python with its executable path. No existing environment was changed.'
  }
  Write-Host "Creating dedicated Caption Eraser environment: $captionVenv"
  New-Item -ItemType Directory -Path $captionRuntimeRoot -Force | Out-Null
  $createArguments = @($basePython.Arguments) + @('-I', '-m', 'venv', $captionVenv)
  Invoke-CaptionPython -Executable $basePython.Executable -PythonArguments $createArguments
}

if (-not (Test-CaptionPythonCode -Executable $captionPython -PrefixArguments @() -Code 'import sys; assert sys.prefix != sys.base_prefix')) {
  throw "The Python executable at $captionPython is not running in a virtual environment. Choose another -InstallRoot to keep system Python unchanged."
}
Write-Host 'Installing CPU dependencies into the dedicated caption environment. This may take several minutes.'
Invoke-CaptionPython -Executable $captionPython -PythonArguments @('-I', '-m', 'ensurepip', '--upgrade')
Invoke-CaptionPython -Executable $captionPython -PythonArguments @('-I', '-m', 'pip', 'install', '--upgrade', 'pip')
Invoke-CaptionPython -Executable $captionPython -PythonArguments @('-I', '-m', 'pip', 'install', 'numpy>=1.26,<3', 'opencv-python-headless>=4.10,<5')
Invoke-CaptionPython -Executable $captionPython -PythonArguments @('-I', '-m', 'pip', 'install', 'torch==2.12.0', '--index-url', 'https://download.pytorch.org/whl/cpu')

if (-not (Test-CaptionPythonCode -Executable $captionPython -PrefixArguments @() -Code $runtimeCheck)) {
  throw "Caption Eraser AI dependencies did not pass verification at $captionPython. Check the installation output and retry setup."
}
Write-Host 'Caption Eraser AI runtime is ready.'
Write-Host "Python: $captionPython"
Write-Host "Model cache: $captionModel"
Write-Host 'The first AI erasure verifies or downloads the 196 MiB LaMa model. Existing verified weights are reused.'
