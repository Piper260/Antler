@echo off
setlocal EnableDelayedExpansion

:: Builds Antler. The real work is in scripts\build.js; this checks the
:: basics, asks which build to make, and opens the result.

chcp 65001 > nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Node.js was not found. Install it from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\electron-builder" (
    echo.
    echo Installing dependencies, this only happens once...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Check the messages above.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo Select build type:
echo   [1] Installer       - a setup .exe; models download on first launch
echo   [2] Portable folder - dist\win-unpacked, with every model
echo   [3] Both
echo.
set "choice="
set /p "choice=Enter selection [1-3, default 1]: "
if "!choice!"=="" set "choice=1"

set "failed=0"
if "!choice!"=="1" call :Build
if "!choice!"=="2" call :Build --dir
if "!choice!"=="3" (
    rem The installer build rewrites dist\win-unpacked without the ONNX models, so it goes first.
    call :Build
    if "!failed!"=="0" call :Build --dir
)
if not "!choice!"=="1" if not "!choice!"=="2" if not "!choice!"=="3" (
    echo Unknown selection: !choice!
    set "failed=1"
)

if "!failed!"=="0" (
    if "!choice!"=="2" (start "" "dist\win-unpacked") else (start "" "dist")
)

echo.
pause
exit /b !failed!

:Build
node scripts\build.js %*
if errorlevel 1 set "failed=1"
exit /b
