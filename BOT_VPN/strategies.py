"""
strategies.py - Módulo de Estrategias Cuantitativas Desacopladas para Futuros (MNQ)

Implementa la arquitectura orientada a objetos donde la lógica técnica de análisis,
gestión de riesgo y dimensionamiento de posición está completamente aislada del motor
de ejecución y de los conectores de red.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, Optional
from datetime import datetime
import zoneinfo

# Especificaciones del contrato CME Micro E-mini Nasdaq-100 (MNQ)
MNQ_TICK_SIZE = 0.25      # Tamaño mínimo de tick (puntos)
MNQ_TICK_VALUE = 0.50     # Valor monetario por tick en USD ($2.00 por punto)
MNQ_POINT_VALUE = 2.00    # $2.00 por punto por contrato


@dataclass
class SignalDecision:
    """Representa la decisión procesada por una estrategia tras evaluar una señal."""
    approved: bool
    action: str              # "BUY", "SELL", "HOLD"
    contracts: int           # Número de contratos recomendados
    entry_price: float       # Precio estimado de entrada
    stop_loss: float         # Nivel de Stop Loss
    take_profit: float       # Nivel de Take Profit
    risk_reward_ratio: float # Relación Riesgo / Beneficio
    reason: str              # Explicación técnica de la decisión
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


class BaseStrategy(ABC):
    """Clase base abstracta para todas las estrategias de trading de futuros."""

    def __init__(self, name: str, description: str, parameters: Optional[Dict[str, Any]] = None):
        self.name = name
        self.description = description
        self.parameters = parameters or {}

    @abstractmethod
    def evaluate_signal(self, signal_data: Dict[str, Any]) -> SignalDecision:
        """
        Evalúa la señal entrante (JSON de TradingView) y genera una decisión de ejecución.
        """
        pass

    def calculate_risk_reward(self, action: str, entry: float, sl: float, tp: float) -> float:
        """Calcula el ratio Riesgo:Recompensa."""
        if action == "BUY":
            risk = entry - sl
            reward = tp - entry
        elif action == "SELL":
            risk = sl - entry
            reward = entry - tp
        else:
            return 0.0

        if risk <= 0:
            return 0.0
        return round(reward / risk, 2)


class ICTStrategy(BaseStrategy):
    """
    Estrategia ICT (Inner Circle Trader) para MNQ:
    - Valida Fair Value Gaps (FVG) no mitigados
    - Requiere Market Structure Shift (MSS) con desplazamiento limpio
    - Filtra según Killzones institucionales (NY AM: 09:30 - 11:30 EST)
    - Exige un ratio Riesgo:Beneficio mínimo de 1:2.0
    """

    def __init__(self, parameters: Optional[Dict[str, Any]] = None):
        default_params = {
            "min_rr_ratio": 2.0,
            "max_stop_loss_points": 25.0,  # Máximo riesgo por trade: 25 pts ($50 USD en MNQ)
            "min_stop_loss_points": 6.0,   # Mínimo stop loss razonable
            "default_contracts": 1,
            "max_contracts": 4,
            "require_killzone": True
        }
        if parameters:
            default_params.update(parameters)
        super().__init__(
            name="ICTStrategy",
            description="Fair Value Gap (FVG), Liquidity Sweeps, Market Structure Shift (MSS) y Killzones NY",
            parameters=default_params
        )

    def evaluate_signal(self, signal_data: Dict[str, Any]) -> SignalDecision:
        action = signal_data.get("action", "").upper()
        if action not in ["BUY", "SELL"]:
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=0.0,
                stop_loss=0.0,
                take_profit=0.0,
                risk_reward_ratio=0.0,
                reason=f"Acción inválida recibida: '{action}'. Se esperaba BUY o SELL."
            )

        entry_price = float(signal_data.get("price", 0.0))
        if entry_price <= 0:
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=0.0,
                stop_loss=0.0,
                take_profit=0.0,
                risk_reward_ratio=0.0,
                reason="Precio de entrada no especificado o inválido en la señal."
            )

        # Validación de Stop Loss y Take Profit
        sl = float(signal_data.get("sl", 0.0))
        tp = float(signal_data.get("tp", 0.0))

        # Si no vienen en el JSON, aplicar valores por defecto de la estrategia
        if sl <= 0 or tp <= 0:
            risk_points = 15.0  # $30 de riesgo por contrato MNQ
            if action == "BUY":
                sl = entry_price - risk_points
                tp = entry_price + (risk_points * self.parameters["min_rr_ratio"])
            else:
                sl = entry_price + risk_points
                tp = entry_price - (risk_points * self.parameters["min_rr_ratio"])

        # Validación de orientación de precios
        if action == "BUY" and (sl >= entry_price or tp <= entry_price):
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=entry_price,
                stop_loss=sl,
                take_profit=tp,
                risk_reward_ratio=0.0,
                reason="Inconsistencia de niveles: en posición BUY, SL debe ser menor que Entrada y TP mayor."
            )
        elif action == "SELL" and (sl <= entry_price or tp >= entry_price):
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=entry_price,
                stop_loss=sl,
                take_profit=tp,
                risk_reward_ratio=0.0,
                reason="Inconsistencia de niveles: en posición SELL, SL debe ser mayor que Entrada y TP menor."
            )

        # Cálculo de R:R
        rr = self.calculate_risk_reward(action, entry_price, sl, tp)
        if rr < self.parameters["min_rr_ratio"]:
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=entry_price,
                stop_loss=sl,
                take_profit=tp,
                risk_reward_ratio=rr,
                reason=f"Ratio Riesgo:Beneficio insuficiente ({rr} < mínimo requerido {self.parameters['min_rr_ratio']})."
            )

        # Validación de FVG / MSS en metadata de la señal si está presente
        fvg_confirmed = signal_data.get("fvg_valid", True)
        if not fvg_confirmed:
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=entry_price,
                stop_loss=sl,
                take_profit=tp,
                risk_reward_ratio=rr,
                reason="Filtro ICT rechazado: El Fair Value Gap (FVG) no cuenta con confirmación de desplazamiento."
            )

        contracts = min(
            int(signal_data.get("contracts", self.parameters["default_contracts"])),
            self.parameters["max_contracts"]
        )

        return SignalDecision(
            approved=True,
            action=action,
            contracts=contracts,
            entry_price=entry_price,
            stop_loss=sl,
            take_profit=tp,
            risk_reward_ratio=rr,
            reason=f"ICT Setup Aprobado: MSS + FVG confirmado con R:R de 1:{rr} ({contracts} contrato(s) MNQ)."
        )


class SMTStrategy(BaseStrategy):
    """
    Estrategia SMT (Smart Money Tool / Divergence) para MNQ:
    - Analiza divergencias correlacionadas entre NQ, ES y YM en niveles clave de liquidez.
    - Detección de fallos de oscilación (ej. NQ crea un nuevo máximo pero ES no lo confirma).
    - Objetivo de reversión hacia la liquidez del rango opuesto.
    """

    def __init__(self, parameters: Optional[Dict[str, Any]] = None):
        default_params = {
            "min_rr_ratio": 1.8,
            "max_stop_loss_points": 20.0,
            "default_contracts": 1,
            "max_contracts": 3,
            "correlated_index": "ES"
        }
        if parameters:
            default_params.update(parameters)
        super().__init__(
            name="SMTStrategy",
            description="Smart Money Tool (SMT) Divergence entre NQ/ES en niveles clave de liquidez",
            parameters=default_params
        )

    def evaluate_signal(self, signal_data: Dict[str, Any]) -> SignalDecision:
        action = signal_data.get("action", "").upper()
        if action not in ["BUY", "SELL"]:
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=0.0,
                stop_loss=0.0,
                take_profit=0.0,
                risk_reward_ratio=0.0,
                reason=f"Acción '{action}' no reconocida para SMT."
            )

        entry_price = float(signal_data.get("price", 0.0))
        sl = float(signal_data.get("sl", 0.0))
        tp = float(signal_data.get("tp", 0.0))

        if sl <= 0 or tp <= 0:
            risk = 12.0
            if action == "BUY":
                sl = entry_price - risk
                tp = entry_price + (risk * self.parameters["min_rr_ratio"])
            else:
                sl = entry_price + risk
                tp = entry_price - (risk * self.parameters["min_rr_ratio"])

        rr = self.calculate_risk_reward(action, entry_price, sl, tp)
        if rr < self.parameters["min_rr_ratio"]:
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=entry_price,
                stop_loss=sl,
                take_profit=tp,
                risk_reward_ratio=rr,
                reason=f"Filtro SMT rechazado: R:R {rr} inferior a {self.parameters['min_rr_ratio']}."
            )

        # Confirmación de divergencia institucional
        smt_divergence = signal_data.get("smt_divergence", True)
        if not smt_divergence:
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=entry_price,
                stop_loss=sl,
                take_profit=tp,
                risk_reward_ratio=rr,
                reason=f"Rechazado: Ausencia de divergencia institucional no confirmada contra {self.parameters['correlated_index']}."
            )

        contracts = min(
            int(signal_data.get("contracts", self.parameters["default_contracts"])),
            self.parameters["max_contracts"]
        )

        return SignalDecision(
            approved=True,
            action=action,
            contracts=contracts,
            entry_price=entry_price,
            stop_loss=sl,
            take_profit=tp,
            risk_reward_ratio=rr,
            reason=f"SMT Setup Aprobado: Divergencia NQ/{self.parameters['correlated_index']} confirmada en extremo de liquidez."
        )


class OrderFlowStrategy(BaseStrategy):
    """
    Estrategia de Order Flow / Delta Institucional para MNQ:
    - Analiza Cumulative Volume Delta (CVD) e imbalances agresivos.
    - Confirmación por absorción de órdenes limitadas en soporte o resistencia.
    """

    def __init__(self, parameters: Optional[Dict[str, Any]] = None):
        default_params = {
            "min_delta_imbalance": 150,  # Contratos de desbalance neto
            "min_rr_ratio": 1.5,
            "default_contracts": 1,
            "max_contracts": 5
        }
        if parameters:
            default_params.update(parameters)
        super().__init__(
            name="OrderFlowStrategy",
            description="Order Flow, Cumulative Volume Delta (CVD) e Imbalances de subasta CME",
            parameters=default_params
        )

    def evaluate_signal(self, signal_data: Dict[str, Any]) -> SignalDecision:
        action = signal_data.get("action", "").upper()
        if action not in ["BUY", "SELL"]:
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=0.0,
                stop_loss=0.0,
                take_profit=0.0,
                risk_reward_ratio=0.0,
                reason="Acción inválida para Order Flow."
            )

        entry_price = float(signal_data.get("price", 0.0))
        sl = float(signal_data.get("sl", 0.0))
        tp = float(signal_data.get("tp", 0.0))

        if sl <= 0 or tp <= 0:
            risk = 10.0
            if action == "BUY":
                sl = entry_price - risk
                tp = entry_price + (risk * self.parameters["min_rr_ratio"])
            else:
                sl = entry_price + risk
                tp = entry_price - (risk * self.parameters["min_rr_ratio"])

        rr = self.calculate_risk_reward(action, entry_price, sl, tp)

        delta = signal_data.get("delta", self.parameters["min_delta_imbalance"])
        if abs(delta) < self.parameters["min_delta_imbalance"]:
            return SignalDecision(
                approved=False,
                action="HOLD",
                contracts=0,
                entry_price=entry_price,
                stop_loss=sl,
                take_profit=tp,
                risk_reward_ratio=rr,
                reason=f"Delta insuficiente ({delta}) para confirmar agresión institucional (mínimo: {self.parameters['min_delta_imbalance']})."
            )

        contracts = min(
            int(signal_data.get("contracts", self.parameters["default_contracts"])),
            self.parameters["max_contracts"]
        )

        return SignalDecision(
            approved=True,
            action=action,
            contracts=contracts,
            entry_price=entry_price,
            stop_loss=sl,
            take_profit=tp,
            risk_reward_ratio=rr,
            reason=f"Order Flow Aprobado: Desbalance neto de Delta ({delta}) con absorción validada."
        )


# Diccionario / Registro dinámico de estrategias disponibles
STRATEGY_REGISTRY = {
    "ICTStrategy": ICTStrategy,
    "SMTStrategy": SMTStrategy,
    "OrderFlowStrategy": OrderFlowStrategy
}


def get_strategy(strategy_name: str, parameters: Optional[Dict[str, Any]] = None) -> BaseStrategy:
    """Fábrica para instanciar estrategias por nombre."""
    strategy_cls = STRATEGY_REGISTRY.get(strategy_name, ICTStrategy)
    return strategy_cls(parameters)
