$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$pythonPath = Join-Path $projectRoot ".venv\Scripts\python.exe"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  QUANTUM FX: SERVIDOR FASTAPI (PUERTO 8000)" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan

Push-Location $projectRoot
try {
  if (-not (Test-Path $pythonPath)) {
    Write-Host "[INFO] Creando entorno virtual de Python..." -ForegroundColor Yellow
    py -3 -m venv .venv
    if ($LASTEXITCODE -ne 0) {
      throw "No se pudo crear .venv. Instala Python 3.10 o posterior y vuelve a intentarlo."
    }
  }

  & $pythonPath -c "import aiohttp, aiohttp_socks, fastapi, pydantic, uvicorn" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[INFO] Instalando dependencias Python desde requirements.txt..." -ForegroundColor Yellow
    & $pythonPath -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
      throw "No se pudieron instalar las dependencias Python."
    }
  }

  Write-Host "[OK] Iniciando FastAPI en http://127.0.0.1:8000" -ForegroundColor Green
  Write-Host "[OK] Presione Ctrl+C para detener el servidor" -ForegroundColor Gray
  & $pythonPath -m uvicorn fastapi_service.main:app --host 127.0.0.1 --port 8000
  if ($LASTEXITCODE -ne 0) {
    throw "El servidor FastAPI terminó con error."
  }
}
finally {
  Pop-Location
}
