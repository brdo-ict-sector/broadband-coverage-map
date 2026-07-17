# Roadmap — Broadband Coverage Map of Ukraine

> Status: Draft v2 · Last updated: 2026-07-17

## Status at a glance

| Phase | State |
| --- | --- |
| 0 — Foundations & data ingestion | ✅ Done (city/street layers deferred) |
| 1 — MVP matching (establishments → buildings) | ✅ Done — re-run on the new catalog: 12,533 / 17,827 (70.3%) matched with the 100 m-centroid rule |
| 2 — MVP map | 🟨 **Built & running locally** (BRDO design, filters, spending/providers analytics); remaining: building PMTiles wired into the map + actual VPS deploy |
| 3 — Coverage data model | ⬜ Not started (internet-spending payments are a first slice, already in the app) |
| 4 — Full ~80k catalog | 🟨 Started — catalog switched from NSZU-only to the 4-domain social-facilities list (64,864 rows; 17,945 with coordinates so far) |
| 5 — Audience workflows & launch | ⬜ Not started |

## How to read this

Phases are sequenced by dependency, not fixed dates. Each phase lists its
**goal**, **deliverables**, and **exit criteria** (what must be true to move on).
Technology choices are fixed in `tech-stack.md`; the long-term vision and
audiences are in `mission.md`.

**Data source (since 2026-07-17):** the catalog is
`01_data_sources/01_prep_data/social_facilities_spending - 2026-07-16.xlsx` —
social facilities across four domains (медицина, освіта, культура,
адміністративні послуги) joined with public-spending records for internet
access (payer, provider ЄДРПОУ/name, amount, date). Only rows with coordinates
are mapped (currently медицина + адмінпослуги; освіта/культура lack
coordinates in the source). It replaces the NSZU-only hospital list.

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

**Goal:** attribute each facility to its building footprint/point with a
confidence flag. This is the core of the MVP.

**Deliverables**
- Matching pipeline (Python + PostGIS):
  - Primary: point-in-polygon of facility `lat/lng` against addressed building
    polygons → `high`.
  - Fallback: nearest building whose polygon **centroid is within 100 m**
    (decision 2026-07-17; replaced the earlier 25 m edge-distance cap) →
    `medium`.
  - Output: one row per facility with `BUILD_ID`, `KATOTTG`, matched address,
    centroid distance, and a **confidence flag**.
  - Current run (new catalog): **12,533 / 17,827 (70.3%)** — 3,888 contained +
    8,645 centroid ≤ 100 m. Unmatched facilities are still shown on the map,
    flagged "без прив'язки".
- Secondary cross-check (optional): address/house-number comparison
  (`ADDR_NUM` / `MS_ID`). Not required — coordinates alone resolve the match;
  this only adds confidence where a KOATUU↔KATOTTG link happens to be available.
- A match-quality report (matched / nearest-fallback / unmatched counts).

**Exit criteria**
- Facility list matched to buildings with `high` + `medium` confidence
  (achieved: 70.3% on the current catalog).
- Unmatched cases investigated (rural / no footprint / approximate coordinates)
  and improvement options assessed — e.g. `build_multipolygon` fallback.

---

## Phase 2 — MVP map: visualize matched hospitals  🟨 mostly done

**Goal:** a public, interactive map proving the data end to end.

**Deliverables**
- ✅ Deployable app stack in `02_code/app/` — **lean serving DB + FastAPI +
  Caddy** (static frontend, `/api` proxy, `/tiles`), one `docker compose` that
  runs identically locally and on the VPS (see `tech-stack.md` §7).
- ✅ Facilities served as **GeoJSON from FastAPI** (all 17,827 points with
  coordinates, matched or not), rendered as small unclustered dots coloured by
  match confidence (teal / vermillion / slate); click a facility → detail card
  with the facility record + its internet-access payments.
- ✅ **Filters & analytics UI** (BRDO design, applied 2026-07-17 from
  `03_design_references/`): cascading область → громада → населений пункт +
  галузь filters, search by facility and provider ЄДРПОУ, live counters
  (facilities / payers by ЄДРПОУ / providers), top-20 providers bar chart
  (click-to-filter), CSV export of the current selection. All filtering is
  client-side over one FeatureCollection.
- ✅ Modern light basemap (CARTO Positron), viewport fitted & locked to Ukraine.
- ⬜ Static building PMTiles built (`scripts/build_building_tiles.sh`) but **not
  yet wired into the map** (still on the public basemap).
- ⬜ Actual VPS deployment (stack is deploy-ready; not yet provisioned).
- Note: the earlier community-borders overlay + spatial community filter was
  **replaced** by attribute-based filters from the new catalog (`/communities`
  endpoint still exists, unused by the frontend).

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
