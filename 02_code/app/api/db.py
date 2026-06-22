"""A single SQLAlchemy engine for the serving API, derived from DATABASE_URL."""
from __future__ import annotations

from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

import config


@lru_cache(maxsize=1)
def engine() -> Engine:
    """Process-wide engine using the psycopg (v3) driver, with pre-ping so a
    recycled / dropped connection is detected instead of erroring a request."""
    url = config.DATABASE_URL
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return create_engine(url, future=True, pool_pre_ping=True)
