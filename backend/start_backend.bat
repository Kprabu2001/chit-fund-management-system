@echo off
title AuctionTicket Django Backend
cd /d "%~dp0"
echo ===========================================
echo   Starting AuctionTicket Django Backend
echo ===========================================

if exist "%~dp0venv\Scripts\python.exe" (
    set "PY_CMD=%~dp0venv\Scripts\python.exe"
    echo [INFO] Using virtualenv Python
) else (
    set "PY_CMD=python"
    echo [INFO] Using system Python
)

"%PY_CMD%" manage.py migrate
"%PY_CMD%" manage.py runserver 127.0.0.1:8000
pause
