import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from fastapi_service.bot_engine import Account, BotManager, BrokerAdapter, TradingBot
from fastapi_service.strategies import SignalDecision, get_strategy


def make_manager_with_accounts(account_count=1):
    manager = BotManager(database_path=":memory:")
    accounts = [
        Account(
            id=f"account-{index}",
            custom_name=f"Demo account {index}",
            broker="Test",
            prop_firm="Local simulation",
            daily_loss_limit=1000.0,
        )
        for index in range(account_count)
    ]
    bot = TradingBot(
        bot_id="demo-bot",
        name="Demo bot",
        strategy=get_strategy("ICTStrategy"),
        accounts=accounts,
        schedule={"start_time": "00:00", "end_time": "23:59", "timezone": "UTC"},
    )
    manager.bots[bot.bot_id] = bot
    return manager, bot


def make_decision(contracts=1):
    return SignalDecision(
        approved=True,
        action="BUY",
        contracts=contracts,
        entry_price=18000.0,
        stop_loss=17985.0,
        take_profit=18030.0,
        risk_reward_ratio=2.0,
        reason="test",
    )


def test_demo_risk_policy_allows_one_safe_simulated_contract_and_rejects_duplicates():
    manager, bot = make_manager_with_accounts()
    decision = make_decision()

    assert manager._check_simulation_risk(bot, decision) is None
    result = asyncio.run(BrokerAdapter.execute_order(bot.accounts[0], decision))
    assert result["mode"] == "SIMULATED"
    assert result["status"] == "SIMULATED"
    assert bot.accounts[0].orders_today == 1
    assert "posición simulada abierta" in manager._check_simulation_risk(bot, decision)


def test_demo_risk_policy_enforces_size_daily_loss_exposure_and_order_limits():
    manager, bot = make_manager_with_accounts()
    assert "contrato(s) por cuenta" in manager._check_simulation_risk(bot, make_decision(2))

    account = bot.accounts[0]
    account.daily_pnl = -25.0
    assert "pérdida diaria" in manager._check_simulation_risk(bot, make_decision())

    account.daily_pnl = 0.0
    account.orders_today = 3
    assert "órdenes" in manager._check_simulation_risk(bot, make_decision())

    account.orders_today = 0
    manager.simulation_risk_limits["max_exposure"] = 35999.0
    assert "exposición" in manager._check_simulation_risk(bot, make_decision())


def test_demo_risk_policy_enforces_global_caps_and_resets_daily_counters():
    manager, bot = make_manager_with_accounts(account_count=2)
    manager.simulation_risk_limits["max_total_contracts"] = 1
    assert "límite global de contratos" in manager._check_simulation_risk(bot, make_decision())

    account = bot.accounts[0]
    account.daily_metrics_date = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    account.daily_pnl = -40.0
    account.orders_today = 3
    account.reset_daily_metrics_if_needed()
    assert account.daily_pnl == 0.0
    assert account.orders_today == 0


def test_technical_analysis_strategy_does_not_approve_execution_signals():
    decision = get_strategy("TechnicalAnalysisStrategy").evaluate_signal({
        "action": "BUY",
        "price": 18000.0,
    })
    assert decision.approved is False
    assert decision.action == "HOLD"
    assert decision.contracts == 0
    assert "no convierte señales externas" in decision.reason


def test_invalid_signal_targets_fail_closed_without_broadcasting():
    manager, _ = make_manager_with_accounts()

    result = asyncio.run(manager.dispatch_webhook({
        "bot_id": "missing-bot",
        "action": "BUY",
        "price": 18000.0,
    }))
    assert result[0]["status"] == "REJECTED"
    assert "no se distribuirá" in result[0]["reason"]

    result = asyncio.run(manager.dispatch_webhook({
        "strategy": "UnknownStrategy",
        "action": "BUY",
        "price": 18000.0,
    }))
    assert result[0]["status"] == "REJECTED"
    assert "estrategia desconocida" in result[0]["reason"]


def test_demo_global_limits_are_configurable_and_invalid_values_fail_closed(monkeypatch):
    for variable in (
        "BOT_VPN_SIM_MAX_CONTRACTS_PER_ACCOUNT",
        "BOT_VPN_SIM_MAX_TOTAL_CONTRACTS",
        "BOT_VPN_SIM_MAX_ORDERS_PER_DAY",
        "BOT_VPN_SIM_DAILY_LOSS_PER_ACCOUNT",
        "BOT_VPN_SIM_DAILY_LOSS_GLOBAL",
        "BOT_VPN_SIM_MAX_EXPOSURE",
    ):
        monkeypatch.delenv(variable, raising=False)
    defaults = BotManager(database_path=":memory:").simulation_risk_limits
    assert defaults["max_contracts_per_account"] == 1
    assert defaults["max_total_contracts"] == 2
    assert defaults["max_orders_per_day"] == 3
    assert defaults["daily_loss_per_account"] == 50.0
    assert defaults["daily_loss_global"] == 100.0
    assert defaults["max_exposure"] == 100000.0

    monkeypatch.setenv("BOT_VPN_SIM_MAX_TOTAL_CONTRACTS", "3")
    manager = BotManager(database_path=":memory:")
    assert manager.simulation_risk_limits["max_total_contracts"] == 3

    monkeypatch.setenv("BOT_VPN_SIM_MAX_TOTAL_CONTRACTS", "0")
    with pytest.raises(ValueError, match="BOT_VPN_SIM_MAX_TOTAL_CONTRACTS"):
        BotManager(database_path=":memory:")


def test_simulated_execution_failure_does_not_report_success_and_can_recover(monkeypatch):
    manager, bot = make_manager_with_accounts()
    bot.is_within_schedule = lambda: (True, "test schedule")
    original_execute_order = BrokerAdapter.execute_order

    async def fail_simulated_order(account, decision):
        raise RuntimeError("forced local simulation failure")

    monkeypatch.setattr(BrokerAdapter, "execute_order", fail_simulated_order)
    failed = asyncio.run(bot.process_signal(
        {"action": "BUY", "price": 18000.0},
        manager._check_simulation_risk,
    ))
    assert failed["status"] == "FAILED"
    assert failed["mode"] == "SIMULATED"
    assert bot.accounts[0].active_contracts == 0
    assert bot.accounts[0].orders_today == 0

    monkeypatch.setattr(BrokerAdapter, "execute_order", original_execute_order)
    recovered = asyncio.run(bot.process_signal(
        {"action": "BUY", "price": 18000.0},
        manager._check_simulation_risk,
    ))
    assert recovered["status"] == "SIMULATED"
    assert bot.accounts[0].active_contracts == 1
    assert bot.accounts[0].orders_today == 1
