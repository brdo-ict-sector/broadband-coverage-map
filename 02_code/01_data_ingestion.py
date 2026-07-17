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


# One source row = one facility observation, possibly with internet-access
# payments attached. Facilities can repeat (one row per payment), and a single
# payment cell can aggregate SEVERAL providers as '; '-joined lists
# (recipt_edrpou / recipt_name / amount align segment by segment). The load
# splits the sheet into a deduplicated facilities table and an exploded
# one-row-per-provider payments table keyed by facility_id.
PAYMENT_COLS = [
    "payer_name", "trans_date", "currency",
    "recipt_edrpou", "recipt_name", "amount",
]
FACILITY_KEY_COLS = ["name", "edrpou", "settlement", "str_address"]


def _split_multi(value) -> list[str]:
    if pd.isna(value):
        return []
    return [s.strip() for s in str(value).split(";") if s.strip()]


def _pick(parts: list[str], i: int, n: int, raw):
    """Segment i of an n-provider cell: aligned lists give one value per
    segment, a single value applies to all, anything else (unaligned — happens
    for trans_date) is kept verbatim on every exploded row."""
    if not parts:
        return None
    if len(parts) == n:
        return parts[i]
    if len(parts) == 1:
        return parts[0]
    return str(raw)


def _explode_payments(src: pd.DataFrame, facility_ids: "pd.Series") -> pd.DataFrame:
    rows = []
    for idx, rec in src.iterrows():
        edrpous = _split_multi(rec["recipt_edrpou"])
        names = _split_multi(rec["recipt_name"])
        amounts = _split_multi(rec["amount"])
        dates = _split_multi(rec["trans_date"])
        n = max(len(edrpous), 1)
        for i in range(n):
            rows.append({
                "facility_id": facility_ids[idx],
                "payer_name": None if pd.isna(rec["payer_name"]) else rec["payer_name"],
                "trans_date": _pick(dates, i, n, rec["trans_date"]),
                "currency": None if pd.isna(rec["currency"]) else rec["currency"],
                "recipt_edrpou": _pick(edrpous, i, n, rec["recipt_edrpou"]),
                "recipt_name": _pick(names, i, n, rec["recipt_name"]),
                "amount": _pick(amounts, i, n, rec["amount"]),
            })
    return pd.DataFrame(rows)


def ingest_facilities() -> None:
    print("\n== Facilities (social facilities + internet spending) ==")
    df = pd.read_excel(config.FACILITIES_XLSX, dtype=str)
    df.columns = [c.strip().lower() for c in df.columns]

    lat, lng = config.FACILITIES_LAT_COL, config.FACILITIES_LNG_COL
    df[lat] = pd.to_numeric(df[lat], errors="coerce")
    df[lng] = pd.to_numeric(df[lng], errors="coerce")

    before = len(df)
    df = df.dropna(subset=[lat, lng])
    print(f"  {len(df)}/{before} rows have coordinates")

    minx, miny, maxx, maxy = config.UKRAINE_BBOX
    in_ua = df[lng].between(minx, maxx) & df[lat].between(miny, maxy)
    if (~in_ua).any():
        print(f"  dropping {(~in_ua).sum()} row(s) with coordinates outside Ukraine")
        df = df[in_ua]

    # Deduplicate: one facility row per key, payments split off separately.
    key = df[FACILITY_KEY_COLS].fillna("").agg("|".join, axis=1)
    fac = (
        df.loc[~key.duplicated()]
        .drop(columns=PAYMENT_COLS)
        .reset_index(drop=True)
    )
    key_to_id = {k: i for i, k in enumerate(key.loc[~key.duplicated()])}

    pay_src = df.loc[df[PAYMENT_COLS].notna().any(axis=1), PAYMENT_COLS]
    pay = _explode_payments(pay_src, key.loc[pay_src.index].map(key_to_id))
    print(
        f"  {len(fac)} unique facilities, {len(pay_src)} payment rows "
        f"-> {len(pay)} per-provider payment records"
    )

    eng = engine()
    fac.to_sql(
        config.FACILITIES_TABLE, eng,
        if_exists="replace", index=True, index_label="facility_id",
    )
    pay.to_sql(config.PAYMENTS_TABLE, eng, if_exists="replace", index=False)
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
        conn.execute(text(
            f"CREATE INDEX IF NOT EXISTS {config.PAYMENTS_TABLE}_facility_idx "
            f"ON {config.PAYMENTS_TABLE} (facility_id);"
        ))
    print(
        f"  loaded -> {config.FACILITIES_TABLE} (+ geom, GIST index), "
        f"{config.PAYMENTS_TABLE}"
    )


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
