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
import hmac
import json
import logging
import os
import secrets
import sqlite3
import time
from urllib.parse import urlsplit
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Dict, Any, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from bot_engine import BotManager, Account, TradingBot, IdentityProfile
from persistence import PersistenceConflict
from strategies import STRATEGY_REGISTRY, get_strategy

logger = logging.getLogger("server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Instancia global del Gestor de Bots
bot_manager = BotManager(str(Path(__file__).resolve().parent / "config.json"))
SESSION_TTL_SECONDS = 30 * 60
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_ATTEMPTS = 5
auth_sessions: Dict[str, float] = {}
login_attempts: Dict[str, Dict[str, float]] = {}


# Gestor de conexiones WebSocket
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.session_tokens: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, session_token: str):
        self.active_connections.append(websocket)
        self.session_tokens[websocket] = session_token
        logger.info(f"Cliente WebSocket conectado. Clientes activos: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            self.session_tokens.pop(websocket, None)
            logger.info(f"Cliente WebSocket desconectado. Clientes activos: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]):
        disconnected = []
        for connection in self.active_connections:
            token = self.session_tokens.get(connection)
            if not has_valid_session_token(token):
                try:
                    await connection.close(code=1008, reason="Session expired")
                except (RuntimeError, WebSocketDisconnect):
                    logger.debug("El WebSocket ya estaba cerrado al expirar la sesión.")
                disconnected.append(connection)
                continue
            try:
                await connection.send_json(message)
            except (RuntimeError, WebSocketDisconnect):
                disconnected.append(connection)
        for dead in disconnected:
            self.disconnect(dead)


ws_manager = ConnectionManager()


# ======================================================================
# MODELOS PYDANTIC
# ======================================================================

class RequestPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginPayload(RequestPayload):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=1024)


class AddIdentityPayload(RequestPayload):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    full_name: str = Field(min_length=1, max_length=160)
    alias: Optional[str] = Field(default="", max_length=160)
    country: str = Field(default="US", min_length=2, max_length=2)
    city: Optional[str] = Field(default="", max_length=120)
    flag: Optional[str] = Field(default="🌐", max_length=8)
    kyc_status: Optional[str] = Field(default="PENDING", pattern="^(VERIFIED|PENDING|REJECTED)$")
    email: Optional[str] = Field(default="", max_length=254)
    notes: Optional[str] = Field(default="", max_length=1000)


class WebhookPayload(RequestPayload):
    token: Optional[str] = Field(default=None, max_length=256)
    bot_id: Optional[str] = Field(default=None, max_length=64)
    signal_id: Optional[str] = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    execution_mode: Literal["SIMULATED", "PAPER"] = "SIMULATED"
    ticker: str = Field(default="MNQ", max_length=16, pattern="^MNQ$", description="Micro E-mini Nasdaq-100")
    action: str = Field(description="BUY o SELL", pattern="^(BUY|SELL)$")
    price: float = Field(gt=0, allow_inf_nan=False, description="Precio actual o de entrada de MNQ")
    contracts: Optional[int] = Field(default=1, ge=1, le=100)
    sl: Optional[float] = Field(default=0.0, ge=0, allow_inf_nan=False)
    tp: Optional[float] = Field(default=0.0, ge=0, allow_inf_nan=False)
    strategy: Optional[str] = Field(default=None, max_length=64)
    comment: Optional[str] = Field(default="TradingView Alert", max_length=500)


class ScheduleUpdate(RequestPayload):
    start_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$", json_schema_extra={"example": "09:30"})
    end_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$", json_schema_extra={"example": "11:30"})
    timezone: Optional[str] = Field(default="America/New_York", min_length=1, max_length=64)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            try:
                ZoneInfo(value)
            except ZoneInfoNotFoundError as exc:
                raise ValueError("Zona horaria desconocida.") from exc
        return value


class CreateBotAccountPayload(RequestPayload):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    custom_name: str = Field(min_length=1, max_length=160)
    broker: str = Field(default="Tradovate", min_length=1, max_length=64)
    prop_firm: str = Field(default="Apex Trader Funding", min_length=1, max_length=120)
    balance: float = Field(default=50000.0, ge=0, allow_inf_nan=False)
    environment: str = Field(default="EVALUATION", pattern="^(EVALUATION|FUNDED_PA|DEMO)$")


class CreateBotPayload(RequestPayload):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=160)
    strategy: Literal["ICTStrategy", "SMTStrategy", "OrderFlowStrategy", "TechnicalAnalysisStrategy"]
    analysis_symbol: Literal["NQ", "ES"] = "NQ"
    analysis_timeframes: List[Literal["1m", "5m", "15m", "30m", "1h", "4h", "1d"]] = Field(
        default_factory=lambda: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"],
        min_length=1,
        max_length=7,
    )
    identity_id: Optional[str] = Field(default=None, max_length=64)
    proxy_url: Optional[str] = Field(default="", max_length=2048)
    jitter_ms: Optional[int] = Field(default=120, ge=0, le=5000)
    start_time: str = Field(default="09:30", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end_time: str = Field(default="12:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    accounts: List[CreateBotAccountPayload] = Field(default_factory=list, max_length=20)

    @field_validator("analysis_timeframes")
    @classmethod
    def validate_analysis_timeframes(cls, value: List[str]) -> List[str]:
        if len(set(value)) != len(value):
            raise ValueError("No se pueden repetir intervalos de análisis.")
        return value


class AddAccountPayload(RequestPayload):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    custom_name: str = Field(min_length=1, max_length=160)
    broker: str = Field(default="Tradovate", min_length=1, max_length=64)
    prop_firm: str = Field(default="Apex Trader Funding", min_length=1, max_length=120)
    balance: float = Field(default=50000.0, ge=0, allow_inf_nan=False)
    titular_name: Optional[str] = Field(default="", max_length=160)
    environment: Optional[str] = Field(default="EVALUATION", pattern="^(EVALUATION|FUNDED_PA|DEMO)$")
    max_contracts: Optional[int] = Field(default=2, ge=1, le=100)
    daily_loss_limit: Optional[float] = Field(default=1000.0, ge=0, allow_inf_nan=False)


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
    bot_manager.close_storage()
    logger.info("Sistema Central Multi-Bot detenido.")


app = FastAPI(
    title="Quantum FX - MNQ Multi-Bot Orchestrator",
    version="2.0.0",
    lifespan=lifespan
)


@app.exception_handler(PersistenceConflict)
async def persistence_conflict_handler(request: Request, exc: PersistenceConflict):
    return JSONResponse(status_code=409, content={"detail": "Los datos cambiaron en el otro servidor. Reintenta la operación."})


@app.exception_handler(sqlite3.Error)
async def persistence_error_handler(request: Request, exc: sqlite3.Error):
    logger.exception("Falló una operación de persistencia SQLite.")
    return JSONResponse(status_code=503, content={"detail": "No se pudo guardar o leer el estado persistido."})


def has_valid_session_token(token: Optional[str]) -> bool:
    if not isinstance(token, str) or len(token) > 256:
        return False
    expires_at = auth_sessions.get(token)
    if expires_at is None:
        return False
    if expires_at <= time.monotonic():
        auth_sessions.pop(token, None)
        return False
    return True


def revoke_session(token: Optional[str]) -> None:
    if not token:
        return
    auth_sessions.pop(token, None)
    for connection, active_token in list(ws_manager.session_tokens.items()):
        if active_token == token:
            try:
                asyncio.create_task(connection.close(code=1008, reason="Session revoked"))
            except RuntimeError:
                logger.warning("No se pudo cerrar el WebSocket de una sesión revocada.")


def allow_login_attempt(client_ip: str) -> bool:
    now = time.monotonic()
    for ip, attempt_data in list(login_attempts.items()):
        if attempt_data["window_started_at"] + LOGIN_WINDOW_SECONDS <= now:
            login_attempts.pop(ip, None)
    attempt = login_attempts.get(client_ip)
    if attempt is None or attempt["window_started_at"] + LOGIN_WINDOW_SECONDS <= now:
        login_attempts[client_ip] = {"count": 0, "window_started_at": now}
        attempt = login_attempts[client_ip]
    return attempt["count"] < LOGIN_MAX_ATTEMPTS


def register_failed_login(client_ip: str) -> None:
    login_attempts[client_ip]["count"] += 1


@app.middleware("http")
async def authenticate_api_requests(request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > 32 * 1024:
        return JSONResponse(status_code=413, content={"detail": "El cuerpo de la solicitud excede 32 KB."})
    if (
        request.url.path.startswith("/api/")
        and request.method != "OPTIONS"
        and request.url.path not in {"/api/auth/login", "/api/auth/me", "/api/webhook"}
    ):
        authorization = request.headers.get("authorization", "")
        scheme, separator, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not separator or not has_valid_session_token(token):
            return JSONResponse(status_code=401, content={"detail": "Autenticación requerida."})
    if (
        request.url.path.startswith("/api/")
        and request.url.path not in {"/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/webhook"}
    ):
        await bot_manager.refresh_if_changed()
    return await call_next(request)


# ======================================================================
# ENDPOINTS DE AUTENTICACIÓN
# ======================================================================

@app.post("/api/auth/login", summary="Inicio de Sesión")
async def login(payload: LoginPayload, request: Request):
    """Valida las credenciales de acceso institucional."""
    client_ip = request.client.host if request.client else "unknown"
    if not allow_login_attempt(client_ip):
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera 15 minutos.")

    expected_user = bot_manager.auth.get("username")
    expected_pass = bot_manager.auth.get("password")

    if not expected_user or not expected_pass:
        raise HTTPException(status_code=503, detail="Autenticación no configurada.")

    if (
        isinstance(expected_user, str)
        and isinstance(expected_pass, str)
        and hmac.compare_digest(payload.username.encode("utf-8"), expected_user.encode("utf-8"))
        and hmac.compare_digest(payload.password.encode("utf-8"), expected_pass.encode("utf-8"))
    ):
        login_attempts.pop(client_ip, None)
        for active_token, expires_at in list(auth_sessions.items()):
            if expires_at <= time.monotonic():
                auth_sessions.pop(active_token, None)
        session_token = secrets.token_urlsafe(32)
        auth_sessions[session_token] = time.monotonic() + SESSION_TTL_SECONDS
        return {
            "status": "SUCCESS",
            "token": session_token,
            "expires_in": SESSION_TTL_SECONDS,
            "user": {
                "username": expected_user,
                "role": bot_manager.auth.get("role", "ADMIN_TRADER")
            }
        }
    register_failed_login(client_ip)
    raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")


@app.get("/api/auth/me", summary="Datos del Usuario en Sesión")
async def get_current_user(authorization: Optional[str] = Header(None)):
    """Verifica si la sesión actual es válida."""
    scheme, separator, token = (authorization or "").partition(" ")

    if scheme.lower() == "bearer" and separator and has_valid_session_token(token):
        return {
            "authenticated": True,
            "username": bot_manager.auth.get("username", "admin"),
            "role": bot_manager.auth.get("role", "ADMIN_TRADER")
        }
    raise HTTPException(status_code=401, detail="Sesión inválida o vencida.")


@app.post("/api/auth/logout", status_code=204, summary="Cerrar sesión")
async def logout(authorization: Optional[str] = Header(None)):
    scheme, separator, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not separator or not has_valid_session_token(token):
        raise HTTPException(status_code=401, detail="Sesión inválida o vencida.")
    revoke_session(token)


# ======================================================================
# CONTROLES DE EMERGENCIA (FLATTEN ALL & STOP ALL)
# ======================================================================

@app.post("/api/emergency/flatten-all", summary="🔴 Quitar Todas las Órdenes (FLAT)")
async def emergency_flatten_all():
    """Cierra instantáneamente todas las posiciones abiertas en todas las cuentas."""
    res = bot_manager.flatten_all_positions()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {**res, "mode": "SIMULATED"}


@app.post("/api/emergency/stop-all", summary="⏹️ Kill-Switch Global (Apagar Bots)")
async def emergency_stop_all():
    """Pausa todos los bots activos simultáneamente."""
    count = bot_manager.stop_all_bots()
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "ALL_STOPPED", "mode": "SIMULATED", "bots_paused": count}


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
        kyc_status=payload.kyc_status or "PENDING",
        email=payload.email or "",
        notes=payload.notes
    )
    bot_manager.identities[payload.id] = new_ident
    bot_manager.save_config(event={
        "action": "identity_created",
        "entity_type": "identity",
        "entity_id": payload.id,
    })
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "CREATED", "identity": new_ident.to_dict()}


# ======================================================================
# VERIFICACIÓN DE RED Y PROXIES (SOCKS5 TEST)
# ======================================================================

@app.post("/api/bots/{bot_id}/proxy-test", summary="Probar Latencia e IP del Proxy")
async def test_bot_proxy(bot_id: str):
    res = await bot_manager.test_proxy(bot_id)
    if res.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail="Bot no encontrado.")
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return res


# ======================================================================
# WEBHOOKS & TRADING CONTROL
# ======================================================================

@app.post("/api/webhook", summary="Receptor de Señales de TradingView")
async def receive_webhook(payload: WebhookPayload, authorization: Optional[str] = Header(None)):
    scheme, separator, bearer_token = (authorization or "").partition(" ")
    provided_token = payload.token or (bearer_token if scheme.lower() == "bearer" and separator else None)
    if not bot_manager.webhook_token:
        raise HTTPException(status_code=503, detail="Token de webhook no configurado.")
    if not isinstance(provided_token, str) or not hmac.compare_digest(
        provided_token.encode("utf-8"),
        bot_manager.webhook_token.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="Token de webhook inválido.")
    if payload.execution_mode == "PAPER":
        raise HTTPException(
            status_code=501,
            detail="Paper trading no está disponible: falta integrar un sandbox oficial.",
        )

    signal_dict = payload.model_dump()
    signal_dict.pop("token", None)
    signal_dict.pop("execution_mode", None)
    logger.info(f"Señal recibida: {signal_dict['action']} MNQ @ {signal_dict['price']}")

    async with bot_manager.signal_lock:
        await bot_manager.refresh_if_changed()
        signal_id = signal_dict.get("signal_id")
        if signal_id and bot_manager.has_processed_signal(signal_id):
            return {"status": "DUPLICATE_IGNORED", "mode": "SIMULATED", "results": []}

        results = await bot_manager.dispatch_webhook(signal_dict)
        operations = [
            {
                "bot_id": result.get("bot_id"),
                "operation_type": "WEBHOOK_SIGNAL",
                "mode": "SIMULATED",
                "status": result.get("status", "UNKNOWN"),
                "idempotency_key": f"{signal_id}:{result.get('bot_id')}" if signal_id else None,
                "details": {
                    "signal_action": signal_dict["action"],
                    "signal_price": signal_dict["price"],
                    "result_status": result.get("status", "UNKNOWN"),
                    "reason": result.get("reason"),
                },
            }
            for result in results
        ]
        if signal_id and not operations:
            operations.append({
                "operation_type": "WEBHOOK_SIGNAL",
                "mode": "SIMULATED",
                "status": "NO_TARGET",
                "idempotency_key": f"{signal_id}:none",
                "details": {"signal_action": signal_dict["action"]},
            })
        bot_manager.save_config(
            event={
                "action": "webhook_signal_processed",
                "entity_type": "operation",
                "status": "SIMULATED",
                "details": {"result_count": len(results), "signal_action": signal_dict["action"]},
            },
            operations=operations,
        )
        await ws_manager.broadcast(bot_manager.get_system_snapshot())
        return {"status": "PROCESSED", "mode": "SIMULATED", "results": results}


@app.post("/api/bots", summary="Crear Nuevo Bot Vinculado a Titular")
async def create_bot(payload: CreateBotPayload):
    if payload.id in bot_manager.bots:
        raise HTTPException(status_code=400, detail=f"El bot '{payload.id}' ya existe.")

    if payload.proxy_url:
        try:
            parsed_proxy = urlsplit(payload.proxy_url)
            valid_proxy = (
                parsed_proxy.scheme in {"socks5", "socks5h"}
                and bool(parsed_proxy.hostname)
                and parsed_proxy.username is None
                and parsed_proxy.password is None
                and parsed_proxy.query == ""
                and parsed_proxy.fragment == ""
            )
        except ValueError:
            valid_proxy = False
        if not valid_proxy:
            raise HTTPException(status_code=400, detail="El proxy debe usar un esquema admitido y no incluir credenciales.")

    strat = get_strategy(payload.strategy)
    identity = bot_manager.identities.get(payload.identity_id)

    new_accounts = []
    for acc_data in payload.accounts:
        new_accounts.append(
            Account(
                id=acc_data.id,
                custom_name=acc_data.custom_name,
                broker=acc_data.broker,
                prop_firm=acc_data.prop_firm,
                balance=acc_data.balance,
                titular_name=identity.full_name if identity else "",
                environment=acc_data.environment,
                status="NOT_CONFIGURED"
            )
        )

    new_bot = TradingBot(
        bot_id=payload.id,
        name=payload.name,
        strategy=strat,
        identity=identity,
        proxy_url=payload.proxy_url,
        jitter_min_ms=payload.jitter_ms or 120,
        schedule={
            "start_time": payload.start_time,
            "end_time": payload.end_time,
            "timezone": "America/New_York"
        },
        analysis_symbol=payload.analysis_symbol,
        analysis_timeframes=payload.analysis_timeframes,
        accounts=new_accounts,
        status="ACTIVE"
    )

    bot_manager.bots[payload.id] = new_bot
    bot_manager.save_config(event={
        "action": "bot_created",
        "entity_type": "bot",
        "entity_id": payload.id,
    })
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "CREATED", "bot": new_bot.to_dict()}


@app.post("/api/bots/{bot_id}/toggle", summary="Activar o Pausar Bot")
async def toggle_bot(bot_id: str):
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    bot.status = "PAUSED" if bot.status == "ACTIVE" else "ACTIVE"
    bot.log_event("STATE", f"Estado cambiado a {bot.status}.")
    bot_manager.save_config(event={
        "action": "bot_status_changed",
        "entity_type": "bot",
        "entity_id": bot_id,
        "details": {"status": bot.status},
    })
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
    bot_manager.save_config(event={
        "action": "bot_schedule_updated",
        "entity_type": "bot",
        "entity_id": bot_id,
        "details": {"schedule": bot.schedule},
    })
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "UPDATED", "schedule": bot.schedule}


@app.post("/api/bots/{bot_id}/accounts", summary="Vincular Cuenta con Credenciales y Entorno")
async def add_account(bot_id: str, payload: AddAccountPayload):
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    titular = payload.titular_name or (bot.identity.full_name if bot.identity else "Titular Desconocido")
    new_acc = Account(
        id=payload.id,
        custom_name=payload.custom_name,
        broker=payload.broker,
        prop_firm=payload.prop_firm,
        balance=payload.balance,
        titular_name=titular,
        environment=payload.environment or "EVALUATION",
        max_contracts=payload.max_contracts or 2,
        daily_loss_limit=payload.daily_loss_limit or 1000.0,
        status="NOT_CONFIGURED"
    )
    bot.accounts.append(new_acc)
    bot.log_event("CONFIG", f"Cuenta añadida: {new_acc.custom_name} ({new_acc.prop_firm} // Titular: {titular})")
    bot_manager.save_config(event={
        "action": "account_added",
        "entity_type": "account",
        "entity_id": new_acc.id,
        "details": {"bot_id": bot_id},
    })
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "ADDED", "account": new_acc.to_dict()}


@app.post("/api/bots/{bot_id}/close", summary="Cerrar posiciones de un bot")
async def close_bot_positions(bot_id: str):
    bot = bot_manager.bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot no encontrado")

    realized = bot.close_all_positions(bot_manager.market_price)
    bot_manager.save_config(
        event={
            "action": "simulated_positions_closed",
            "entity_type": "bot",
            "entity_id": bot_id,
            "status": "SIMULATED",
            "details": {"realized_pnl": realized, "market_price": bot_manager.market_price},
        },
        operations=[{
            "bot_id": bot_id,
            "operation_type": "CLOSE_POSITIONS",
            "mode": "SIMULATED",
            "status": "SIMULATED",
            "details": {"realized_pnl": realized, "market_price": bot_manager.market_price},
        }],
    )
    await ws_manager.broadcast(bot_manager.get_system_snapshot())
    return {"status": "POSITIONS_CLOSED", "mode": "SIMULATED", "bot_id": bot_id, "pnl_realized": realized}


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
    await websocket.accept()
    try:
        auth_payload = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        if len(auth_payload) > 1024:
            await websocket.close(code=1008, reason="Authentication message too large")
            return
        auth_message = json.loads(auth_payload)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        await websocket.close(code=1008, reason="Authentication required")
        return

        await bot_manager.refresh_if_changed()
    except json.JSONDecodeError:
        await websocket.close(code=1008, reason="Invalid authentication message")
        return

    if (
        not isinstance(auth_message, dict)
        or auth_message.get("action") != "AUTH"
        or not has_valid_session_token(auth_message.get("token"))
    ):
        await websocket.close(code=1008, reason="Authentication required")
        return

    await ws_manager.connect(websocket, auth_message["token"])
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


@app.get("/healthz", include_in_schema=False)
async def health_check():
    try:
        bot_manager.check_persistence()
    except sqlite3.Error:
        logger.exception("Health check failed: SQLite is unavailable.")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "service": "fastapi-gateway",
                "mode": "SIMULATED",
                "components": {"persistence": "unavailable"},
            },
        )
    return {
        "status": "healthy",
        "service": "fastapi-gateway",
        "mode": "SIMULATED",
        "components": {
            "persistence": "healthy",
            "broker": "disabled",
            "market_data": "simulated",
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
