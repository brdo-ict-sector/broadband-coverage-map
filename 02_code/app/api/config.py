"""Runtime configuration for the serving API.

Everything is read from the environment so the SAME image runs locally and on
the VPS with only the .env file changing. See app/.env.example.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

# The lean serving database (facilities, match_facility_building, community).
# NOT the 6 GB ETL database — see scripts/export_serving_tables.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://gis:gis@localhost:5432/broadband",
)

# Comma-separated list of allowed browser origins for CORS. The Vite dev server
# runs on 5173; in production the frontend is same-origin behind Caddy so this
# can stay narrow.
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]

SRID = 4326

# MVP shows only accepted matches (see roadmap Phase 1).
ACCEPTED_CONFIDENCE = ("high", "medium")
