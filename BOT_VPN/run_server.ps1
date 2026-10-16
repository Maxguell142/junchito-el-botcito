# QUANTUM FX - Script de Arranque Node.js para Windows PowerShell
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  QUANTUM FX: SERVIDOR NODE.JS + EXPRESS (PUERTO 3008)" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan

if (-not (Test-Path "node_modules\express")) {
    Write-Host "[INFO] Instalando dependencias de Node.js..." -ForegroundColor Yellow
    cmd /c npm install
}

Write-Host "[OK] Iniciando Servidor en http://localhost:3008" -ForegroundColor Green
Write-Host "[OK] Presione Ctrl+C para detener el servidor" -ForegroundColor Gray
node server.js
