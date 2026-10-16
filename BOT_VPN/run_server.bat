@echo off
title QUANTUM FX - Node.js Express Server (Port 3008)
echo ======================================================================
echo INICIANDO QUANTUM FX: SERVIDOR NODE.JS + EXPRESS (PUERTO 3008)
echo ======================================================================
echo.

if not exist "node_modules\express" (
    echo [INFO] Instalando dependencias de Node.js...
    call npm install
)

echo [INFO] Servidor disponible en http://localhost:3008
node server.js

pause
