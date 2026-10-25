@echo off
title QUANTUM FX - Node.js Express Server (Port 3008)
cd /d "%~dp0"
echo ======================================================================
echo INICIANDO QUANTUM FX: SERVIDOR NODE.JS + EXPRESS (PUERTO 3008)
echo ======================================================================
echo.

if not exist "node_modules\express" (
    echo [INFO] Instalando dependencias de Node.js...
    call npm ci
    if errorlevel 1 (
        echo [ERROR] No se pudieron instalar las dependencias de Node.js.
        pause
        exit /b 1
    )
)

echo [INFO] Servidor local disponible en http://127.0.0.1:3008
call npm start

pause
