# FX Analytics - Setup & Build for Windows
# Run this script in PowerShell from the project root folder

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FX Analytics - Windows Build Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
Write-Host "[1/6] Checking Python..." -ForegroundColor Yellow
$python = $null
foreach ($cmd in @("python", "python3", "py")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match "Python 3") {
            $python = $cmd
            Write-Host "  Found: $ver" -ForegroundColor Green
            break
        }
    } catch {}
}
if (-not $python) {
    Write-Host "  Python 3 not found!" -ForegroundColor Red
    Write-Host "  Download from: https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "  Make sure to check 'Add Python to PATH' during install!" -ForegroundColor Yellow
    exit 1
}

# Check Node.js
Write-Host "[2/6] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = node --version 2>&1
    Write-Host "  Found: Node.js $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  Node.js not found!" -ForegroundColor Red
    Write-Host "  Download from: https://nodejs.org/ (LTS version)" -ForegroundColor Yellow
    exit 1
}

# Install Node.js dependencies
Write-Host "[3/6] Installing Node.js dependencies..." -ForegroundColor Yellow
npm install 2>&1 | Select-Object -Last 3

# Install Python dependencies
Write-Host "[4/6] Installing Python backend dependencies..." -ForegroundColor Yellow
Push-Location backend
& $python -m pip install -r requirements.txt pyinstaller 2>&1 | Select-Object -Last 5
Pop-Location

# Build Python backend with PyInstaller
Write-Host "[5/6] Building Python backend (PyInstaller)..." -ForegroundColor Yellow
Push-Location backend
& $python build_backend.py 2>&1 | Select-Object -Last 5
Pop-Location

if (-not (Test-Path "backend_dist/fx-backend/fx-backend.exe")) {
    Write-Host "  Backend build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Backend built successfully" -ForegroundColor Green

# Build frontend + Electron
Write-Host "[6/6] Building Electron app..." -ForegroundColor Yellow
npm run build 2>&1 | Select-Object -Last 3
npx electron-builder --dir 2>&1 | Select-Object -Last 5

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  BUILD COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Output folder: electron-dist\win-unpacked\" -ForegroundColor Cyan
Write-Host ""
Write-Host "To run: double-click 'FX Analytics.exe'" -ForegroundColor Cyan
Write-Host "To distribute: copy the whole 'win-unpacked' folder to a USB drive" -ForegroundColor Cyan
Write-Host ""
