"""
main.py - Servidor Central FastAPI y Gateway WebSocket para Trading de Futuros (MNQ)

Expone:
- `/api/webhook`: Endpoint HTTP POST receptor de alertas JSON de TradingView.
- `/ws`: WebSocket bidireccional de baja latencia para el Dashboard en tiempo real.
- Rutas REST para pausar/reanudar bots, editar horarios, agregar cuentas y bots.
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

from bot_engine import BotManager, Account, TradingBot
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


# Modelos Pydantic para validación de datos
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
    proxy_url: Optional[str] = ""
    start_time: str = "09:30"
    end_time: str = "12:00"
    accounts: Optional[List[Dict[str, Any]]] = []


class AddAccountPayload(BaseModel):
    id: str
    custom_name: str
    broker: str = "Tradovate"
    prop_firm: str = "Apex Trader Funding"
    balance: float = 50000.0


# Ciclo de vida asíncrono de FastAPI
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicio: Cargar configuración y arrancar telemetría
    bot_manager.load_config()
    telemetry_task = asyncio.create_task(bot_manager.telemetry_loop(ws_manager.broadcast))
    logger.info("Sistema Central Multi-Bot iniciado correctamente.")
    yield
    # Cierre: Cancelar tareas y cerrar sesiones de red
    telemetry_task.cancel()
    for bot in bot_manager.bots.values():
        await bot.proxy_connector.close()
    logger.info("Sistema Central Multi-Bot detenido.")


app = FastAPI(
    title="Quantum FX - MNQ Multi-Bot Orchestrator",
    version="1.0.0",
    lifespan=lifespan
)

# Middleware CORS para permitir interacciones seguras
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ======================================================================
# RUTAS DE LA API (WEBHOOKS & CONTROL)
# ======================================================================

@app.post("/api/webhook", summary="Receptor de Señales de TradingView")
async def receive_webhook(payload: WebhookPayload, authorization: Optional[str] = Header(None)):
    """
    Endpoint HTTP POST para recibir alertas JSON emitidas por TradingView.
    Valida autenticación por token, evalúa la estrategia y replica la orden en las cuentas asignadas.
    """
    provided_token = payload.token or (authorization.replace("Bearer ", "") if authorization else None)
    if bot_manager.webhook_token and provided_token != bot_manager.webhook_token:
        raise HTTPException(status_code=401, detail="Token de webhook inválido o no suministrado.")

    signal_dict = payload.model_dump()
    logger.info(f"Señal recibida en /api/webhook: {signal_dict['action']} {signal_dict['ticker']} @ {signal_dict['price']}")

    results = await bot_manager.dispatch_webhook(signal_dict)
    
    # Notificación inmediata al WebSocket
    snapshot = bot_manager.get_system_snapshot()
    await ws_manager.broadcast(snapshot)

    return {
        "status": "PROCESSED",
        "ticker": payload.ticker,
        "results": results
    }


@app.get("/api/bots", summary="Obtener estado de todos los bots")
async def get_all_bots():
    """Retorna la lista de bots con sus métricas, proxies y cuentas."""
    return bot_manager.get_system_snapshot()


@app.post("/api/bots", summary="Crear nuevo Bot de Trading dinámicamente")
async def create_bot(payload: CreateBotPayload):
    """Permite al usuario dar de alta un nuevo bot en caliente."""
    if payload.id in bot_manager.bots:
        raise HTTPException(status_code=400, detail=f"El bot con ID '{payload.id}' ya existe.")

    strat = get_strategy(payload.strategy)
    new_accounts = []
    for acc_data in payload.accounts:
        new_accounts.append(
            Account(
                id=acc_data.get("id", f"acc_{len(new_accounts)+1}"),
                custom_name=acc_data.get("custom_name", "Cuenta Prop"),
                broker=acc_data.get("broker", "Tradovate"),
                prop_firm=acc_data.get("prop_firm", "Apex Trader Funding"),
                balance=float(acc_data.get("balance", 50000.0))
            )
        )

    new_bot = TradingBot(
        bot_id=payload.id,
        name=payload.name,
        strategy=strat,
        proxy_url=payload.proxy_url,
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
    logger.info(f"Nuevo bot creado: {payload.name} ({payload.id})")

    # Transmitir actualización
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "CREATED", "bot": new_bot.to_dict()}


@app.post("/api/bots/{bot_id}/toggle", summary="Activar o Pausar Bot")
async def toggle_bot(bot_id: str):
    """Alterna el estado del bot entre ACTIVE y PAUSED."""
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    bot.status = "PAUSED" if bot.status == "ACTIVE" else "ACTIVE"
    bot.log_event("STATE", f"Estado cambiado a {bot.status} por el usuario.")
    bot_manager.save_config()

    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "SUCCESS", "bot_id": bot_id, "new_status": bot.status}


@app.put("/api/bots/{bot_id}/schedule", summary="Actualizar horario de trading")
async def update_schedule(bot_id: str, schedule: ScheduleUpdate):
    """Modifica la ventana operativa del bot en hora EST."""
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    bot.schedule["start_time"] = schedule.start_time
    bot.schedule["end_time"] = schedule.end_time
    if schedule.timezone:
        bot.schedule["timezone"] = schedule.timezone

    bot.log_event("CONFIG", f"Horario operativo actualizado a {schedule.start_time} - {schedule.end_time} EST.")
    bot_manager.save_config()

    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "UPDATED", "schedule": bot.schedule}


@app.post("/api/bots/{bot_id}/accounts", summary="Vincular cuenta a un bot")
async def add_account(bot_id: str, payload: AddAccountPayload):
    """Agrega una cuenta con nombre personalizado a la lista de un bot."""
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    new_acc = Account(
        id=payload.id,
        custom_name=payload.custom_name,
        broker=payload.broker,
        prop_firm=payload.prop_firm,
        balance=payload.balance
    )
    bot.accounts.append(new_acc)
    bot.log_event("CONFIG", f"Cuenta añadida: {new_acc.custom_name} ({new_acc.broker} / {new_acc.prop_firm})")
    bot_manager.save_config()

    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "ADDED", "account": new_acc.to_dict()}


@app.post("/api/bots/{bot_id}/close", summary="Cerrar posiciones abiertas de un bot")
async def close_bot_positions(bot_id: str):
    """Cierra de inmediato todas las posiciones activas en las cuentas del bot."""
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    realized = bot.close_all_positions(bot_manager.market_price)
    bot_manager.save_config()

    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "POSITIONS_CLOSED", "bot_id": bot_id, "pnl_realized": realized}


@app.get("/api/strategies", summary="Lista de estrategias disponibles")
async def list_strategies():
    """Retorna las estrategias que se pueden inyectar en los bots."""
    data = []
    for name, cls in STRATEGY_REGISTRY.items():
        temp = cls()
        data.append({
            "name": name,
            "description": temp.description,
            "parameters": temp.parameters
        })
    return data


@app.post("/api/test-signal", summary="Disparar señal de prueba para MNQ")
async def test_signal(
    action: str = Body(default="BUY", embed=True),
    bot_id: Optional[str] = Body(default=None, embed=True)
):
    """Genera una señal de prueba instantánea para validar la replicación en el dashboard."""
    signal = {
        "bot_id": bot_id,
        "token": bot_manager.webhook_token,
        "ticker": "MNQ",
        "action": action.upper(),
        "price": bot_manager.market_price,
        "contracts": 1,
        "sl": bot_manager.market_price - 12.0 if action.upper() == "BUY" else bot_manager.market_price + 12.0,
        "tp": bot_manager.market_price + 25.0 if action.upper() == "BUY" else bot_manager.market_price - 25.0,
        "fvg_valid": True,
        "smt_divergence": True,
        "delta": 220
    }
    results = await bot_manager.dispatch_webhook(signal)
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"test_signal": signal, "results": results}


# ======================================================================
# WEBSOCKET REAL-TIME STREAMING
# ======================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Transmite estado en tiempo real (PnL, latencias, cuentas, logs) a los clientes."""
    await ws_manager.connect(websocket)
    try:
        # Enviar estado inicial inmediato al conectar
        await websocket.send_json(bot_manager.get_system_snapshot())
        while True:
            # Escucha comandos que puedan venir desde el cliente UI
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
