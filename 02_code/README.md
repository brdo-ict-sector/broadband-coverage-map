# 02_code — Data pipeline

Python pipeline for **Phase 0–1** of the roadmap: ingest the raw geospatial data
into PostGIS and attribute (match) each social establishment to a building
footprint. Stack rationale lives in `../00_constitution/tech-stack.md`.

## Layout

| File | Purpose |
| --- | --- |
| `config.py` | Paths, DB connection, layer→table registry, match threshold |
| `db.py` | SQLAlchemy engine + ogr2ogr connection-string helpers |
| `01_data_ingestion.py` | Load shapefiles (ogr2ogr) and the social-facilities xlsx into PostGIS (`facilities` + `facility_payments`) |
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

When only the facilities xlsx changed (buildings already loaded), skip the
heavy shapefile reload:

```bash
python -c "import importlib; m = importlib.import_module('01_data_ingestion'); m.ingest_facilities(); m.analyze_tables()"
python 02_matching.py
```

## Source data (facilities)

`../01_data_sources/01_prep_data/social_facilities_spending - 2026-07-16.xlsx`
— social facilities across 4 domains joined with internet-access spending
records. Ingestion keeps only rows with valid in-Ukraine coordinates,
deduplicates facilities (one row per payment in the source), and **explodes**
'; '-joined multi-provider payment cells into a one-row-per-provider
`facility_payments` table. ФОП providers have a privacy-masked ЄДРПОУ
(`xxxxxxxxxx`).

## Matching approach

Purely spatial — **no KOATUU↔KATOTTG crosswalk required**:

1. **Containment** — facility point inside an addressed building polygon → `high`.
2. **Nearest-centroid fallback** — else the nearest building whose polygon
   **centroid** is within `CENTROID_THRESHOLD_M` (100 m) → `medium`.

Output table `match_facility_building` carries `build_id`, `katottg`, `addr_num`,
`distance_m` (to the centroid), and a `confidence` flag — one row per matched
facility. Unmatched facilities still appear in the app, flagged "без прив'язки".

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

The pipeline has been run end-to-end (last full run 2026-07-17: 17,827
facilities, 12,533 matched — see `../00_constitution/pipeline.md` for the
current numbers). The serving app that consumes its output lives in `app/`.
