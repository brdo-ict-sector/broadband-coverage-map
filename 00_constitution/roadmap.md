# Roadmap — Broadband Coverage Map of Ukraine

> Status: Draft v1 · Last updated: 2026-06-22

## Status at a glance

| Phase | State |
| --- | --- |
| 0 — Foundations & data ingestion | ✅ Done (city/street layers deferred) |
| 1 — MVP matching (establishments → buildings) | ✅ Done (7,100 / 12,788 accepted; unmatched analysis ongoing) |
| 2 — MVP map | 🟨 **Built & running locally**, deployable to VPS; remaining: building PMTiles wired into the map + actual VPS deploy |
| 3 — Coverage data model | ⬜ Not started |
| 4 — Full ~80k catalog | ⬜ Not started |
| 5 — Audience workflows & launch | ⬜ Not started |

## How to read this

Phases are sequenced by dependency, not fixed dates. Each phase lists its
**goal**, **deliverables**, and **exit criteria** (what must be true to move on).
The MVP is **hospitals only**; the catalog later grows to ~80,000 social
establishments. Technology choices are fixed in `tech-stack.md`; the long-term
vision and audiences are in `mission.md`.

The near-term north star is the project's stated **step 1**: attribute (match)
the social-establishment list to building points/polygons.

---

## Phase 0 — Foundations & data ingestion  ✅ done

**Goal:** a reproducible environment with all raw data loaded into PostGIS.

**Deliverables**
- Docker-based local stack: PostgreSQL + PostGIS, Python ETL, FastAPI skeleton,
  React skeleton.
- Building layers (`Polygon`, `MultiPolygon`, `Point`), street, city, and
  community layers loaded into PostGIS with GIST indexes.
- NSZU establishment list (`nszu - …xlsx`) loaded as a clean table
  (lat/lng → geometry, normalized columns).
- Data dictionary / schema notes captured from the EDRA `_readme.txt`.

**Exit criteria**
- Every source layer queryable in PostGIS with a spatial index.
- Counts reconcile against source files (e.g. 9.9M polygons, 12.8k facilities).

---

## Phase 1 — MVP matching: establishments → buildings *(step 1)*  ✅ done

**Goal:** attribute each hospital to its building footprint/point with a
confidence flag. This is the core of the MVP.

**Deliverables**
- Matching pipeline (Python + PostGIS):
  - Primary: point-in-polygon of facility `lat/lng` against addressed building
    polygons → `high`.
  - Fallback: nearest building within the accept cap (25 m for the MVP) →
    `medium`.
  - Output: one row per facility with `BUILD_ID`, `KATOTTG`, matched address,
    match distance, and a **confidence flag**.
  - **MVP acceptance: only `high` + `medium` matches are used.** First run:
    7,100 / 12,788 with valid coordinates (55.5%) accepted.
- Secondary cross-check (optional): address/house-number comparison
  (`ADDR_NUM` / `MS_ID`). Not required — coordinates alone resolve the match;
  this only adds confidence where a KOATUU↔KATOTTG link happens to be available.
- A match-quality report (matched / nearest-fallback / unmatched counts).

**Exit criteria**
- Hospital list matched to buildings using `high` + `medium` only (achieved:
  55.5% on the first run).
- Unmatched cases investigated (rural / no footprint / approximate coordinates)
  and improvement options assessed — e.g. `build_multipolygon` fallback.

---

## Phase 2 — MVP map: visualize matched hospitals  🟨 mostly done

**Goal:** a public, interactive map proving the data end to end.

**Deliverables**
- ✅ Deployable app stack in `02_code/app/` — **lean serving DB + FastAPI +
  Caddy** (static frontend, `/api` proxy, `/tiles`), one `docker compose` that
  runs identically locally and on the VPS (see `tech-stack.md` §7).
- ✅ Facilities served as **GeoJSON from FastAPI** (high+medium, 7,100 points),
  rendered as small unclustered dots so the spatial distribution is readable
  from the country view; click a facility → detail panel (record by ID).
- ✅ **Community boundaries + filter**: all 1,471 громади drawn as borders; a
  dropdown filters facilities to a community. Attribution is **spatial**
  (`ST_Contains`), not a KOATUU↔KATOTTG crosswalk.
- ✅ Modern light basemap (CARTO Positron), viewport locked to Ukraine.
- ⬜ Static building PMTiles built (`scripts/build_building_tiles.sh`) but **not
  yet wired into the map** (still on the public basemap).
- ⬜ Actual VPS deployment (stack is deploy-ready; not yet provisioned).

**Exit criteria**
- ✅ Map loads and renders smoothly for the hospital dataset (locally verified).
- ⬜ Verified comfortable under ~1,000 concurrent users (static tiles + CDN; API
  load-checked for the facility/detail endpoints) — pending real deploy.

---

## Phase 3 — Coverage data model & connectivity status

**Goal:** introduce the actual broadband/connectivity dimension on top of the
established geography.

**Deliverables**
- Coverage schema: availability, technology (FTTx/DOCSIS/xDSL), speed, price at
  settlement granularity; connectivity status per social institution.
- Ingestion paths for operator-reported and open/external coverage data.
- Map layers + facility detail showing connectivity status and parameters.

**Exit criteria**
- A settlement and a facility can both display real coverage attributes.
- Data provenance is recorded per record (source, date).

---

## Phase 4 — Scale to full establishment catalog (~80k)

**Goal:** grow beyond hospitals to all essential social institutions.

**Deliverables**
- Generalized establishment model (schools, healthcare, other public
  institutions) reusing the Phase 1 matching pipeline.
- **Facilities layer migrated from GeoJSON to vector tiles** (PMTiles, or Martin
  if near-live updates are needed) — required before the catalog approaches
  tens of thousands of points (see `tech-stack.md` §5 scaling watch).
- Performance pass on tile builds and API.

**Exit criteria**
- Full catalog renders within performance budget at ~1,000 concurrent users.
- No single browser source exceeds safe size limits.

---

## Phase 5 — Audience workflows & public launch

**Goal:** deliver the three audience experiences from `mission.md`.

**Deliverables**
- **Government:** settlement-level coverage-gap views and progress tracking.
- **Institution administrators:** peer benchmarking (e.g. school vs neighbouring
  schools).
- **Operators:** market views (price/speed by location) and a coverage-data
  contribution path.
- Auth/roles for non-public workflows; public read-only map remains open.

**Exit criteria**
- Each audience can complete its core task end to end.
- Public map published as the canonical reference (per the 2028 vision).

---

## Parallel / ongoing tracks

- **Data quality & ground-truth:** crowdsourced/field validation as a continuous
  check on coverage and matches.
- **KOATUU↔KATOTTG crosswalk (optional):** spatial matching + boundary layers
  already provide administrative attribution; integrate a crosswalk only to
  strengthen the optional address-text cross-check.
- **Observability & ops:** hosting target decision, CDN, monitoring, backups.
