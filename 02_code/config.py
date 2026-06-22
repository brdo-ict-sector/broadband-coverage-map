"""Central configuration for the broadband-coverage-map data pipeline.

Paths are derived from the repository root so scripts run from anywhere.
The database connection is read from the DATABASE_URL environment variable
(see .env.example); a local Docker default is used as a fallback.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# --- paths -------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "01_data_sources"
RAW_DIR = DATA_DIR / "00_raw_data" / "edra-mdkb-edessb"
PREP_DIR = DATA_DIR / "01_prep_data"
OUTPUT_DIR = REPO_ROOT / "02_code" / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# --- database ----------------------------------------------------------------
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://gis:gis@localhost:5432/broadband",
)
SRID = 4326

# Shapefile character encoding. ogr2ogr reads the .cpg sidecar automatically;
# override here only if a .cpg is missing/wrong (EDRA exports are often CP1251).
SHAPE_ENCODING = os.getenv("SHAPE_ENCODING", "")  # "" = trust the .cpg

# GDAL plugin path. On conda-forge the live PostgreSQL driver ships as a
# separate plugin (libgdal-pg) that is not always on GDAL's default search
# path, so ogr2ogr can't write to PostGIS until it's pointed here. Defaults to
# the conda layout next to the running interpreter; override via env if needed.
_default_gdal_plugins = (
    Path(sys.executable).resolve().parent / "Library" / "lib" / "gdalplugins"
)
GDAL_DRIVER_PATH = os.getenv(
    "GDAL_DRIVER_PATH",
    str(_default_gdal_plugins) if _default_gdal_plugins.exists() else "",
)

# --- source spatial layers -> PostGIS tables ---------------------------------
# Each entry needs a complete shapefile (.shp/.shx/.dbf/.prj); ingestion
# validates this and skips incomplete layers with a clear message.
SHAPEFILE_LAYERS = {
    "2026_05_25_build_Polygon.shp": "build_polygon",            # addressed footprints (~9.9M)
    "2026_05_25_build_MultiPolygon.shp": "build_multipolygon",  # Microsoft footprints (~3.3M)
    "2026_05_25_build_Point.shp": "build_point",                # address points (~785k)
    "2026_05_25_city.shp": "city",
    "2026_05_25_community.shp": "community",
    "2026_05_25_street_LineString.shp": "street_linestring",
    "2026_05_25_street_MultiLineString.shp": "street_multilinestring",
}

# --- social establishments (NSZU; MVP = hospitals) ---------------------------
FACILITIES_XLSX = PREP_DIR / "nszu - 2026-05-01.xlsx"
FACILITIES_TABLE = "facilities"
FACILITIES_LAT_COL = "lat"
FACILITIES_LNG_COL = "lng"

# --- matching ----------------------------------------------------------------
BUILDINGS_MATCH_TABLE = "build_polygon"   # primary target (addressed footprints)
MATCH_OUTPUT_TABLE = "match_facility_building"
# MVP accepts only 'high' (point contained by a building) and 'medium' (nearest
# building <= 25 m). The looser 25-50 m 'low' band is excluded, so the accept
# cap is 25 m. Widen NEAREST_THRESHOLD_M later for diagnostics on the unmatched.
NEAREST_THRESHOLD_M = 25   # max distance (m) for an accepted nearest match
HIGH_CONF_NEAREST_M = 25   # nearest within this => 'medium' (equals the cap for MVP)
