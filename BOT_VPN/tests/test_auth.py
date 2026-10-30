import asyncio
import json
from pathlib import Path
import sqlite3
import tempfile
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from bot_engine import Account, BotManager, ProxyConnector, TradingBot
import main
from strategies import get_strategy


TEST_USERNAME = "test-operator"
TEST_PASSWORD = "test-password-not-for-production"
TEST_TOKEN = "test-session-token-not-for-production"


@pytest.fixture
def client(monkeypatch, tmp_path):
    main.bot_manager.close_storage()
    monkeypatch.setattr(main.bot_manager, "database_path", str(tmp_path / "gateway.sqlite3"))
    monkeypatch.setattr(main.bot_manager, "config_path", str(tmp_path / "config.json"))
    monkeypatch.setattr(main.bot_manager, "_store", None)
    monkeypatch.setattr(main.bot_manager, "bots", {})
    monkeypatch.setattr(main.bot_manager, "identities", {})
    main.auth_sessions.clear()
    main.login_attempts.clear()
    main.bot_manager.webhook_token = ""

    load_config = main.bot_manager.load_config

    def load_test_config():
        load_config()
        main.bot_manager.auth = {
            "username": TEST_USERNAME,
            "password": TEST_PASSWORD,
            "role": "ADMIN_TRADER",
        }
        main.bot_manager.webhook_token = ""

    monkeypatch.setattr(main.bot_manager, "load_config", load_test_config)
    with TestClient(main.app) as test_client:
        yield test_client
    main.bot_manager.close_storage()


def test_fastapi_startup_and_rest_authentication(client):
    assert Path(main.bot_manager.config_path).name == "config.json"
    assert Path(main.bot_manager.config_path).resolve() != Path(main.__file__).resolve().parent / "config.json"
    assert client.get("/").status_code == 200
    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    assert health.json()["components"]["persistence"] == "healthy"
    assert client.get("/api/strategies").status_code == 401
    assert client.get(
        "/api/strategies",
        headers={"Authorization": "Bearer invalid-token"},
    ).status_code == 401

    login = client.post("/api/auth/login", json={
        "username": TEST_USERNAME,
        "password": TEST_PASSWORD,
    })
    assert login.status_code == 200
    token = login.json()["token"]
    assert token != TEST_TOKEN
    assert login.json()["expires_in"] == 1800
    assert client.get(
        "/api/strategies",
        headers={"Authorization": f"Bearer {token}"},
    ).status_code == 200
    identity_response = client.post(
        "/api/identities",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "id": "demo-pending-identity",
            "full_name": "Demo identity",
        },
    )
    assert identity_response.status_code == 200
    assert identity_response.json()["identity"]["kyc_status"] == "PENDING"
    bot_response = client.post(
        "/api/bots",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "id": "analysis-bot",
            "name": "Historical analysis bot",
            "strategy": "TechnicalAnalysisStrategy",
            "analysis_symbol": "ES",
            "analysis_timeframes": ["5m", "1h"],
        },
    )
    assert bot_response.status_code == 200
    assert bot_response.json()["bot"]["analysis_symbol"] == "ES"
    assert bot_response.json()["bot"]["analysis_timeframes"] == ["5m", "1h"]
    duplicate_timeframes = client.post(
        "/api/bots",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "id": "invalid-analysis-bot",
            "name": "Invalid analysis bot",
            "strategy": "ICTStrategy",
            "analysis_timeframes": ["5m", "5m"],
        },
    )
    assert duplicate_timeframes.status_code == 422
    assert "access-control-allow-origin" not in client.get("/").headers

    expired_token = "expired-session-test"
    main.auth_sessions[expired_token] = time.monotonic() - 1
    assert client.get(
        "/api/strategies",
        headers={"Authorization": f"Bearer {expired_token}"},
    ).status_code == 401

    logout = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logout.status_code == 204
    assert client.get(
        "/api/strategies",
        headers={"Authorization": f"Bearer {token}"},
    ).status_code == 401

    for _ in range(5):
        failed_login = client.post("/api/auth/login", json={
            "username": TEST_USERNAME,
            "password": "incorrect-password",
        })
        assert failed_login.status_code == 401
    limited_login = client.post("/api/auth/login", json={
        "username": TEST_USERNAME,
        "password": TEST_PASSWORD,
    })
    assert limited_login.status_code == 429


def test_fastapi_health_check_reports_database_status(client, monkeypatch):
    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json() == {
        "status": "healthy",
        "service": "fastapi-gateway",
        "mode": "SIMULATED",
        "components": {
            "persistence": "healthy",
            "broker": "disabled",
            "market_data": "simulated",
        },
    }

    def fail_health_check():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(main.bot_manager._store, "health_check", fail_health_check)
    unavailable = client.get("/healthz")
    assert unavailable.status_code == 503
    assert unavailable.json()["status"] == "unhealthy"
    assert unavailable.json()["components"]["persistence"] == "unavailable"


def test_fastapi_websocket_requires_authentication(client):
    login = client.post("/api/auth/login", json={
        "username": TEST_USERNAME,
        "password": TEST_PASSWORD,
    })
    token = login.json()["token"]
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"action": "AUTH", "token": token})
        assert websocket.receive_json()["type"] == "SNAPSHOT"

    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"action": "PING"})
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_login_supports_unicode_credentials(client, monkeypatch):
    monkeypatch.setattr(main.bot_manager, "auth", {
        "username": "operador-á",
        "password": "contraseña-ñ",
        "role": "ADMIN_TRADER",
    })
    response = client.post("/api/auth/login", json={
        "username": "operador-á",
        "password": "contraseña-ñ",
    })
    assert response.status_code == 200


def test_security_validation_and_webhook_token_handling(client, monkeypatch):
    login = client.post("/api/auth/login", json={
        "username": TEST_USERNAME,
        "password": TEST_PASSWORD,
    })
    token = login.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    invalid_schedule = client.put(
        "/api/bots/missing/schedule",
        headers=headers,
        json={
            "start_time": "99:99",
            "end_time": "11:00",
            "timezone": "Not/AZone",
            "unexpected": "field",
        },
    )
    assert invalid_schedule.status_code == 422
    broker_credentials = client.post(
        "/api/bots/missing/accounts",
        headers=headers,
        json={
            "id": "account",
            "custom_name": "Test",
            "username": "broker-login",
            "password": "broker-password",
        },
    )
    assert broker_credentials.status_code == 422
    embedded_credentials = client.post(
        "/api/bots",
        headers=headers,
        json={
            "id": "embedded-account-bot",
            "name": "Embedded account bot",
            "strategy": "ICTStrategy",
            "accounts": [{
                "id": "account",
                "custom_name": "Test",
                "password": "broker-password",
            }],
        },
    )
    assert embedded_credentials.status_code == 422
    oversized_request = client.post(
        "/api/auth/login",
        content=b"x" * (33 * 1024),
        headers={"Content-Type": "application/json"},
    )
    assert oversized_request.status_code == 413

    monkeypatch.setattr(main.bot_manager, "webhook_token", "test-webhook-token")
    bad_webhook = client.post("/api/webhook", json={
        "token": "wrong-token",
        "action": "BUY",
        "price": 100.0,
    })
    assert bad_webhook.status_code == 401
    valid_webhook = client.post("/api/webhook", json={
        "token": "test-webhook-token",
        "action": "BUY",
        "price": 100.0,
    })
    assert valid_webhook.status_code == 200
    assert valid_webhook.json()["mode"] == "SIMULATED"


def test_webhook_rejects_paper_and_ignores_duplicate_signal_ids(client, monkeypatch):
    monkeypatch.setattr(main.bot_manager, "webhook_token", "test-webhook-token")
    account = Account(
        id="simulation-account",
        custom_name="Simulation account",
        broker="Test",
        prop_firm="Local simulation",
    )
    bot = TradingBot(
        bot_id="simulation-bot",
        name="Simulation bot",
        strategy=get_strategy("ICTStrategy"),
        accounts=[account],
    )
    bot.is_within_schedule = lambda: (True, "test schedule")
    main.bot_manager.bots = {bot.bot_id: bot}

    paper_response = client.post("/api/webhook", json={
        "token": "test-webhook-token",
        "bot_id": "simulation-bot",
        "execution_mode": "PAPER",
        "action": "BUY",
        "price": 100.0,
    })
    assert paper_response.status_code == 501
    live_response = client.post("/api/webhook", json={
        "token": "test-webhook-token",
        "bot_id": "simulation-bot",
        "execution_mode": "LIVE",
        "action": "BUY",
        "price": 100.0,
    })
    assert live_response.status_code == 422

    signal = {
        "token": "test-webhook-token",
        "bot_id": "simulation-bot",
        "signal_id": "duplicate-signal-1",
        "action": "BUY",
        "price": 100.0,
        "contracts": 2,
    }
    first_response = client.post("/api/webhook", json=signal)
    duplicate_response = client.post("/api/webhook", json=signal)
    assert first_response.status_code == 200
    assert first_response.json()["mode"] == "SIMULATED"
    assert first_response.json()["results"][0]["status"] == "RISK_REJECTED"
    assert "contrato(s) por cuenta" in first_response.json()["results"][0]["reason"]
    assert duplicate_response.status_code == 200
    assert duplicate_response.json()["status"] == "DUPLICATE_IGNORED"
    assert duplicate_response.json()["results"] == []

    signal["signal_id"] = "accepted-signal-1"
    signal["contracts"] = 1
    accepted_response = client.post("/api/webhook", json=signal)
    assert accepted_response.status_code == 200
    assert accepted_response.json()["results"][0]["status"] == "SIMULATED"
    assert accepted_response.json()["results"][0]["replications"][0]["mode"] == "SIMULATED"
    assert account.orders_today == 1
    with sqlite3.connect(main.bot_manager.database_path) as connection:
        assert connection.execute(
            "SELECT status FROM operations WHERE idempotency_key = 'duplicate-signal-1:simulation-bot'"
        ).fetchone()[0] == "RISK_REJECTED"


def test_fastapi_emergency_stop_is_explicitly_simulated(client, monkeypatch):
    login = client.post("/api/auth/login", json={
        "username": TEST_USERNAME,
        "password": TEST_PASSWORD,
    })
    headers = {"Authorization": "Bearer " + login.json()["token"]}
    bot = TradingBot(
        bot_id="kill-switch-bot",
        name="Kill switch test",
        strategy=get_strategy("ICTStrategy"),
    )
    main.bot_manager.bots = {bot.bot_id: bot}

    response = client.post("/api/emergency/stop-all", headers=headers)
    assert response.status_code == 200
    assert response.json()["mode"] == "SIMULATED"
    assert response.json()["bots_paused"] == 1
    assert bot.status == "PAUSED"

    monkeypatch.setattr(main.bot_manager, "webhook_token", "test-webhook-token")
    ignored_signal = client.post("/api/webhook", json={
        "token": "test-webhook-token",
        "bot_id": "kill-switch-bot",
        "action": "BUY",
        "price": 100.0,
    })
    assert ignored_signal.status_code == 200
    assert ignored_signal.json()["results"][0]["status"] == "IGNORED"


def test_configuration_secrets_and_proxy_credentials_are_not_persisted(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps({
        "auth": {
            "username": "legacy-config-user",
            "password": "legacy-config-password",
            "session_token": "legacy-session-token",
        },
        "server": {"webhook_token": "legacy-webhook-token"},
        "identities": [],
        "bots": [{
            "id": "security-test-bot",
            "name": "Security test bot",
            "strategy": "ICTStrategy",
            "proxy_url": "socks5://proxy-user:proxy-password@proxy.example:1080",
            "accounts": [{
                "id": "security-test-account",
                "custom_name": "Test account",
                "username": "broker-login",
                "password": "broker-password",
            }],
        }],
    }), encoding="utf-8")

    monkeypatch.setenv("BOT_VPN_AUTH_USERNAME", "environment-user")
    monkeypatch.setenv("BOT_VPN_AUTH_PASSWORD", "environment-password")
    monkeypatch.setenv("BOT_VPN_WEBHOOK_TOKEN", "environment-webhook-token")
    manager = BotManager(str(config_path), str(tmp_path / "import.sqlite3"))
    manager.load_config()

    assert manager.auth["username"] == "environment-user"
    assert manager.auth["password"] == "environment-password"
    assert manager.webhook_token == "environment-webhook-token"
    bot = manager.bots["security-test-bot"]
    assert bot.to_dict()["proxy_url"] == "socks5://proxy.example:1080"
    assert bot.to_dict()["accounts"][0]["username"] == "••••"

    manager.save_config()
    saved_text = json.dumps({
        "settings": [dict(row) for row in manager._store.connection.execute("SELECT * FROM app_settings")],
        "identities": [dict(row) for row in manager._store.connection.execute("SELECT * FROM identities")],
        "bots": [dict(row) for row in manager._store.connection.execute("SELECT * FROM bots")],
        "accounts": [dict(row) for row in manager._store.connection.execute("SELECT * FROM accounts")],
    }, ensure_ascii=False)
    for secret in (
        "legacy-config-user",
        "legacy-config-password",
        "legacy-session-token",
        "legacy-webhook-token",
        "proxy-user",
        "proxy-password",
        "broker-login",
        "broker-password",
        "environment-password",
        "environment-webhook-token",
    ):
        assert secret not in saved_text
    manager.close_storage()


def test_proxy_health_is_not_fabricated_and_invalid_proxy_fails_closed():
    connector = ProxyConnector()
    ping, _ = asyncio.run(connector.check_ping_and_ip())
    assert ping == 0
    assert connector.is_healthy is False

    invalid_connector = ProxyConnector("http://proxy.example:8080")
    with pytest.raises(RuntimeError, match="bloquea la conexión directa"):
        asyncio.run(invalid_connector.get_session())
