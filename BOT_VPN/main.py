"""
main.py - Servidor Central FastAPI y Gateway WebSocket para Trading de Futuros (MNQ)

Expone:
- `/api/auth/login` y `/api/auth/me`: Autenticación institucional y gestión de sesión.
- `/api/emergency/flatten-all`: Control de pánico para liquidar todas las órdenes a FLAT.
- `/api/emergency/stop-all`: Kill-Switch global para pausar todos los bots.
- `/api/identities`: Catálogo y alta de personas titulares (KYC).
- `/api/bots/{id}/proxy-test`: Test de ping e IP saliente para el proxy SOCKS5 del bot.
- `/api/webhook`: Endpoint HTTP POST receptor de alertas JSON de TradingView.
- `/ws`: WebSocket bidireccional de baja latencia para el Dashboard en tiempo real.
- Rutas REST completas para bots, horarios y cuentas de prop firms con credenciales.
- Servidor de archivos estáticos para la interfaz web (#0D0D0D Dark Theme).
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header, Depends, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from bot_engine import BotManager, Account, TradingBot, IdentityProfile
from strategies import STRATEGY_REGISTRY, get_strategy

logger = logging.getLogger("server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Instancia global del Gestor de Bots
bot_manager = BotManager("config.json")


# Gestor de conexiones WebSocket
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Cliente WebSocket conectado. Clientes activos: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Cliente WebSocket desconectado. Clientes activos: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for dead in disconnected:
            self.disconnect(dead)


ws_manager = ConnectionManager()


# ======================================================================
# MODELOS PYDANTIC
# ======================================================================

class LoginPayload(BaseModel):
    username: str
    password: str


class AddIdentityPayload(BaseModel):
    id: str
    full_name: str
    alias: Optional[str] = ""
    country: str = "US"
    city: Optional[str] = ""
    flag: Optional[str] = "🌐"
    kyc_status: Optional[str] = "VERIFIED"
    email: Optional[str] = ""
    notes: Optional[str] = ""


class WebhookPayload(BaseModel):
    token: Optional[str] = None
    bot_id: Optional[str] = None
    ticker: str = Field(default="MNQ", description="Micro E-mini Nasdaq-100")
    action: str = Field(..., description="BUY o SELL")
    price: float = Field(..., description="Precio actual o de entrada de MNQ")
    contracts: Optional[int] = Field(default=1, description="Contratos a ejecutar")
    sl: Optional[float] = Field(default=0.0, description="Stop Loss en precio")
    tp: Optional[float] = Field(default=0.0, description="Take Profit en precio")
    strategy: Optional[str] = Field(default=None, description="Estrategia objetivo (ej. ICT, SMT, OrderFlow)")
    comment: Optional[str] = Field(default="TradingView Alert")


class ScheduleUpdate(BaseModel):
    start_time: str = Field(..., example="09:30")
    end_time: str = Field(..., example="11:30")
    timezone: Optional[str] = "America/New_York"


class CreateBotPayload(BaseModel):
    id: str
    name: str
    strategy: str
    identity_id: Optional[str] = None
    proxy_url: Optional[str] = ""
    jitter_ms: Optional[int] = 120
    start_time: str = "09:30"
    end_time: str = "12:00"
    accounts: Optional[List[Dict[str, Any]]] = []


class AddAccountPayload(BaseModel):
    id: str
    custom_name: str
    broker: str = "Tradovate"
    prop_firm: str = "Apex Trader Funding"
    balance: float = 50000.0
    titular_name: Optional[str] = ""
    environment: Optional[str] = "EVALUATION"  # "EVALUATION", "FUNDED_PA", "DEMO"
    username: Optional[str] = ""
    password: Optional[str] = ""
    max_contracts: Optional[int] = 2
    daily_loss_limit: Optional[float] = 1000.0


# ======================================================================
# CICLO DE VIDA ASÍNCRONO
# ======================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    bot_manager.load_config()
    telemetry_task = asyncio.create_task(bot_manager.telemetry_loop(ws_manager.broadcast))
    logger.info("Sistema Central Multi-Bot iniciado correctamente.")
    yield
    telemetry_task.cancel()
    for bot in bot_manager.bots.values():
        await bot.proxy_connector.close()
    logger.info("Sistema Central Multi-Bot detenido.")


app = FastAPI(
    title="Quantum FX - MNQ Multi-Bot Orchestrator",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ======================================================================
# ENDPOINTS DE AUTENTICACIÓN
# ======================================================================

@app.post("/api/auth/login", summary="Inicio de Sesión")
async def login(payload: LoginPayload):
    """Valida las credenciales de acceso institucional."""
    expected_user = bot_manager.auth.get("username")
    expected_pass = bot_manager.auth.get("password")
    session_token = bot_manager.auth.get("session_token")

    if not expected_user or not expected_pass or not session_token:
        raise HTTPException(status_code=503, detail="Autenticación no configurada.")

    if payload.username == expected_user and payload.password == expected_pass:
        return {
            "status": "SUCCESS",
            "token": session_token,
            "user": {
                "username": expected_user,
                "role": bot_manager.auth.get("role", "ADMIN_TRADER")
            }
        }
    raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")


@app.get("/api/auth/me", summary="Datos del Usuario en Sesión")
async def get_current_user(authorization: Optional[str] = Header(None)):
    """Verifica si la sesión actual es válida."""
    expected_token = bot_manager.auth.get("session_token")
    token = authorization.replace("Bearer ", "") if authorization else None

    if token and expected_token and token == expected_token:
        return {
            "authenticated": True,
            "username": bot_manager.auth.get("username", "admin"),
            "role": bot_manager.auth.get("role", "ADMIN_TRADER")
        }
    return {"authenticated": False}


# ======================================================================
# CONTROLES DE EMERGENCIA (FLATTEN ALL & STOP ALL)
# ======================================================================

@app.post("/api/emergency/flatten-all", summary="🔴 Quitar Todas las Órdenes (FLAT)")
async def emergency_flatten_all():
    """Cierra instantáneamente todas las posiciones abiertas en todas las cuentas."""
    res = bot_manager.flatten_all_positions()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return res


@app.post("/api/emergency/stop-all", summary="⏹️ Kill-Switch Global (Apagar Bots)")
async def emergency_stop_all():
    """Pausa todos los bots activos simultáneamente."""
    count = bot_manager.stop_all_bots()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "ALL_STOPPED", "bots_paused": count}


# ======================================================================
# GESTIÓN DE IDENTIDADES (PERSONAS TITULARES / KYC)
# ======================================================================

@app.get("/api/identities", summary="Listar Identidades Titulares")
async def list_identities():
    return [i.to_dict() for i in bot_manager.identities.values()]


@app.post("/api/identities", summary="Registrar Nueva Identidad (Titular KYC)")
async def create_identity(payload: AddIdentityPayload):
    if payload.id in bot_manager.identities:
        raise HTTPException(status_code=400, detail="Esta identidad ya existe.")

    new_ident = IdentityProfile(
        id=payload.id,
        full_name=payload.full_name,
        alias=payload.alias or payload.full_name,
        country=payload.country,
        city=payload.city or "",
        flag=payload.flag or "🌐",
        kyc_status=payload.kyc_status or "VERIFIED",
        email=payload.email or "",
        notes=payload.notes
    )
    bot_manager.identities[payload.id] = new_ident
    bot_manager.save_config()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "CREATED", "identity": new_ident.to_dict()}


# ======================================================================
# VERIFICACIÓN DE RED Y PROXIES (SOCKS5 TEST)
# ======================================================================

@app.post("/api/bots/{bot_id}/proxy-test", summary="Probar Latencia e IP del Proxy")
async def test_bot_proxy(bot_id: str):
    res = await bot_manager.test_proxy(bot_id)
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return res


# ======================================================================
# WEBHOOKS & TRADING CONTROL
# ======================================================================

@app.post("/api/webhook", summary="Receptor de Señales de TradingView")
async def receive_webhook(payload: WebhookPayload, authorization: Optional[str] = Header(None)):
    provided_token = payload.token or (authorization.replace("Bearer ", "") if authorization else None)
    if not bot_manager.webhook_token:
        raise HTTPException(status_code=503, detail="Token de webhook no configurado.")
    if provided_token != bot_manager.webhook_token:
        raise HTTPException(status_code=401, detail="Token de webhook inválido.")

    signal_dict = payload.model_dump()
    logger.info(f"Señal recibida: {signal_dict['action']} MNQ @ {signal_dict['price']}")

    results = await bot_manager.dispatch_webhook(signal_dict)
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "PROCESSED", "results": results}


@app.post("/api/bots", summary="Crear Nuevo Bot Vinculado a Titular")
async def create_bot(payload: CreateBotPayload):
    if payload.id in bot_manager.bots:
        raise HTTPException(status_code=400, detail=f"El bot '{payload.id}' ya existe.")

    strat = get_strategy(payload.strategy)
    identity = bot_manager.identities.get(payload.identity_id)

    new_accounts = []
    for acc_data in payload.accounts:
        new_accounts.append(
            Account(
                id=acc_data.get("id", f"acc_{len(new_accounts)+1}"),
                custom_name=acc_data.get("custom_name", "Cuenta Prop"),
                broker=acc_data.get("broker", "Tradovate"),
                prop_firm=acc_data.get("prop_firm", "Apex Trader Funding"),
                balance=float(acc_data.get("balance", 50000.0)),
                titular_name=identity.full_name if identity else "",
                environment=acc_data.get("environment", "EVALUATION")
            )
        )

    new_bot = TradingBot(
        bot_id=payload.id,
        name=payload.name,
        strategy=strat,
        identity=identity,
        proxy_url=payload.proxy_url,
        jitter_ms=payload.jitter_ms or 120,
        schedule={
            "start_time": payload.start_time,
            "end_time": payload.end_time,
            "timezone": "America/New_York"
        },
        accounts=new_accounts,
        status="ACTIVE"
    )

    bot_manager.bots[payload.id] = new_bot
    bot_manager.save_config()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "CREATED", "bot": new_bot.to_dict()}


@app.post("/api/bots/{bot_id}/toggle", summary="Activar o Pausar Bot")
async def toggle_bot(bot_id: str):
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    bot.status = "PAUSED" if bot.status == "ACTIVE" else "ACTIVE"
    bot.log_event("STATE", f"Estado cambiado a {bot.status}.")
    bot_manager.save_config()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "SUCCESS", "bot_id": bot_id, "new_status": bot.status}


@app.put("/api/bots/{bot_id}/schedule", summary="Actualizar horario de trading")
async def update_schedule(bot_id: str, schedule: ScheduleUpdate):
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    bot.schedule["start_time"] = schedule.start_time
    bot.schedule["end_time"] = schedule.end_time
    if schedule.timezone:
        bot.schedule["timezone"] = schedule.timezone

    bot.log_event("CONFIG", f"Horario operativo: {schedule.start_time} - {schedule.end_time} EST.")
    bot_manager.save_config()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "UPDATED", "schedule": bot.schedule}


@app.post("/api/bots/{bot_id}/accounts", summary="Vincular Cuenta con Credenciales y Entorno")
async def add_account(bot_id: str, payload: AddAccountPayload):
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    titular = payload.titular_name or (bot.identity.full_name if bot.identity else "Titular Desconocido")
    pwd_masked = "••••••••" if payload.password else "••••••••"

    new_acc = Account(
        id=payload.id,
        custom_name=payload.custom_name,
        broker=payload.broker,
        prop_firm=payload.prop_firm,
        balance=payload.balance,
        titular_name=titular,
        environment=payload.environment or "EVALUATION",
        username=payload.username or "",
        password_masked=pwd_masked,
        max_contracts=payload.max_contracts or 2,
        daily_loss_limit=payload.daily_loss_limit or 1000.0
    )
    bot.accounts.append(new_acc)
    bot.log_event("CONFIG", f"Cuenta añadida: {new_acc.custom_name} ({new_acc.prop_firm} // Titular: {titular})")
    bot_manager.save_config()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "ADDED", "account": new_acc.to_dict()}


@app.post("/api/bots/{bot_id}/close", summary="Cerrar posiciones de un bot")
async def close_bot_positions(bot_id: str):
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    realized = bot.close_all_positions(bot_manager.market_price)
    bot_manager.save_config()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "POSITIONS_CLOSED", "bot_id": bot_id, "pnl_realized": realized}


@app.get("/api/strategies", summary="Lista de estrategias disponibles")
async def list_strategies():
    data = []
    for name, cls in STRATEGY_REGISTRY.items():
        temp = cls()
        data.append({
            "name": name,
            "description": temp.description,
            "parameters": temp.parameters
        })
    return data


# ======================================================================
# WEBSOCKET REAL-TIME STREAMING
# ======================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        await websocket.send_json(bot_manager.get_system_snapshot())
        while True:
            data = await websocket.receive_text()
            try:
                cmd = json.loads(data)
                if cmd.get("action") == "PING":
                    await websocket.send_json({"type": "PONG"})
            except Exception:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Error en WebSocket: {e}")
        ws_manager.disconnect(websocket)


# ======================================================================
# SERVIDORES DE ARCHIVOS ESTÁTICOS / DASHBOARD WEB
# ======================================================================

public_dir = os.path.join(os.path.dirname(__file__), "public")
if not os.path.exists(public_dir):
    os.makedirs(public_dir, exist_ok=True)

app.mount("/static", StaticFiles(directory=public_dir), name="static")


@app.get("/")
async def serve_index():
    index_path = os.path.join(public_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Dashboard en construcción. Por favor crea public/index.html"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
