# QUANTUM FX - Script de Arranque Node.js para Windows PowerShell
$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  QUANTUM FX: SERVIDOR NODE.JS + EXPRESS (PUERTO 3008)" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan

Push-Location $projectRoot
try {
  if (-not (Test-Path "node_modules\express")) {
    Write-Host "[INFO] Instalando dependencias de Node.js..." -ForegroundColor Yellow
    npm ci
    if ($LASTEXITCODE -ne 0) {
      throw "No se pudieron instalar las dependencias de Node.js."
    }
  }

  Write-Host "[OK] Iniciando servidor local en http://127.0.0.1:3008" -ForegroundColor Green
  Write-Host "[OK] Presione Ctrl+C para detener el servidor" -ForegroundColor Gray
  npm start
  if ($LASTEXITCODE -ne 0) {
    throw "El servidor Node.js terminó con error."
  }
}
finally {
  Pop-Location
}
