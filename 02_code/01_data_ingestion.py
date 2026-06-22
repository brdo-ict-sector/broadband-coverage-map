"""01 - Data ingestion.

Load the raw EDRA/EDESSB shapefiles and the NSZU establishment list into PostGIS.

    python 01_data_ingestion.py

Prerequisites:
  * PostGIS reachable via DATABASE_URL (see docker-compose.yml / .env.example)
  * GDAL/ogr2ogr on PATH (system dependency; install via conda or OSGeo4W)

Shapefile completeness is validated first; incomplete layers are SKIPPED with a
clear message instead of failing the whole run. See README "Known data issues".
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pandas as pd
from sqlalchemy import text

import config
from db import engine, ogr_pg_string

SIDECARS = (".shp", ".shx", ".dbf", ".prj")


def enable_postgis() -> None:
    with engine().begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
    print("PostGIS extension ready.")


def validate_shapefile(shp: Path) -> list[str]:
    """Return a list of problems for a shapefile; empty list means OK."""
    if not shp.exists():
        return [f"missing geometry file {shp.name}"]
    return [
        f"missing sidecar {shp.with_suffix(ext).name}"
        for ext in SIDECARS
        if not shp.with_suffix(ext).exists()
    ]


def _ogr_env() -> dict:
    env = os.environ.copy()
    if config.GDAL_DRIVER_PATH:
        env["GDAL_DRIVER_PATH"] = config.GDAL_DRIVER_PATH
    return env


def load_shapefile(shp: Path, table: str, skipfailures: bool = False) -> None:
    cmd = [
        "ogr2ogr", "-f", "PostgreSQL", ogr_pg_string(), str(shp),
        "-nln", table,
        "-nlt", "PROMOTE_TO_MULTI",
        "-lco", "GEOMETRY_NAME=geom",
        "-lco", "FID=gid",
        "-lco", "SPATIAL_INDEX=GIST",
        "-t_srs", f"EPSG:{config.SRID}",
        "-overwrite",
        "--config", "PG_USE_COPY", "YES",
    ]
    if skipfailures:
        cmd.append("-skipfailures")
    if config.SHAPE_ENCODING:
        cmd += ["--config", "SHAPE_ENCODING", config.SHAPE_ENCODING]
    subprocess.run(cmd, check=True, env=_ogr_env())


def ingest_shapefiles() -> None:
    print("\n== Shapefiles ==")
    blocked: dict[str, list[str]] = {}
    for fname, table in config.SHAPEFILE_LAYERS.items():
        shp = config.RAW_DIR / fname
        problems = validate_shapefile(shp)
        if problems:
            blocked[fname] = problems
            print(f"  SKIP {fname}: {'; '.join(problems)}")
            continue
        print(f"  loading {shp.name} -> {table} ...")
        try:
            load_shapefile(shp, table)
        except subprocess.CalledProcessError:
            # A single bad feature (e.g. a record with non-UTF-8 bytes) makes
            # ogr2ogr abort the layer. Retry skipping bad features so one record
            # can't block the layer or the rest of the run.
            print(f"    retrying {fname} with -skipfailures (bad feature[s]) ...")
            try:
                load_shapefile(shp, table, skipfailures=True)
            except subprocess.CalledProcessError as exc:
                blocked[fname] = [f"ogr2ogr failed: {exc}"]
                print(f"    FAILED {fname}: {exc}")
    if blocked:
        print("\n!! Layers with problems (see 'Known data issues' in README):")
        for fname, problems in blocked.items():
            print(f"   - {fname}: {'; '.join(problems)}")


def ingest_facilities() -> None:
    print("\n== Facilities (NSZU) ==")
    df = pd.read_excel(config.FACILITIES_XLSX, dtype=str)
    df.columns = [c.strip().lower() for c in df.columns]

    lat, lng = config.FACILITIES_LAT_COL, config.FACILITIES_LNG_COL
    df[lat] = pd.to_numeric(df[lat], errors="coerce")
    df[lng] = pd.to_numeric(df[lng], errors="coerce")

    before = len(df)
    df = df.dropna(subset=[lat, lng])
    print(f"  {len(df)}/{before} rows have valid coordinates")

    eng = engine()
    df.to_sql(
        config.FACILITIES_TABLE, eng,
        if_exists="replace", index=True, index_label="facility_id",
    )
    with eng.begin() as conn:
        conn.execute(text(
            f"ALTER TABLE {config.FACILITIES_TABLE} "
            f"ADD COLUMN IF NOT EXISTS geom geometry(Point, {config.SRID});"
        ))
        conn.execute(text(
            f"UPDATE {config.FACILITIES_TABLE} "
            f"SET geom = ST_SetSRID(ST_MakePoint({lng}, {lat}), {config.SRID});"
        ))
        conn.execute(text(
            f"CREATE INDEX IF NOT EXISTS {config.FACILITIES_TABLE}_geom_idx "
            f"ON {config.FACILITIES_TABLE} USING GIST (geom);"
        ))
    print(f"  loaded -> {config.FACILITIES_TABLE} (+ geom, GIST index)")


def analyze_tables() -> None:
    # Bulk-loaded tables have no planner statistics until analyzed; without this
    # the spatial-match queries get catastrophic plans (full scans of the 9.9M
    # building layer instead of GIST lookups).
    print("\n== ANALYZE (planner statistics) ==")
    with engine().begin() as conn:
        conn.execute(text("ANALYZE;"))
    print("  done")


def main() -> None:
    enable_postgis()
    ingest_shapefiles()
    ingest_facilities()
    analyze_tables()
    print("\nIngestion complete.")


if __name__ == "__main__":
    main()
