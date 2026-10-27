@echo off
title QUANTUM FX - FastAPI Server (Port 8000)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_fastapi.ps1"
if errorlevel 1 (
    echo [ERROR] No se pudo iniciar el servidor FastAPI.
    pause
    exit /b 1
)
