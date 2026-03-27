@echo off
echo ================================================
echo  FX Analytics - Build Portable Desktop App
echo ================================================
echo.

REM Step 1: Build Python backend with PyInstaller
echo [1/3] Building Python backend...
cd /d "%~dp0..\backend"
python build_backend.py
if errorlevel 1 (
    echo ERROR: Backend build failed!
    pause
    exit /b 1
)
echo Backend built successfully.
echo.

REM Step 2: Build React frontend
echo [2/3] Building React frontend...
cd /d "%~dp0.."
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)
echo Frontend built successfully.
echo.

REM Step 3: Package with electron-builder
echo [3/3] Packaging with Electron...
call npx electron-builder --dir
if errorlevel 1 (
    echo ERROR: Electron packaging failed!
    pause
    exit /b 1
)
echo.
echo ================================================
echo  Build complete!
echo  Output: electron-dist\win-unpacked\
echo  Copy the folder to a USB drive and run
echo  "FX Analytics.exe"
echo ================================================
pause
