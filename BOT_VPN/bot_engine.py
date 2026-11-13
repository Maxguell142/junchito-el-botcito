"""
bot_engine.py - Motor Asíncrono de Trading Multi-Bot de Futuros (MNQ)

Responsable de:
1. Arquitectura Multi-Identidad: Cada bot representa a una persona titular (KYC).
2. Simulación local de señales y posiciones, sin enviar órdenes a un broker.
3. Límites de riesgo de demostración con rechazos registrados.
4. Controles de emergencia simulados y delimitación de horarios.
"""

import asyncio
import json
import logging
import math
import os
import random
import sqlite3
import time
from collections import deque
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Any, Tuple
from urllib.parse import urlsplit
import zoneinfo

import aiohttp

# Importación condicional de aiohttp_socks para proxies SOCKS5
try:
    from aiohttp_socks import ProxyConnector as SocksProxyConnector
    SOCKS_AVAILABLE = True
except ImportError:
    SOCKS_AVAILABLE = False

from strategies import BaseStrategy, SignalDecision, get_strategy, MNQ_TICK_SIZE, MNQ_TICK_VALUE, MNQ_POINT_VALUE
from persistence import PersistenceConflict, SQLiteStore

logger = logging.getLogger("bot_engine")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

SIMULATION_RISK_DEFAULTS = {
    "max_contracts_per_account": 1,
    "max_total_contracts": 2,
    "max_orders_per_day": 3,
    "daily_loss_per_account": 50.0,
    "daily_loss_global": 100.0,
    "max_exposure": 100000.0,
}


def _risk_limit_from_environment(name: str, default: float, integer: bool = False) -> float | int:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return int(default) if integer else default
    try:
        value = int(raw_value) if integer else float(raw_value)
    except ValueError as exc:
        raise ValueError(f"{name} debe ser un límite numérico positivo.") from exc
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} debe ser un límite numérico positivo.")
    return value


@dataclass
class IdentityProfile:
    """Modela la identidad legal (KYC) de la persona física asignada a un bot."""
    id: str
    full_name: str                   # Ej: "Carlos Mendoza"
    alias: str                       # Ej: "Carlos M. (Miami / NY)"
    country: str                     # Ej: "US"
    city: str                        # Ej: "New York, NY"
    flag: str = "🇺🇸"                 # Emoji bandera
    kyc_status: str = "VERIFIED"     # "VERIFIED", "PENDING", "REJECTED"
    email: str = ""
    notes: Optional[str] = None
    encrypted_envelope: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        envelope = result.pop("encrypted_envelope", None)
        if envelope:
            result["__pii_encrypted_v1"] = envelope
        return result


class ProxyConnector:
    """
    Gestiona la sesión HTTP/WebSocket aislada por bot.
    Enruta las peticiones a través de un proxy SOCKS5 Residencial Dedicado (ISP de EE.UU.)
    a nivel de Socket, manteniendo la IP global de Windows inalterada.
    """

    def __init__(self, proxy_url: Optional[str] = None, outbound_ip: Optional[str] = None, isp_provider: Optional[str] = None):
        self.proxy_url = proxy_url.strip() if proxy_url else None
        self._session: Optional[aiohttp.ClientSession] = None
        self.detected_ip: str = outbound_ip or ""
        self.isp_provider: str = isp_provider or "No verificado"
        self.detected_country: str = "US"
        self.ping_ms: float = 0.0
        self.is_healthy: bool = False
        self.last_check: float = 0.0

    async def get_session(self) -> aiohttp.ClientSession:
        """Crea o reutiliza la sesión asíncrona dedicada con el conector SOCKS5."""
        if self._session is None or self._session.closed:
            connector = None
            if self.proxy_url:
                if not self.proxy_url.lower().startswith(("socks5://", "socks5h://")):
                    raise RuntimeError("El esquema del proxy configurado no es compatible; se bloquea la conexión directa.")
                if SOCKS_AVAILABLE:
                    try:
                        connector = SocksProxyConnector.from_url(self.proxy_url)
                    except Exception:
                        logger.error("No se pudo crear el conector SOCKS5; se bloquea la conexión directa.")
                        raise RuntimeError("No se pudo crear el conector SOCKS5 configurado.") from None
                else:
                    raise RuntimeError("aiohttp-socks no está instalado; se bloquea la conexión directa.")
            else:
                connector = aiohttp.TCPConnector()

            timeout = aiohttp.ClientTimeout(total=5, connect=3)
            self._session = aiohttp.ClientSession(connector=connector, timeout=timeout)
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def check_ping_and_ip(self) -> Tuple[float, str]:
        """Verifica la conectividad, mide el ping en ms y registra la IP pública residencial de salida."""
        if not self.proxy_url:
            self.is_healthy = False
            self.ping_ms = 0.0
            self.last_check = time.time()
            return self.ping_ms, self.detected_ip

        start_time = time.perf_counter()
        try:
            session = await self.get_session()
            async with session.get("https://api.ipify.org?format=json", timeout=4) as resp:
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                if resp.status == 200:
                    data = await resp.json()
                    self.detected_ip = data.get("ip", self.detected_ip)
                    self.ping_ms = round(elapsed_ms, 1)
                    self.is_healthy = True
                else:
                    self.ping_ms = round(elapsed_ms, 1)
                    self.is_healthy = False
        except (aiohttp.ClientError, asyncio.TimeoutError, RuntimeError):
            logger.warning("Falló la verificación real del proxy configurado.")
            self.ping_ms = 0.0
            self.is_healthy = False

        self.last_check = time.time()
        return self.ping_ms, self.detected_ip


@dataclass
class Account:
    """Modela una cuenta vinculada a un Broker / Prop Firm de un titular específico."""
    id: str
    custom_name: str                 # Ej. "Apex 50k #1", "Topstep 50k Scalp"
    broker: str                      # "Tradovate", "Rithmic", "ProjectX"
    prop_firm: str                   # "Apex Trader Funding", "Topstep", "Leelo Trading", "Blue Guardian"
    balance: float = 50000.0
    floating_pnl: float = 0.0
    realized_pnl: float = 0.0
    active_contracts: int = 0
    current_position: str = "FLAT"   # "FLAT", "LONG", "SHORT"
    entry_price: float = 0.0
    status: str = "NOT_CONFIGURED"
    last_order_time: Optional[str] = None
    titular_name: str = ""           # Nombre de la persona titular
    environment: str = "FUNDED_PA"   # "FUNDED_PA", "EVALUATION", "DEMO"
    username: str = ""               # Login ID en la prop firm
    password_masked: str = "••••••••"
    max_contracts: int = 2
    daily_loss_limit: float = 1000.0
    daily_pnl: float = 0.0
    orders_today: int = 0
    daily_metrics_date: str = field(default_factory=lambda: datetime.now(timezone.utc).date().isoformat())

    def reset_daily_metrics_if_needed(self) -> None:
        today = datetime.now(timezone.utc).date().isoformat()
        if self.daily_metrics_date != today:
            self.daily_pnl = 0.0
            self.orders_today = 0
            self.daily_metrics_date = today

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["username"] = "••••" if self.username else ""
        return data


class BrokerAdapter:
    """Actualiza posiciones simuladas sin abrir conexiones ni enviar órdenes."""

    @staticmethod
    async def execute_order(
        account: Account,
        decision: SignalDecision
    ) -> Dict[str, Any]:
        """Actualiza el estado local y devuelve una ejecución claramente simulada."""
        account.reset_daily_metrics_if_needed()
        now = datetime.now(timezone.utc)
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")

        # Actualización de posición en la cuenta
        if decision.action == "BUY":
            account.current_position = "LONG"
            account.active_contracts = decision.contracts
            account.entry_price = decision.entry_price
        elif decision.action == "SELL":
            account.current_position = "SHORT"
            account.active_contracts = decision.contracts
            account.entry_price = decision.entry_price

        account.last_order_time = now_str
        account.orders_today += 1

        return {
            "account_id": account.id,
            "custom_name": account.custom_name,
            "titular_name": account.titular_name,
            "broker": account.broker,
            "prop_firm": account.prop_firm,
            "mode": "SIMULATED",
            "status": "SIMULATED",
            "contracts": decision.contracts,
            "price": decision.entry_price,
            "action": decision.action,
            "latency_ms": 0.0,
            "timestamp": now_str
        }

    @staticmethod
    def close_position(account: Account, current_market_price: float) -> float:
        """Cierra la posición abierta y calcula el PnL realizado."""
        account.reset_daily_metrics_if_needed()
        if account.active_contracts == 0 or account.current_position == "FLAT":
            return 0.0

        points_diff = 0.0
        if account.current_position == "LONG":
            points_diff = current_market_price - account.entry_price
        elif account.current_position == "SHORT":
            points_diff = account.entry_price - current_market_price

        trade_pnl = round(points_diff * MNQ_POINT_VALUE * account.active_contracts, 2)
        account.realized_pnl += trade_pnl
        account.daily_pnl += trade_pnl
        account.balance += trade_pnl
        account.floating_pnl = 0.0
        account.active_contracts = 0
        account.current_position = "FLAT"
        account.entry_price = 0.0
        return trade_pnl


class TradingBot:
    """
    Unidad independiente de trading vinculada a un Titular (Persona KYC):
    - Encapsula la identidad legal de la persona.
    - Encapsula su propio Proxy SOCKS5 Residencial de ISP en EE.UU.
    - Administra las cuentas compradas bajo dicha identidad.
    - Monitoriza la Regla de Consistencia y chequeo Anti-Flagging Geográfico.
    """

    def __init__(
        self,
        bot_id: str,
        name: str,
        strategy: BaseStrategy,
        identity: Optional[IdentityProfile] = None,
        proxy_url: Optional[str] = None,
        outbound_ip: Optional[str] = None,
        proxy_port: Optional[int] = None,
        isp_provider: Optional[str] = None,
        node_location: Optional[str] = None,
        geo_match_status: Optional[str] = None,
        schedule: Optional[Dict[str, str]] = None,
        accounts: Optional[List[Account]] = None,
        status: str = "ACTIVE",
        jitter_min_ms: int = 50,
        jitter_max_ms: int = 350,
        analysis_symbol: str = "NQ",
        analysis_timeframes: Optional[List[str]] = None
    ):
        self.bot_id = bot_id
        self.name = name
        self.strategy = strategy
        self.identity = identity
        self.proxy_connector = ProxyConnector(proxy_url, outbound_ip, isp_provider)
        self.proxy_port = proxy_port or 10808
        self.isp_provider = "No verificado"
        self.node_location = "No verificado"
        self.geo_match_status = "No verificado"
        self.schedule = schedule or {
            "start_time": "09:30",
            "end_time": "11:30",
            "timezone": "America/New_York"
        }
        self.accounts: List[Account] = accounts or []
        self.status = status  # "ACTIVE", "PAUSED", "ERROR"
        self.jitter_min_ms = jitter_min_ms
        self.jitter_max_ms = jitter_max_ms
        self.analysis_symbol = (
            analysis_symbol if isinstance(analysis_symbol, str) and analysis_symbol in {"NQ", "ES"} else "NQ"
        )
        requested_timeframes = analysis_timeframes or ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]
        allowed_timeframes = {"1m", "5m", "15m", "30m", "1h", "4h", "1d"}
        self.analysis_timeframes = (
            list(requested_timeframes)
            if isinstance(requested_timeframes, list)
            and requested_timeframes
            and len(requested_timeframes) <= len(allowed_timeframes)
            and all(isinstance(timeframe, str) for timeframe in requested_timeframes)
            and len(set(requested_timeframes)) == len(requested_timeframes)
            and set(requested_timeframes).issubset(allowed_timeframes)
            else ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]
        )

        # Métricas de rendimiento
        self.net_pnl: float = 0.0
        self.total_trades: int = 0
        self.winning_trades: int = 0
        self.losing_trades: int = 0
        self.max_drawdown: float = 0.0
        self.peak_pnl: float = 0.0
        self.today_pnl: float = 0.0

        # Historial de logs en memoria
        self.logs: deque = deque(maxlen=150)
        titular_desc = self.identity.full_name if self.identity else "Sin Asignar"
        self.log_event("INFO", f"Bot {self.name} inicializado // Titular: {titular_desc} // ISP: {self.isp_provider}")

    def log_event(self, level: str, message: str, meta: Optional[Dict[str, Any]] = None):
        entry = {
            "timestamp": datetime.now().strftime("%H:%M:%S.%f")[:-3],
            "level": level.upper(),
            "message": message,
            "meta": meta or {}
        }
        self.logs.append(entry)

    def is_geo_consistent(self) -> Tuple[bool, str]:
        return False, "No verificado"

    def is_within_schedule(self) -> Tuple[bool, str]:
        tz_name = self.schedule.get("timezone", "America/New_York")
        try:
            tz = zoneinfo.ZoneInfo(tz_name)
            now_ny = datetime.now(tz)
        except Exception:
            now_ny = datetime.now(timezone.utc)

        current_time_str = now_ny.strftime("%H:%M")
        start_str = self.schedule.get("start_time", "09:30")
        end_str = self.schedule.get("end_time", "16:00")

        if start_str <= current_time_str <= end_str:
            return True, f"Horario activo ({current_time_str} {tz_name} en [{start_str} - {end_str}])"
        else:
            return False, f"Fuera de horario ({current_time_str} {tz_name} fuera de [{start_str} - {end_str}])"

    def get_consistency_pct(self) -> float:
        """Calcula el porcentaje de ganancia del mejor día sobre el total (Regla 30%/40%)."""
        if self.net_pnl <= 0 or self.today_pnl <= 0:
            return 0.0
        return round((self.today_pnl / self.net_pnl) * 100, 1)

    async def process_signal(
        self,
        signal_data: Dict[str, Any],
        risk_check: Optional[Callable[["TradingBot", SignalDecision], Optional[str]]] = None,
    ) -> Dict[str, Any]:
        self.log_event("SIGNAL", f"Señal entrante: {signal_data.get('action')} @ {signal_data.get('price')}")

        if self.status != "ACTIVE":
            msg = f"Señal ignorada: Bot {self.status}."
            self.log_event("WARNING", msg)
            return {"status": "IGNORED", "reason": msg, "bot_id": self.bot_id, "mode": "SIMULATED"}

        in_window, window_reason = self.is_within_schedule()
        if not in_window:
            msg = f"Señal omitida: {window_reason}"
            self.log_event("FILTER", msg)
            return {"status": "IGNORED", "reason": msg, "bot_id": self.bot_id, "mode": "SIMULATED"}

        decision = self.strategy.evaluate_signal(signal_data)
        if not decision.approved:
            self.log_event("REJECTED", f"Estrategia rechazó: {decision.reason}")
            return {
                "status": "REJECTED",
                "reason": decision.reason,
                "bot_id": self.bot_id,
                "mode": "SIMULATED",
            }

        if risk_check:
            risk_reason = risk_check(self, decision)
            if risk_reason:
                self.log_event("RISK_REJECTED", risk_reason)
                return {
                    "status": "RISK_REJECTED",
                    "reason": risk_reason,
                    "bot_id": self.bot_id,
                    "mode": "SIMULATED",
                }

        self.log_event("APPROVED", f"Aprobada por {self.strategy.name}: {decision.reason}")

        tasks = [
            BrokerAdapter.execute_order(acc, decision)
            for acc in self.accounts
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        successful_replications = []
        for res in results:
            if isinstance(res, Exception):
                self.log_event("ERROR", f"Fallo al replicar en cuenta: {res}")
            else:
                successful_replications.append(res)

        if successful_replications:
            self.total_trades += 1
        return {
            "status": "SIMULATED" if successful_replications else "FAILED",
            "mode": "SIMULATED",
            "bot_id": self.bot_id,
            "titular": self.identity.full_name if self.identity else "Desconocido",
            "decision": asdict(decision),
            "replications": successful_replications
        }

    def simulate_price_movement(self, current_market_price: float):
        total_float = 0.0
        for acc in self.accounts:
            if acc.active_contracts > 0 and acc.current_position != "FLAT":
                diff = 0.0
                if acc.current_position == "LONG":
                    diff = current_market_price - acc.entry_price
                elif acc.current_position == "SHORT":
                    diff = acc.entry_price - current_market_price

                pnl = round(diff * MNQ_POINT_VALUE * acc.active_contracts, 2)
                acc.floating_pnl = pnl
                total_float += pnl
            else:
                acc.floating_pnl = 0.0

    def close_all_positions(self, market_price: float) -> float:
        session_pnl_delta = 0.0
        for acc in self.accounts:
            realized = BrokerAdapter.close_position(acc, market_price)
            session_pnl_delta += realized

        self.net_pnl += session_pnl_delta
        self.today_pnl += session_pnl_delta
        if session_pnl_delta > 0:
            self.winning_trades += 1
        elif session_pnl_delta < 0:
            self.losing_trades += 1

        if self.net_pnl > self.peak_pnl:
            self.peak_pnl = self.net_pnl
        drawdown = self.peak_pnl - self.net_pnl
        if drawdown > self.max_drawdown:
            self.max_drawdown = round(drawdown, 2)

        self.log_event("CLOSE", f"Posiciones cerradas @ {market_price}. PnL realizado: ${session_pnl_delta:.2f}")
        return session_pnl_delta

    def get_win_rate(self) -> float:
        closed = self.winning_trades + self.losing_trades
        if closed == 0:
            return 0.0
        return round((self.winning_trades / closed) * 100, 1)

    def to_dict(self) -> Dict[str, Any]:
        total_balance = sum(a.balance for a in self.accounts)
        total_floating_pnl = sum(a.floating_pnl for a in self.accounts)
        total_active_contracts = sum(a.active_contracts for a in self.accounts)
        geo_ok, geo_desc = self.is_geo_consistent()

        return {
            "id": self.bot_id,
            "name": self.name,
            "status": self.status,
            "strategy": self.strategy.name,
            "strategy_description": self.strategy.description,
            "analysis_symbol": self.analysis_symbol,
            "analysis_timeframes": self.analysis_timeframes,
            "identity": self.identity.to_dict() if self.identity else None,
            "proxy_url": self.public_proxy_url(),
            "outbound_ip": self.proxy_connector.detected_ip,
            "proxy_port": self.proxy_port,
            "isp_provider": self.isp_provider,
            "node_location": self.node_location,
            "geo_match_status": self.geo_match_status,
            "proxy_ip": self.proxy_connector.detected_ip,
            "proxy_ping_ms": self.proxy_connector.ping_ms,
            "proxy_healthy": self.proxy_connector.is_healthy,
            "geo_consistent": geo_ok,
            "geo_description": geo_desc,
            "jitter_min_ms": self.jitter_min_ms,
            "jitter_max_ms": self.jitter_max_ms,
            "schedule": self.schedule,
            "net_pnl": round(self.net_pnl + total_floating_pnl, 2),
            "realized_pnl": round(self.net_pnl, 2),
            "floating_pnl": round(total_floating_pnl, 2),
            "today_pnl": round(self.today_pnl, 2),
            "consistency_pct": self.get_consistency_pct(),
            "total_trades": self.total_trades,
            "winning_trades": self.winning_trades,
            "losing_trades": self.losing_trades,
            "win_rate": self.get_win_rate(),
            "max_drawdown": self.max_drawdown,
            "accounts_count": len(self.accounts),
            "total_active_contracts": total_active_contracts,
            "total_balance": round(total_balance, 2),
            "accounts": [a.to_dict() for a in self.accounts],
            "logs": list(self.logs)
        }

    def public_proxy_url(self) -> str:
        if not self.proxy_connector.proxy_url:
            return ""
        try:
            parsed = urlsplit(self.proxy_connector.proxy_url)
            if not parsed.hostname:
                return "[configured]"
            host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
            port = f":{parsed.port}" if parsed.port else ""
            return f"{parsed.scheme}://{host}{port}"
        except ValueError:
            return "[configured]"


class BotManager:
    """
    Orquestador Central de Bots & Identidades:
    - Mantiene el catálogo de identidades de personas (KYC).
    - Ejecuta acciones de emergencia institucional (Flatten All, Stop All).
    - Monitorea periódicamente las conexiones y proxies residenciales de ISP.
    """

    def __init__(self, config_path: str = "config.json", database_path: Optional[str] = None):
        self.config_path = config_path
        default_database = Path(__file__).resolve().parent / "bot_vpn.sqlite3"
        self.database_path = database_path or os.environ.get("BOT_VPN_DB_PATH", str(default_database))
        self._store: Optional[SQLiteStore] = None
        self._revision = 0
        self.bots: Dict[str, TradingBot] = {}
        self.identities: Dict[str, IdentityProfile] = {}
        self.auth: Dict[str, Any] = {}
        self.webhook_token: str = ""
        self.market_price: float = 18245.50
        self.simulation_risk_limits = {
            "max_contracts_per_account": _risk_limit_from_environment(
                "BOT_VPN_SIM_MAX_CONTRACTS_PER_ACCOUNT",
                SIMULATION_RISK_DEFAULTS["max_contracts_per_account"],
                integer=True,
            ),
            "max_total_contracts": _risk_limit_from_environment(
                "BOT_VPN_SIM_MAX_TOTAL_CONTRACTS",
                SIMULATION_RISK_DEFAULTS["max_total_contracts"],
                integer=True,
            ),
            "max_orders_per_day": _risk_limit_from_environment(
                "BOT_VPN_SIM_MAX_ORDERS_PER_DAY",
                SIMULATION_RISK_DEFAULTS["max_orders_per_day"],
                integer=True,
            ),
            "daily_loss_per_account": _risk_limit_from_environment(
                "BOT_VPN_SIM_DAILY_LOSS_PER_ACCOUNT",
                SIMULATION_RISK_DEFAULTS["daily_loss_per_account"],
            ),
            "daily_loss_global": _risk_limit_from_environment(
                "BOT_VPN_SIM_DAILY_LOSS_GLOBAL",
                SIMULATION_RISK_DEFAULTS["daily_loss_global"],
            ),
            "max_exposure": _risk_limit_from_environment(
                "BOT_VPN_SIM_MAX_EXPOSURE",
                SIMULATION_RISK_DEFAULTS["max_exposure"],
            ),
        }
        self.signal_lock = asyncio.Lock()
        self._bg_task: Optional[asyncio.Task] = None
        self._listeners: List[Any] = []

    def load_config(self):
        """Carga el snapshot persistido e importa config.json una sola vez."""
        self.webhook_token = os.environ.get("BOT_VPN_WEBHOOK_TOKEN", "")
        self.auth = {
            "username": os.environ.get("BOT_VPN_AUTH_USERNAME", ""),
            "password": os.environ.get("BOT_VPN_AUTH_PASSWORD", ""),
            "role": "ADMIN_TRADER"
        }
        if self._store is None:
            self._store = SQLiteStore(self.database_path)
        legacy_data = {"server": {"port": 8000}, "identities": [], "bots": []}
        if os.path.exists(self.config_path):
            with open(self.config_path, "r", encoding="utf-8") as config_file:
                legacy_data = json.load(config_file)
        data, self._revision = self._store.load_or_import(legacy_data)
        self.auth["role"] = (data.get("auth") or {}).get("role", "ADMIN_TRADER")

        self.identities = {}
        for ident_data in data.get("identities", []):
            ident_id = ident_data.get("id")
            self.identities[ident_id] = IdentityProfile(
                id=ident_id,
                full_name=ident_data.get("full_name", "Desconocido"),
                alias=ident_data.get("alias", ""),
                country=ident_data.get("country", "US"),
                city=ident_data.get("city", "New York, NY"),
                flag=ident_data.get("flag", "🌐"),
                kyc_status=ident_data.get("kyc_status", "VERIFIED"),
                email=ident_data.get("email", ""),
                notes=ident_data.get("notes"),
                encrypted_envelope=ident_data.get("__pii_encrypted_v1")
            )

        self.bots = {}
        for b_data in data.get("bots", []):
            bot_id = b_data.get("id")
            strat = get_strategy(b_data.get("strategy", "ICTStrategy"))
            identity = self.identities.get(b_data.get("identity_id"))
            accounts = [
                Account(
                    id=acc.get("id"),
                    custom_name=acc.get("custom_name"),
                    broker=acc.get("broker", "Tradovate"),
                    prop_firm=acc.get("prop_firm", "Apex Trader Funding"),
                    balance=float(acc.get("balance", 50000.0)),
                    floating_pnl=float(acc.get("floating_pnl", 0.0)),
                    realized_pnl=float(acc.get("realized_pnl", 0.0)),
                    active_contracts=int(acc.get("active_contracts", 0)),
                    current_position=acc.get("current_position", "FLAT"),
                    entry_price=float(acc.get("entry_price", 0.0)),
                    status="NOT_CONFIGURED",
                    last_order_time=acc.get("last_order_time"),
                    titular_name=acc.get("titular_name", identity.full_name if identity else ""),
                    environment=acc.get("environment", "FUNDED_PA"),
                    username=acc.get("username", ""),
                    password_masked="••••••••",
                    max_contracts=int(acc.get("max_contracts", 2)),
                    daily_loss_limit=float(acc.get("daily_loss_limit", 1000.0)),
                    daily_pnl=float(acc.get("daily_pnl", 0.0)),
                    orders_today=int(acc.get("orders_today", 0)),
                    daily_metrics_date=acc.get("daily_metrics_date", datetime.now(timezone.utc).date().isoformat()),
                )
                for acc in b_data.get("accounts", [])
            ]
            bot = TradingBot(
                bot_id=bot_id,
                name=b_data.get("name"),
                strategy=strat,
                identity=identity,
                proxy_url=b_data.get("proxy_url"),
                outbound_ip=b_data.get("outbound_ip"),
                proxy_port=b_data.get("proxy_port"),
                isp_provider=b_data.get("isp_provider"),
                node_location=b_data.get("node_location"),
                geo_match_status=b_data.get("geo_match_status"),
                schedule=b_data.get("schedule"),
                accounts=accounts,
                status=b_data.get("status", "ACTIVE"),
                jitter_min_ms=b_data.get("jitter_min_ms", b_data.get("jitter_ms", 50)),
                jitter_max_ms=b_data.get("jitter_max_ms", 350),
                analysis_symbol=b_data.get("analysis_symbol", "NQ"),
                analysis_timeframes=b_data.get("analysis_timeframes")
            )
            bot.net_pnl = float(b_data.get("net_pnl", 0.0))
            bot.today_pnl = float(b_data.get("today_pnl", 0.0))
            bot.total_trades = int(b_data.get("total_trades", 0))
            bot.winning_trades = int(b_data.get("winning_trades", 0))
            bot.losing_trades = int(b_data.get("losing_trades", 0))
            bot.max_drawdown = float(b_data.get("max_drawdown", 0.0))
            self.bots[bot_id] = bot

        logger.info(
            "Cargados %s bots y %s titulares desde SQLite (%s).",
            len(self.bots), len(self.identities), self.database_path
        )

    async def refresh_if_changed(self) -> None:
        if self._store is not None and self._store.revision != self._revision:
            previous_bots = list(self.bots.values())
            self.load_config()
            await asyncio.gather(*(bot.proxy_connector.close() for bot in previous_bots))

    def save_config(
        self,
        event: Optional[Dict[str, Any]] = None,
        operations: Optional[List[Dict[str, Any]]] = None,
    ):
        """Guarda el snapshot y su auditoría en una sola transacción SQLite."""
        if self._store is None:
            self._store = SQLiteStore(self.database_path)
            self._revision = self._store.revision
        data = {
            "server": {"host": "127.0.0.1", "port": 8000},
            "auth": {"role": self.auth.get("role", "ADMIN_TRADER")},
            "identities": [ident.to_dict() for ident in self.identities.values()],
            "bots": [
                {
                    "id": bot.bot_id,
                    "name": bot.name,
                    "identity_id": bot.identity.id if bot.identity else None,
                    "strategy": bot.strategy.name,
                    "analysis_symbol": bot.analysis_symbol,
                    "analysis_timeframes": bot.analysis_timeframes,
                    "proxy_url": bot.public_proxy_url(),
                    "outbound_ip": bot.proxy_connector.detected_ip,
                    "proxy_port": bot.proxy_port,
                    "isp_provider": bot.isp_provider,
                    "node_location": bot.node_location,
                    "geo_match_status": bot.geo_match_status,
                    "status": bot.status,
                    "jitter_min_ms": bot.jitter_min_ms,
                    "jitter_max_ms": bot.jitter_max_ms,
                    "schedule": bot.schedule,
                    "net_pnl": bot.net_pnl,
                    "today_pnl": bot.today_pnl,
                    "total_trades": bot.total_trades,
                    "winning_trades": bot.winning_trades,
                    "losing_trades": bot.losing_trades,
                    "max_drawdown": bot.max_drawdown,
                    "accounts": [account.to_dict() for account in bot.accounts],
                }
                for bot in self.bots.values()
            ],
        }
        if event is None:
            event = {
                "action": "state_changed",
                "entity_type": "application",
                "details": {"bot_count": len(self.bots), "identity_count": len(self.identities)},
            }
        try:
            self._revision = self._store.save_snapshot(data, self._revision, event, operations)
        except (PersistenceConflict, sqlite3.Error):
            try:
                self.load_config()
            except (sqlite3.Error, json.JSONDecodeError, OSError):
                logger.exception("No se pudo restaurar el estado tras fallar la persistencia SQLite.")
            raise

    def close_storage(self) -> None:
        if self._store is not None:
            self._store.close()
            self._store = None

    def check_persistence(self) -> None:
        if self._store is None:
            raise sqlite3.OperationalError("Persistencia no inicializada.")
        self._store.health_check()

    def has_processed_signal(self, signal_id: str) -> bool:
        if self._store is None:
            self._store = SQLiteStore(self.database_path)
            _, self._revision = self._store.load_or_import({
                "server": {"port": 8000},
                "identities": [],
                "bots": [],
            })
        return self._store.has_processed_signal(signal_id)

    def flatten_all_positions(self) -> Dict[str, Any]:
        """
        Control de Pánico Institucional: Cierra inmediatamente todas las posiciones
        abiertas en todas las cuentas de todos los bots (FLAT total).
        """
        closed_bots = []
        total_pnl = 0.0
        for bot in self.bots.values():
            realized = bot.close_all_positions(self.market_price)
            total_pnl += realized
            closed_bots.append({
                "bot_id": bot.bot_id,
                "bot_name": bot.name,
                "titular": bot.identity.full_name if bot.identity else "N/A",
                "realized_pnl": realized
            })
            bot.log_event("EMERGENCY", f"🔴 FLATTEN GLOBAL: Todas las cuentas cerradas a {self.market_price}.")

        self.save_config(
            event={
                "action": "simulated_flatten_all",
                "entity_type": "application",
                "status": "SIMULATED",
                "details": {"market_price": self.market_price, "realized_pnl": round(total_pnl, 2)},
            },
            operations=[
                {
                    "bot_id": bot.bot_id,
                    "operation_type": "FLATTEN_POSITIONS",
                    "mode": "SIMULATED",
                    "status": "SIMULATED",
                    "details": {"market_price": self.market_price, "realized_pnl": item["realized_pnl"]},
                }
                for bot, item in zip(self.bots.values(), closed_bots)
            ],
        )
        return {
            "status": "ALL_FLATTENED",
            "mode": "SIMULATED",
            "market_price": self.market_price,
            "total_realized_pnl": round(total_pnl, 2),
            "bots_affected": closed_bots
        }

    def stop_all_bots(self) -> int:
        """
        Kill-Switch Global: Pausa inmediatamente todos los bots activos.
        """
        paused_count = 0
        for bot in self.bots.values():
            if bot.status == "ACTIVE":
                bot.status = "PAUSED"
                bot.log_event("EMERGENCY", "⏹️ KILL-SWITCH GLOBAL: Bot apagado por comando institucional.")
                paused_count += 1

        self.save_config(
            event={
                "action": "simulated_stop_all",
                "entity_type": "application",
                "details": {"bots_paused": paused_count, "mode": "SIMULATED"},
            }
        )
        return paused_count

    async def test_proxy(self, bot_id: str) -> Dict[str, Any]:
        """Ejecuta una prueba inmediata de latencia e IP pública para el proxy del bot."""
        bot = self.bots.get(bot_id)
        if not bot:
            return {"status": "ERROR", "message": f"Bot {bot_id} no encontrado"}

        ping, ip = await bot.proxy_connector.check_ping_and_ip()
        geo_ok, geo_msg = bot.is_geo_consistent()
        bot.log_event("NETWORK", f"Test de Proxy ejecutado: Ping={ping}ms | IP={ip} ({bot.isp_provider}) | {geo_msg}")

        return {
            "bot_id": bot.bot_id,
            "proxy_url": bot.public_proxy_url(),
            "outbound_ip": ip,
            "proxy_port": bot.proxy_port,
            "isp_provider": bot.isp_provider,
            "node_location": bot.node_location,
            "detected_ip": ip,
            "ping_ms": ping,
            "is_healthy": bot.proxy_connector.is_healthy,
            "geo_consistent": geo_ok,
            "geo_description": geo_msg,
            "titular": bot.identity.to_dict() if bot.identity else None
        }

    async def dispatch_webhook(self, signal: Dict[str, Any]) -> List[Dict[str, Any]]:
        target_bot_id = signal.get("bot_id")
        results = []

        if target_bot_id:
            bot = self.bots.get(target_bot_id)
            if bot is None:
                return [{
                    "status": "REJECTED",
                    "reason": "La señal referencia un bot inexistente; no se distribuirá a otros bots.",
                    "bot_id": target_bot_id,
                    "mode": "SIMULATED",
                }]
            return [await bot.process_signal(signal, self._check_simulation_risk)]

        target_strategy = signal.get("strategy")
        if target_strategy:
            matched_bots = [
                bot for bot in self.bots.values()
                if bot.strategy.name.lower() == target_strategy.lower()
            ]
            if not matched_bots:
                return [{
                    "status": "REJECTED",
                    "reason": "La señal referencia una estrategia desconocida.",
                    "mode": "SIMULATED",
                }]
        else:
            matched_bots = [bot for bot in self.bots.values() if bot.status == "ACTIVE"]

        for bot in matched_bots:
            results.append(await bot.process_signal(signal, self._check_simulation_risk))

        return results

    def _check_simulation_risk(self, selected_bot: TradingBot, decision: SignalDecision) -> Optional[str]:
        accounts = [
            (bot, account)
            for bot in self.bots.values()
            for account in bot.accounts
        ]
        for _, account in accounts:
            account.reset_daily_metrics_if_needed()

        if not selected_bot.accounts:
            return "Señal bloqueada: el bot no tiene cuentas de simulación vinculadas."

        if decision.contracts > self.simulation_risk_limits["max_contracts_per_account"]:
            return (
                "Señal bloqueada: supera el límite de demostración de "
                f"{self.simulation_risk_limits['max_contracts_per_account']} contrato(s) por cuenta."
            )

        if any(account.current_position != "FLAT" for account in selected_bot.accounts):
            return "Señal bloqueada: ya existe una posición simulada abierta en una cuenta del bot."

        global_orders_today = sum(account.orders_today for _, account in accounts)
        if global_orders_today + len(selected_bot.accounts) > self.simulation_risk_limits["max_orders_per_day"]:
            return "Señal bloqueada: se alcanzó el límite global de órdenes simuladas del día."

        for account in selected_bot.accounts:
            if decision.contracts > account.max_contracts:
                return f"Señal bloqueada: supera el límite de contratos de la cuenta {account.id}."
            account_loss_limit = min(
                account.daily_loss_limit,
                self.simulation_risk_limits["daily_loss_per_account"],
            )
            account_day_pnl = account.daily_pnl + account.floating_pnl
            projected_loss = abs(decision.entry_price - decision.stop_loss) * MNQ_POINT_VALUE * decision.contracts
            if account_day_pnl - projected_loss <= -account_loss_limit:
                return f"Señal bloqueada: alcanzaría el límite de pérdida diaria de la cuenta {account.id}."
            if account.orders_today >= self.simulation_risk_limits["max_orders_per_day"]:
                return f"Señal bloqueada: se alcanzó el límite diario de órdenes de la cuenta {account.id}."

        global_daily_loss = sum(
            min(0.0, account.daily_pnl + account.floating_pnl)
            for _, account in accounts
        )
        projected_global_loss = (
            abs(decision.entry_price - decision.stop_loss)
            * MNQ_POINT_VALUE
            * decision.contracts
            * len(selected_bot.accounts)
        )
        if global_daily_loss - projected_global_loss <= -self.simulation_risk_limits["daily_loss_global"]:
            return "Señal bloqueada: alcanzaría el límite global de pérdida diaria simulada."

        active_contracts = sum(account.active_contracts for _, account in accounts)
        projected_contracts = active_contracts + decision.contracts * len(selected_bot.accounts)
        if projected_contracts > self.simulation_risk_limits["max_total_contracts"]:
            return "Señal bloqueada: supera el límite global de contratos activos simulados."

        current_exposure = sum(
            account.entry_price * account.active_contracts * MNQ_POINT_VALUE
            for _, account in accounts
        )
        new_exposure = decision.entry_price * decision.contracts * MNQ_POINT_VALUE * len(selected_bot.accounts)
        if current_exposure + new_exposure > self.simulation_risk_limits["max_exposure"]:
            return "Señal bloqueada: supera el límite global de exposición nocional simulada."
        return None

    async def telemetry_loop(self, broadcast_fn):
        while True:
            try:
                await self.refresh_if_changed()
                # Micro-fluctuación realista de MNQ
                tick_change = random.choice([-0.25, 0.0, 0.25, -0.50, 0.50])
                self.market_price = round(self.market_price + tick_change, 2)

                for bot in self.bots.values():
                    if time.time() - bot.proxy_connector.last_check > 25:
                        asyncio.create_task(bot.proxy_connector.check_ping_and_ip())
                    bot.simulate_price_movement(self.market_price)

                if broadcast_fn:
                    state_payload = self.get_system_snapshot()
                    await broadcast_fn(state_payload)

            except Exception as e:
                logger.error(f"Error en telemetry_loop: {e}")

            await asyncio.sleep(1.0)

    def get_system_snapshot(self) -> Dict[str, Any]:
        bots_data = [b.to_dict() for b in self.bots.values()]
        identities_data = [i.to_dict() for i in self.identities.values()]
        total_pnl = sum(b["net_pnl"] for b in bots_data)
        active_bots = sum(1 for b in bots_data if b["status"] == "ACTIVE")
        total_contracts = sum(b["total_active_contracts"] for b in bots_data)

        try:
            ny_tz = zoneinfo.ZoneInfo("America/New_York")
            ny_now = datetime.now(ny_tz).strftime("%H:%M:%S EST")
        except Exception:
            ny_now = datetime.now().strftime("%H:%M:%S Local")

        return {
            "type": "SNAPSHOT",
            "execution_mode": "SIMULATED",
            "paper_trading_available": False,
            "risk_policy": {
                "type": "DEMO_ONLY",
                "limits": dict(self.simulation_risk_limits),
            },
            "market_price_mnq": self.market_price,
            "ny_time": ny_now,
            "global_stats": {
                "total_pnl": round(total_pnl, 2),
                "active_bots": active_bots,
                "total_bots": len(bots_data),
                "total_active_contracts": total_contracts,
                "total_identities": len(identities_data)
            },
            "identities": identities_data,
            "bots": bots_data
        }
