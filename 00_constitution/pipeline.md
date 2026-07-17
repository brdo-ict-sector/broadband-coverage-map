# Pipeline — what's built so far

> Status: Draft v2 · Last updated: 2026-07-17
> Scope: Phase 0 (ingestion) + Phase 1 (establishment↔building matching) of
> `roadmap.md`, for the **social-facilities catalog**. Code in `../02_code`.

This is a snapshot of the data workflow that has actually been implemented and
run, not the target architecture (that's in `tech-stack.md`).

## Workflow

```mermaid
flowchart TB
    classDef done    fill:#d4edda,stroke:#28a745,color:#155724;
    classDef partial fill:#fff3cd,stroke:#e0a800,color:#856404;
    classDef pending fill:#e2e3e5,stroke:#6c757d,color:#383d41;

    subgraph SRC["Raw sources (WGS84 / EPSG:4326)"]
        direction TB
        SHP["EDESSB/EDRA shapefiles<br/>buildings · streets · city · community"]:::done
        XLSX["Social facilities + internet spending<br/>social_facilities_spending - 2026-07-16.xlsx · 64,864 rows"]:::done
    end

    subgraph P0["Phase 0 · Ingestion — 01_data_ingestion.py"]
        direction TB
        VAL["validate shapefile sets<br/>(.shp/.shx/.dbf/.prj)"]:::done
        OGR["ogr2ogr → PostGIS (COPY)<br/>PROMOTE_TO_MULTI · GIST · skipfailures retry"]:::done
        PAN["pandas/openpyxl → facilities + payments<br/>coords-only · dedup · explode '; '-joined providers"]:::done
        ANA["ANALYZE (planner stats)"]:::done
    end

    subgraph PG["PostGIS — system of record (~6 GB)"]
        direction TB
        BP["build_polygon · 9,894,318"]:::done
        BM["build_multipolygon · 3,328,791"]:::done
        BPT["build_point · 784,962"]:::done
        COM["community · 1,471"]:::done
        FAC["facilities · 17,827 (unique, valid coords)"]:::done
        PAY["facility_payments · 2,343 per-provider records"]:::done
        CITY["city · truncated-UTF-8 records"]:::partial
        STR["street_linestring / multilinestring"]:::pending
    end

    subgraph P1["Phase 1 · Matching — 02_matching.py"]
        direction TB
        CON["containment pass (LATERAL + GIST)<br/>point inside polygon → high"]:::done
        NEAR["nearest-centroid fallback (≤ 100 m)<br/>→ medium"]:::done
    end

    MATCH["match_facility_building<br/>build_id · katottg · addr_num · distance_m · confidence"]:::done
    REP["03_match_report.py → output/match_report.csv"]:::done

    SHP --> VAL --> OGR --> BP & BM & BPT & COM
    OGR -. one bad layer doesn't stop run .-> CITY & STR
    XLSX --> PAN --> FAC & PAY
    OGR --> ANA
    PAN --> ANA
    FAC --> CON
    BP --> CON
    CON --> MATCH
    FAC --> NEAR
    BP --> NEAR
    NEAR --> MATCH
    MATCH --> REP
```

**Legend:** 🟩 done & loaded · 🟨 partial / known issue · ⬜ pending (not on the
MVP matching path).

## Source data (since 2026-07-17)

`social_facilities_spending - 2026-07-16.xlsx` replaces the NSZU hospital list:
64,864 rows across 4 domains (культура 28,218 · освіта 18,671 · медицина
12,818 · адмінпослуги 5,157) joined with internet-access spending records.
Ingestion keeps only rows with coordinates (17,945 — currently медицина +
адмінпослуги; освіта/культура have none yet), drops 3 rows with
outside-Ukraine coordinates, deduplicates to **17,827 unique facilities** (key:
name+edrpou+settlement+str_address), and splits spending into
`facility_payments`, **exploding** '; '-joined multi-provider cells into 2,343
one-row-per-provider records. ФОП providers carry a privacy-masked ЄДРПОУ
(`xxxxxxxxxx`) — the app identifies them by name.

## Phase 1 result (current catalog)

**Rule (2026-07-17): `high` = point inside a building polygon; `medium` =
nearest building whose polygon centroid is ≤ 100 m away.**

| Match type | Confidence | Count | Avg dist |
| --- | --- | --- | --- |
| contained (point inside polygon) | high | 3,888 | 0 m |
| nearest centroid ≤ 100 m | medium | 8,645 | 36.6 m |
| **Matched** | | **12,533 (70.3%)** | |
| **Unmatched** | | **5,294 (29.7%)** | |

Of 17,827 facilities with valid coordinates. Unmatched facilities are still
shown on the map, flagged "без прив'язки". The 29.7% unmatched is likely a mix
of rural addresses with no mapped footprint in the **addressed**
`build_polygon` layer and approximate coordinates. Candidate improvements: add
the Microsoft-footprint layer (`build_multipolygon`, 3.3M) as a fallback
target, and analyze the unmatched set by region / coordinate source.

## Environment (local, verified working)

```mermaid
flowchart LR
    classDef done fill:#d4edda,stroke:#28a745,color:#155724;
    PY["Python (miniconda)<br/>pandas · SQLAlchemy · psycopg"]:::done
    GDAL["GDAL 3.9.2 ogr2ogr<br/>+ libgdal-pg plugin"]:::done
    DOCK["Docker · postgis/postgis:16-3.4"]:::done
    PY --> DOCK
    GDAL --> DOCK
```

- The conda GDAL ships the live **PostgreSQL** driver as a separate
  `libgdal-pg` plugin off GDAL's default path; it's wired via `GDAL_DRIVER_PATH`
  (auto-detected in `config.py`).
- Encoding verified: Ukrainian Cyrillic reads cleanly as UTF-8 from the `.cpg`.

## Known issues / not yet done

| Item | State | Note |
| --- | --- | --- |
| `city` layer | partial | Many `city_name` values are truncated at the DBF field width, cutting Cyrillic mid-character → invalid trailing UTF-8. Not on the MVP path; needs a repair/recode step before loading. |
| `street_*` layers | pending | Load the same way; not required for hospital matching. |
| Match-rate thresholds | open | Confidence cutoffs (50 m / 25 m) are provisional; tune after reviewing `match_report.csv`. |
| Run end-to-end as one script | pending | Ingestion now continues past bad layers and ANALYZEs; a single `make`/runner can chain 01→02→03. |

## Run order

```
docker compose up -d          # PostGIS
python 01_data_ingestion.py   # sources → PostGIS (+ validate, ANALYZE)
python 02_matching.py         # facilities → buildings → match_facility_building
python 03_match_report.py     # quality metrics → output/match_report.csv
```

When only the facilities xlsx changed (buildings already loaded), skip the
shapefile reload:

```
python -c "import importlib; m = importlib.import_module('01_data_ingestion'); m.ingest_facilities(); m.analyze_tables()"
python 02_matching.py
```

## Bridge to the serving app (Phase 2)

The ~6 GB ETL DB above stays offline. The deployed app (`../02_code/app/`) runs
on a **lean serving DB** built from four tables:

```
bash scripts/export_serving_tables.sh   # facilities + facility_payments
                                         #  + match_facility_building + community
                                         #  →  app/serving-data/serving.sql (~63 MB)
cd app && cp .env.example .env && docker compose up -d --build
```

The dump restores **only on first DB init** — after re-exporting, recreate the
app DB volume (`docker compose down && docker volume rm
broadband-app_app_pgdata && docker compose up -d`).

The app's PostGIS container restores that dump on first init; FastAPI serves it
read-only behind Caddy. Architecture/decisions are in `tech-stack.md` §7; the
run/deploy runbook is in `../02_code/app/README.md`. Optional one-time building
PMTiles: `scripts/build_building_tiles.sh`.
