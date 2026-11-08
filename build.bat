@echo off
setlocal

:: Builds Antler. The real work, menu included, is in scripts\build.js;
:: this checks for Node, installs dependencies the first time, and keeps
:: the window open at the end.

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

node scripts\build.js --menu --open %*
set "failed=%errorlevel%"

pause
exit /b %failed%
