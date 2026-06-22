#!/usr/bin/env bash
# ONE-TIME, HEAVY: build the building basemap as a single PMTiles archive from
# the ETL PostGIS DB. Done on your workstation (not the VPS) — the VPS only ever
# serves the resulting static file via Caddy at /tiles.
#
# The app runs fine WITHOUT this (it falls back to the OSM raster basemap); add
# the building tiles when you want our own rendered footprints.
#
# Requires:
#   * ogr2ogr with the live PostgreSQL driver (the same conda setup the ETL uses;
#     see memory/dev-environment — GDAL_DRIVER_PATH for libgdal-pg).
#   * Docker (for tippecanoe; there is no native Windows build).
#
# Run from 02_code/ with the ETL DB up:
#     bash scripts/build_building_tiles.sh
set -euo pipefail

PG="${PG:-PG:dbname=broadband host=localhost port=5432 user=gis password=gis}"
WORK="$(dirname "$0")/../app/tiles"
mkdir -p "${WORK}"
FGB="${WORK}/buildings.fgb"
OUT="${WORK}/buildings.pmtiles"

echo "1/2  Exporting build_polygon -> FlatGeobuf (compact intermediate) ..."
# Keep only the columns worth carrying into tiles. FlatGeobuf stays small and
# tippecanoe reads it directly, so we avoid a multi-GB GeoJSON intermediate.
ogr2ogr -f FlatGeobuf "${FGB}" "${PG}" \
    -sql "SELECT build_id, katottg, addr_num, geom FROM build_polygon"

echo "2/2  Tiling -> PMTiles with tippecanoe (this is the slow part) ..."
# -Z10..z16: buildings only matter when zoomed in; --drop-densest-as-needed and
# --coalesce keep dense cities under the per-tile size budget.
docker run --rm -v "$(cd "${WORK}" && pwd)":/data ghcr.io/felt/tippecanoe:latest \
    tippecanoe -o /data/buildings.pmtiles -l buildings \
    -Z10 -z16 \
    --drop-densest-as-needed --extend-zooms-if-still-dropping --coalesce \
    --force /data/buildings.fgb

rm -f "${FGB}"
echo "Done -> ${OUT}"
echo "Caddy already serves it at /tiles/buildings.pmtiles. Wire it into the map:"
echo "  see app/frontend — add the pmtiles:// protocol and a 'building' layer."
