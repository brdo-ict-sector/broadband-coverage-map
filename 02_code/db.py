"""Database helpers: a SQLAlchemy engine and an ogr2ogr PG connection string,
both derived from config.DATABASE_URL so there is a single source of truth.
"""
from __future__ import annotations

from urllib.parse import urlparse

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

import config


def engine() -> Engine:
    """SQLAlchemy engine using the psycopg (v3) driver."""
    url = config.DATABASE_URL
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return create_engine(url, future=True)


def ogr_pg_string() -> str:
    """Translate DATABASE_URL into the 'PG:...' string ogr2ogr expects."""
    p = urlparse(config.DATABASE_URL)
    parts = [f"dbname={p.path.lstrip('/')}"]
    if p.hostname:
        parts.append(f"host={p.hostname}")
    if p.port:
        parts.append(f"port={p.port}")
    if p.username:
        parts.append(f"user={p.username}")
    if p.password:
        parts.append(f"password={p.password}")
    return "PG:" + " ".join(parts)


def run(sql: str, **params):
    """Execute a single statement in its own transaction."""
    with engine().begin() as conn:
        return conn.execute(text(sql), params)
