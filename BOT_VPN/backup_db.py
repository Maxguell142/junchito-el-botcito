"""Create, restore to a new path, and verify SQLite database copies."""

from __future__ import annotations

import argparse
from contextlib import closing
import os
import sqlite3
from pathlib import Path
from typing import Optional


DEFAULT_DATABASE = Path(__file__).resolve().parent / "bot_vpn.sqlite3"
REQUIRED_TABLES = {
    "app_state",
    "app_settings",
    "identities",
    "bots",
    "accounts",
    "audit_events",
    "operations",
    "schema_migrations",
}


def verify_database(database_path: str | Path) -> None:
    path = Path(database_path).resolve()
    uri = f"file:{path.as_posix()}?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if result is None or result[0] != "ok":
            raise sqlite3.DatabaseError(f"Fallo de integridad SQLite: {result[0] if result else 'sin resultado'}")
        found_tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        missing = REQUIRED_TABLES - found_tables
        if missing:
            raise sqlite3.DatabaseError(f"Faltan tablas requeridas: {', '.join(sorted(missing))}")


def copy_database(source_path: str | Path, destination_path: str | Path) -> Path:
    source = Path(source_path).resolve()
    destination = Path(destination_path).resolve()
    if source == destination:
        raise ValueError("El origen y el destino deben ser rutas distintas.")
    if destination.exists():
        raise FileExistsError(f"El destino ya existe: {destination}")
    verify_database(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(source)) as source_connection:
        with closing(sqlite3.connect(destination)) as destination_connection:
            source_connection.backup(destination_connection)
    verify_database(destination)
    return destination


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Copia y verifica la base SQLite local.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    backup_parser = subparsers.add_parser("backup", help="Crear una copia consistente.")
    backup_parser.add_argument("destination")
    backup_parser.add_argument("--source", default=os.environ.get("BOT_VPN_DB_PATH", str(DEFAULT_DATABASE)))
    restore_parser = subparsers.add_parser("restore", help="Restaurar a una ruta nueva, sin sobrescribir.")
    restore_parser.add_argument("backup")
    restore_parser.add_argument("destination")
    verify_parser = subparsers.add_parser("verify", help="Comprobar integridad y esquema.")
    verify_parser.add_argument("database", nargs="?", default=os.environ.get("BOT_VPN_DB_PATH", str(DEFAULT_DATABASE)))
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "backup":
        result = copy_database(args.source, args.destination)
        print(f"Copia SQLite verificada: {result}")
    elif args.command == "restore":
        result = copy_database(args.backup, args.destination)
        print(f"Restauración a nueva ruta verificada: {result}")
    else:
        verify_database(args.database)
        print(f"Base SQLite íntegra: {Path(args.database).resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
