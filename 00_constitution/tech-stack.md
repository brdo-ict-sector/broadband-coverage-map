# Tech Stack — Broadband Coverage Map of Ukraine

> Status: Draft v1 · Last updated: 2026-06-22

## Purpose

This document records the foundational technology decisions for the project and,
just as importantly, **why** each was chosen and what was deliberately deferred.
It is part of the project constitution: changes here are architectural decisions,
not casual edits.

Guiding priorities (in the order they drove decisions): **reliability**,
**performance at scale**, **visual quality**, and **low operational complexity**.

## Scale targets

These numbers anchor the decisions below:

- **Concurrent users:** up to ~1,000.
- **Social establishments (full scope):** up to ~80,000.
- **MVP scope:** hospitals only (~12,800 NSZU facility divisions).
- **Building footprints:** ~9.9M addressed polygons (+3.3M Microsoft footprints,
  ~785k points), all WGS84 / EPSG:4326.

## Architecture at a glance

```
                          ┌─────────────────────────────┐
   Raw data (shapefiles,  │   ETL / matching pipeline    │
   NSZU xlsx, registries) │   Python + GDAL + geopandas  │
            ─────────────▶│   (offline, batch)           │
                          └──────────────┬──────────────┘
                                         │ load
                                         ▼
                          ┌─────────────────────────────┐
                          │   PostgreSQL + PostGIS       │  ◀── system of record
                          └───────┬──────────────┬──────┘
                                  │              │
                    build tiles   │              │  runtime queries
                  (tippecanoe)    ▼              ▼
                          ┌──────────────┐  ┌─────────────────┐
                          │  PMTiles on  │  │  FastAPI (Python)│
                          │  CDN/object  │  │  REST/JSON       │
                          │  store       │  │  + GeoJSON       │
                          └──────┬───────┘  └────────┬────────┘
                                 │                   │
                                 ▼                   ▼
                          ┌─────────────────────────────┐
                          │  React + TS + Vite frontend  │
                          │  MapLibre GL JS + deck.gl    │
                          └─────────────────────────────┘
```

**As built (MVP, running locally — see `02_code/app/` + README):** the runtime is
split from the ETL. The heavy ~6 GB ETL/PostGIS DB stays offline on the
workstation; only three small tables (`facilities`, `match_facility_building`,
`community`) are exported into a **lean serving DB** that the app carries. The app
is `docker compose`: serving Postgres+PostGIS · FastAPI · **Caddy** (static
frontend + `/api` reverse-proxy + `/tiles`). The same compose runs locally and on
the VPS. Building PMTiles are static files served by Caddy (CDN deferred). See
§7. The frontend currently uses plain MapLibre (deck.gl reserved — see §6).

## Decisions

### 1. Spatial database — PostgreSQL + PostGIS

**Chosen.** The system of record for all spatial and attribute data.

- Handles the 9.9M-polygon building layer and the spatial join (hospital points
  → building polygons via point-in-polygon + nearest-within-threshold) with
  proper GIST indexing — a naïve in-memory approach would not finish.
- Native home for the hospital↔building matching, KOATUU↔KATOTTG reconciliation,
  and all downstream coverage analytics.
- Mature, fully open-source, no licensing constraints (relevant for a
  public/government system).

### 2. ETL & matching pipeline — Python + GDAL + geopandas

**Chosen.** All offline data processing: ingesting shapefiles and the NSZU xlsx,
loading into PostGIS (`ogr2ogr` / `pyogrio`), and running the
establishment↔building matching.

- Python owns the mature geospatial ecosystem: GDAL/OGR, `shapely`, `geopandas`,
  `GeoAlchemy2`.
- Keeping ETL in Python lets the geospatial domain logic be written **once** and
  reused by the API (see below).

### 3. Backend / query API — Python + FastAPI

**Chosen.** Serves the web app's runtime queries (facility records, coverage
lookups, comparisons) as REST/JSON, and small spatial layers as GeoJSON.

- **Reliability:** shares one language with the ETL, so geospatial logic is not
  duplicated or split across two stacks that must agree. Pydantic gives
  end-to-end validation; OpenAPI docs come for free.
- **Speed:** for geo endpoints the bottleneck is PostGIS, not the API language;
  FastAPI's async stack is comfortably fast at this scale.
- **Trade-off accepted:** two languages in the repo (Python backend + TS
  frontend). Normal for a geospatial app, and worth it to keep all hard
  geospatial work in Python.

### 4. Map rendering — MapLibre GL JS

**Chosen.** Vector-tile map renderer in the browser.

- Fully open-source, no Mapbox token or billing.
- Native vector-tile rendering; pairs cleanly with PMTiles and PostGIS-backed
  tiles.
- **Basemap (as built):** **CARTO Positron** vector style — clean, light, no API
  key — overridable via `VITE_BASEMAP_URL`. Chosen for a modern look that makes
  the coloured facility points pop. Swappable for our own building-PMTiles style
  later. (An OSM raster style was the interim placeholder.)

### 5. Tile serving — PMTiles (static) + GeoJSON-from-API (small/live), Martin reserved

**Chosen: static-first hybrid.** Layers are routed by volatility and size.

| Layer | Volatility | Delivery (MVP) | At full scale |
| --- | --- | --- | --- |
| Buildings (9.9M), borders, streets | ~never | **PMTiles** via `tippecanoe`, served from CDN/object store | unchanged |
| Facilities (hospitals, ~12.8k) | occasional | **GeoJSON from FastAPI** + client-side clustering | **migrate to vector tiles** as catalog grows past ~tens of thousands |
| Coverage / connectivity | changes over time | baked into PMTiles initially | **Martin** (live MVT from PostGIS) if/when large & frequently updated |

Rationale:

- **PMTiles scales for free.** A single static file over HTTP range requests
  from a CDN handles 1,000 concurrent users (and far more) with zero server CPU
  or DB load — the highest-reliability, lowest-cost path for the heavy basemap.
- **GeoJSON-from-API** is the simplest possible delivery for the ~12.8k MVP
  facility points; no tiling pipeline required.
- **Martin is the documented upgrade path**, not an omission. It earns its
  operational complexity only when a layer must be both large *and* live.

**As built (MVP):** facilities ship as a single `/facilities` GeoJSON (7,100
points, ~1.3 MB) drawn as **small unclustered dots** — a product decision so the
country-wide distribution is legible at a glance (clustering hid it). Each point
is tagged server-side with its `community_id` via `ST_Contains`, enabling the
instant client-side community filter. Building PMTiles are built but **not yet
wired into the map**; Caddy serves them from the VPS (CDN deferred).

> ⚠️ **Scaling watch:** an 80k-point GeoJSON (~10–40 MB) is too heavy for a
> single browser source. The facilities layer **must** move to vector tiles
> before the catalog approaches that size. Tracked in `roadmap.md`.

### 6. Frontend — React + TypeScript + Vite, with react-map-gl + deck.gl

**Chosen.**

- **Why React specifically:** `deck.gl` — the best-in-class WebGL layer for
  rendering tens of thousands of points and large building layers beautifully
  and fast (3D extrusions, heatmaps, smooth clustered points) — is React-first
  and overlays MapLibre natively via `react-map-gl`. This single fact serves
  both **performance at scale** (80k+ points) and **visual quality** at once.
- **UI chrome:** Tailwind CSS + a headless/component library (Radix / shadcn) for
  a polished, accessible public-facing UI.
- **State/data:** TanStack Query for server state; lightweight client state
  (Zustand or Context) for map UI.
- Vue 3 and SvelteKit were considered and are capable, but would forfeit the
  deck.gl advantage that this project's scale and visual goals specifically
  reward.

**As built (MVP):** React + TS + Vite with **plain `maplibre-gl`** and hand-written
CSS — deliberately minimal for 7,100 points. `react-map-gl` + **deck.gl**,
Tailwind/shadcn, and TanStack Query are **reserved, not yet adopted**; deck.gl
earns its place once the catalog grows toward tens of thousands of points (Phase
4) where MapLibre circle layers stop being the simplest good option.

### 7. Deployment topology — lean serving DB + Caddy, local==VPS

**Chosen.** The deployable app is decoupled from the ETL so it fits a small VPS
and ports without code changes.

- **Lean serving DB.** The VPS never carries the ~6 GB ETL database. A script
  (`scripts/export_serving_tables.sh`) `pg_dump`s only `facilities`,
  `match_facility_building`, `community` (~72 MB) into a dump the app's PostGIS
  container restores on first init. The API is read-only over this. Keeps the box
  at the **lean target (2 vCPU / 4 GB / 40 GB)** and means no request ever queries
  the 9.9M-row building layer — buildings are static PMTiles.
- **Caddy reverse proxy.** Serves the static frontend, proxies `/api` to FastAPI,
  serves `/tiles` (PMTiles via HTTP range). `SITE_ADDRESS=:80` locally, a domain
  on the VPS → **automatic HTTPS** (Let's Encrypt), certs persisted in a volume.
- **Deploy parity.** One `docker-compose.yml` for both environments; only `.env`
  differs. `restart: unless-stopped` + healthchecks on db/api. Redeploy =
  `git pull && docker compose up -d --build`.
- **Trade-off accepted:** the serving dump must be regenerated and shipped when
  the matched data changes (it is git-ignored). Cheap because it's small.

## Cross-cutting

- **Coordinate reference system:** WGS84 / EPSG:4326 throughout (matches source
  data); reproject only inside tile builds if a renderer needs Web Mercator.
- **Containerization:** Docker / docker-compose for local dev (Postgres+PostGIS,
  FastAPI, frontend) and reproducible builds.
- **Open-source by default:** every component above is open-source, consistent
  with the project's public-accountability mission.

## Deferred / reserved (not chosen now, on purpose)

- **Martin tile server** — reserved for live, large coverage layers (§5).
- **Mobile / satellite coverage layers** — out of initial scope per `mission.md`.
- **Hosting/cloud target** — to be decided; constrained only to support a
  CDN/object store (PMTiles) and a container runtime (FastAPI). Revisit before
  public launch.

## Open questions

- KOATUU↔KATOTTG crosswalk — **optional**, not a blocker. The primary match is
  purely spatial (coordinates → polygon), and administrative attribution comes
  from the matched building's KATOTTG or a point-in-polygon against the
  community/city boundary layers. A crosswalk is only a nice-to-have for an
  extra address-text cross-check. **Confirmed in the MVP:** community attribution
  and the map's community filter are done spatially (`ST_Contains`), because
  facilities carry old KOATUU gromada codes while the community layer uses the new
  KATOTTG `codifier` — they don't join, and the spatial route needs no crosswalk.
- Authentication/roles for operator and institution-administrator workflows
  (not needed for the public MVP map).
