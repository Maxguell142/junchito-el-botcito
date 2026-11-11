/**
 * INVICTUS TRADING OS / QUANTUM FX — Financial Contracts & Interfaces
 * 
 * Contratos de datos rígidos para acelerar el desarrollo con IA (Codex, Antigravity, Cursor)
 * y eliminar alucinaciones o explicaciones redundantes de tipos en los prompts.
 */

export type OrderSide = 'BUY' | 'SELL';
export type PositionSide = 'LONG' | 'SHORT' | 'FLAT';
export type TradeResultStatus = 'TP_HIT' | 'STOP_HIT' | 'MANUAL_CLOSE' | 'CIRCUIT_BREAKER_CLOSE' | 'OPEN';
export type AccountEnvironment = 'FUNDED_PA' | 'EVALUATION' | 'DEMO';
export type SupportedPropFirm = 'Apex Trader Funding' | 'Topstep' | 'Leelo Trading' | 'Blue Guardian';
export type SupportedBroker = 'Tradovate' | 'Rithmic' | 'ProjectX';
export type SupportedSymbol = 'NQ' | 'ES' | 'MNQ' | 'MES';
export type TimeframeInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * 1. Modela una operación ejecutada o simulada en CME Micro E-mini (MNQ)
 */
export interface Trade {
  id: string;
  bot_id: string;
  bot_name: string;
  account_id: string;
  symbol: SupportedSymbol;
  timeframe: TimeframeInterval;
  strategy: string;
  side: OrderSide;
  contracts: number;
  entry_price: number;
  exit_price: number | null;
  entry_time: string;           // ISO 8601 o formato New York EST
  exit_time: string | null;
  stop_loss: number;
  take_profit: number;
  pnl_points: number;           // Puntos MNQ
  pnl_usd: number;              // PnL en dólares ($2/pt en MNQ)
  status: TradeResultStatus;
}

/**
 * 2. Métricas y configuración de cuenta de fondeo (Prop Firm)
 */
export interface AccountMetrics {
  id: string;
  custom_name: string;          // Ej: "Apex 50k PA #1"
  titular_id: string | null;
  titular_name: string;         // Nombre legal KYC
  environment: AccountEnvironment;
  broker: SupportedBroker;
  prop_firm: SupportedPropFirm;
  username_masked: string;      // "APEX-***" (Credenciales nunca en texto plano)
  balance: number;
  starting_balance: number;
  max_contracts: number;
  daily_loss_limit: number;     // En dólares (ej: 1000)
  floating_pnl: number;
  realized_pnl: number;
  active_contracts: number;
  current_position: PositionSide;
  entry_price: number;
  status: 'CONNECTED' | 'DISCONNECTED' | 'NOT_CONFIGURED';
  last_order_time: string | null;
}

/**
 * 3. Parámetros de aislamiento de red y sesión de proxy SOCKS5 residencial
 */
export interface VPNSession {
  bot_id: string;
  proxy_url: string;            // Formato: socks5://user:pass@host:port (sin credenciales en logs)
  outbound_ip: string;          // IP pública verificada en EE.UU.
  isp_provider: string;         // Ej: "Comcast Cable Communications (Residential ISP)"
  node_location: string;        // Ej: "Chicago, IL (Near CME Data Center)"
  proxy_ping_ms: number;        // Latencia viva en ms
  is_healthy: boolean;
  geo_matched: boolean;         // Coincidencia con estado de titular KYC
  jitter_min_ms: number;        // Anti-mirroring delay mínimo
  jitter_max_ms: number;        // Anti-mirroring delay máximo
}

/**
 * 4. Reglas institucionales de Prop Firm y Circuit Breaker
 */
export interface PropFirmConfig {
  daily_loss_limit: number;     // DLL en dólares
  consistency_target: number;   // Meta en dólares donde se bloquea el bot para proteger payout
  auto_lock_consistency: boolean;
  pause_on_red_news: boolean;   // Pausa 5 min antes / 10 min después de noticias rojas
  drawdown_type: 'EOD' | 'TRAILING_INTRADAY' | 'STATIC';
  status: 'NORMAL' | 'LOCKED_CONSISTENCY' | 'TRIPPED_STOP';
}

/**
 * 5. Evento macroeconómico ForexFactory
 */
export interface ForexFactoryEvent {
  id: string;
  event: string;
  currency: 'USD' | 'JPY' | 'EUR' | 'GBP';
  impact: NewsImpact;
  time_est: string;
  date: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  better_worse: 'better' | 'worse' | 'neutral' | 'pending';
  status: 'COMPLETED' | 'ACTIVE' | 'UPCOMING';
}

/**
 * 6. Snapshot de ejecución en tiempo real de un Trading Bot
 */
export interface BotRuntimeSnapshot {
  id: string;
  name: string;
  strategy: string;
  status: 'ACTIVE' | 'PAUSED' | 'EMERGENCY_STOP';
  schedule: {
    start_time: string;         // "09:30"
    end_time: string;           // "12:00"
    timezone: 'America/New_York';
  };
  accounts: AccountMetrics[];
  circuit_breaker: PropFirmConfig;
  vpn_session: VPNSession;
  net_pnl: number;
  today_pnl: number;
  total_trades: number;
  win_rate: number;
}
