@echo off
setlocal
cd /d "%~dp0"

echo Creating clean portable package...

set SRC=electron-dist\win-unpacked
set DST=FX Analytics

if not exist "%SRC%\FX Analytics.exe" (
    echo ERROR: Build not found at %SRC%
    pause
    exit /b 1
)

if exist "%DST%" rmdir /s /q "%DST%"
mkdir "%DST%\app"

echo Copying application files...
xcopy "%SRC%\*" "%DST%\app\" /E /I /Q /Y >nul

echo Creating launcher...
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo Set fso = CreateObject^("Scripting.FileSystemObject"^)
echo appDir = fso.GetParentFolderName^(WScript.ScriptFullName^) ^& "\app"
echo WshShell.CurrentDirectory = appDir
echo WshShell.Run Chr^(34^) ^& appDir ^& "\FX Analytics.exe" ^& Chr^(34^), 1, False
) > "%DST%\FX Analytics.vbs"

echo Creating README...
(
echo FX Analytics - Portable Application
echo ====================================
echo.
echo To start: double-click "FX Analytics.vbs"
echo.
echo The "app" folder contains all program files.
echo Do not modify or delete files inside "app".
echo.
echo Requirements: Windows 10/11 x64
echo No additional software installation needed.
) > "%DST%\README.txt"

echo.
echo Done! Portable package created in: %DST%\
echo.
echo Contents:
dir "%DST%" /b
echo.
pause
