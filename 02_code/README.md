# 02_code — Data pipeline

Python pipeline for **Phase 0–1** of the roadmap: ingest the raw geospatial data
into PostGIS and attribute (match) each social establishment to a building
footprint. Stack rationale lives in `../00_constitution/tech-stack.md`.

## Layout

| File | Purpose |
| --- | --- |
| `config.py` | Paths, DB connection, layer→table registry, match thresholds |
| `db.py` | SQLAlchemy engine + ogr2ogr connection-string helpers |
| `01_data_ingestion.py` | Load shapefiles (ogr2ogr) and NSZU xlsx into PostGIS |
| `02_matching.py` | Spatial match: facilities → building polygons |
| `03_match_report.py` | Match-quality metrics + CSV export |
| `docker-compose.yml` | Local PostGIS instance |

Scripts are numbered to indicate **run order** and are executed directly
(`python 01_data_ingestion.py`), not imported. Shared logic lives in the
importable modules `config.py` and `db.py`.

## Prerequisites

1. **PostGIS** — `docker compose up -d` (starts Postgres 16 + PostGIS 3.4).
2. **GDAL / ogr2ogr** on PATH — system dependency used for the bulk shapefile
   load (far faster than Python for the multi-GB layers). Install via conda
   (`conda install -c conda-forge gdal`) or OSGeo4W.
3. **Python deps** — `pip install -r requirements.txt`.
4. Copy `.env.example` → `.env` and adjust `DATABASE_URL` if needed.

## Run

```bash
docker compose up -d
python 01_data_ingestion.py
python 02_matching.py
python 03_match_report.py
```

## Matching approach

Purely spatial — **no KOATUU↔KATOTTG crosswalk required**:

1. **Containment** — facility point inside an addressed building polygon → `high`.
2. **Nearest fallback** — else the nearest building within
   `NEAREST_THRESHOLD_M` (default 50 m); `≤ HIGH_CONF_NEAREST_M` (25 m) →
   `medium`, otherwise `low`.

Output table `match_facility_building` carries `build_id`, `katottg`, `addr_num`,
`distance_m`, and a `confidence` flag — one row per matched facility.

## Known data issues (raw shapefiles)

Found during inspection of `01_data_sources/00_raw_data/edra-mdkb-edessb/`.
The ingestion script **validates and skips** incomplete layers rather than
failing; fix these to load them:

1. **`build_Polygon`** — geometry is `…build_Polygon.shp` but the attribute
   table is misnamed `…build_Polygon-002.dbf`. A shapefile needs matching
   basenames. Copy it to `…build_Polygon.dbf` (work on a copy — keep
   `00_raw_data` immutable). **This is the primary matching layer**, so it must
   be fixed before `02_matching.py` is useful.
2. **`build_Point`** — only `.cpg` + `.dbf` present; `.shp/.shx/.prj` missing
   (no geometry). Cannot load until the geometry files are supplied.
3. **`street_MultiLineString`** — `.shp` missing (`.dbf/.shx/.prj/.cpg` present).
   Cannot load until supplied.

> Note: this scaffold has not been executed end-to-end yet (local env lacks
> GDAL/PostGIS). It is ready to run once the prerequisites above are in place.
