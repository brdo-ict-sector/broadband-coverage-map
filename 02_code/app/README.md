# Broadband Coverage Map — app (API + frontend)

The **deployable application**: a lean serving database, a read-only FastAPI, and
a Caddy front end (static React map + `/api` proxy + building PMTiles). The same
`docker compose` stack runs on your laptop and on the VPS — only `.env` changes.

This is separate from the ETL pipeline in `../` (the heavy 6 GB building DB). The
app never carries that: buildings are static PMTiles and the API only reads three
small tables (`facilities`, `match_facility_building`, `community`).

```
app/
  docker-compose.yml   db (serving) + api + web (Caddy)
  .env.example         copy to .env
  Caddyfile            static + /api proxy + /tiles
  api/                 FastAPI (read-only over the serving DB)
  frontend/            React + TS + Vite + MapLibre  ->  built to static
  serving-data/        serving.sql (generated; restored on first DB init)
  tiles/               buildings.pmtiles (generated, optional)
```

## Run locally

Prerequisites: Docker Desktop running. The **ETL DB must be loaded first** (see
`../README.md` and `memory/dev-environment`) because the app's data is exported
from it.

```bash
# from 02_code/
bash scripts/export_serving_tables.sh      # ETL DB -> app/serving-data/serving.sql
cd app
cp .env.example .env                        # defaults are fine for local
docker compose up -d --build
```

Open <http://localhost>. On first start the `db` container restores
`serving.sql` (only happens once, while the data volume is empty).

Check it:

```bash
curl localhost:8000/health                  # {"status":"ok"}
curl "localhost:8000/facilities" | head     # GeoJSON FeatureCollection
```

### Frontend dev server (hot reload)

```bash
cd app/frontend
npm install
npm run dev                                  # http://localhost:5173, proxies /api -> :8000
```

(The compose stack must be up so the API is reachable on `:8000`.)

## Endpoints

| Method | Path                  | Purpose                                            |
| ------ | --------------------- | -------------------------------------------------- |
| GET    | `/health`             | liveness + DB reachability                         |
| GET    | `/facilities`         | accepted (high+medium) matches as GeoJSON; `?bbox=minLng,minLat,maxLng,maxLat` |
| GET    | `/facilities/{id}`    | full NSZU record + match metadata (detail panel)   |
| GET    | `/communities`        | community boundaries (simplified) as GeoJSON       |

## Deploy to the VPS

The lean target (2 vCPU / 4 GB / 40 GB) is enough because the VPS runs only this
stack — no ETL, no 9.9M-row building table.

1. **Provision**: install Docker + compose plugin. Point a DNS A record at the box.
2. **Ship the code + data**: `git pull` the repo, then copy the generated
   `serving-data/serving.sql` (it is git-ignored — `scp` it, or re-run the export
   against a DB on the VPS). Optionally `scp` `tiles/buildings.pmtiles`.
3. **Configure**: `cp .env.example .env` and set
   - `SITE_ADDRESS=coverage.example.ua` (a real domain → automatic HTTPS),
   - a strong `POSTGRES_PASSWORD`.
4. **Launch**: `docker compose up -d --build`. Caddy obtains a Let's Encrypt
   certificate on first request; `caddy_data` persists it across restarts.

### Update / redeploy

```bash
git pull && docker compose up -d --build
```

### Reliability notes (already wired in)

- `restart: unless-stopped` on every service; healthchecks on `db` and `api`.
- The serving DB is small, so back it up cheaply, e.g. a daily cron:
  ```bash
  docker exec broadband_app_db pg_dump -U gis broadband | gzip > backup-$(date +%F).sql.gz
  ```
- The API is read-only and stateless; scale by adding `--workers` to the uvicorn
  command or running more `api` replicas behind Caddy.

## Building PMTiles (optional, heavy, one-time)

```bash
# from 02_code/, ETL DB up
bash scripts/build_building_tiles.sh         # -> app/tiles/buildings.pmtiles
```

Caddy serves it at `/tiles/buildings.pmtiles`. The map currently uses an OSM
raster basemap; wiring the PMTiles layer into `frontend/src/MapView.tsx` (via the
`pmtiles://` protocol) is the next step to render our own footprints.
