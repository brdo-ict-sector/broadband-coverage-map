#!/usr/bin/env bash
# Export ONLY the lean serving tables from the heavy ETL database into a single
# SQL dump that the app's postgis container restores on first init.
#
# Why: the ETL DB is ~6 GB (9.9M buildings). The running app never needs that —
# buildings are static PMTiles. The API only reads facilities +
# match_facility_building + community (a few hundred MB), so that is all the VPS
# ever has to carry.
#
# Run from 02_code/ with the ETL stack (broadband_postgis) up:
#     bash scripts/export_serving_tables.sh
#
# Produces: 02_code/app/serving-data/serving.sql  (git-ignored; ship to the VPS)
set -euo pipefail

ETL_CONTAINER="${ETL_CONTAINER:-broadband_postgis}"
ETL_DB="${ETL_DB:-broadband}"
ETL_USER="${ETL_USER:-gis}"

OUT_DIR="$(dirname "$0")/../app/serving-data"
OUT_FILE="${OUT_DIR}/serving.sql"
mkdir -p "${OUT_DIR}"

echo "Dumping serving tables from ${ETL_CONTAINER}/${ETL_DB} ..."
# --no-owner / --no-privileges: the serving DB uses its own role.
# PostGIS itself is provided by the app image, so we do NOT dump the extension
# or spatial_ref_sys — only our three tables (with their indexes/constraints).
docker exec "${ETL_CONTAINER}" pg_dump \
    -U "${ETL_USER}" -d "${ETL_DB}" \
    --no-owner --no-privileges \
    -t facilities \
    -t match_facility_building \
    -t community \
    > "${OUT_FILE}"

bytes=$(wc -c < "${OUT_FILE}")
echo "Wrote ${OUT_FILE} (${bytes} bytes)."
echo "On first 'docker compose up' the app DB restores this automatically."
