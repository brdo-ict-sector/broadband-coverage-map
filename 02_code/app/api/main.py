"""Serving API for the Broadband Coverage Map (MVP: matched hospitals).

Endpoints
  GET /health            liveness + DB reachability
  GET /facilities        GeoJSON FeatureCollection of accepted matches (bbox opt.)
  GET /facilities/{id}   full NSZU record + match metadata for the detail panel
  GET /communities       community boundaries as GeoJSON (simplified)

The GeoJSON is assembled in PostgreSQL (json_build_object / ST_AsGeoJSON) so the
API just streams the result — no per-row Python serialization.
"""
from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

import config
from db import engine

app = FastAPI(title="Broadband Coverage Map API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)

_CONF = ", ".join(f"'{c}'" for c in config.ACCEPTED_CONFIDENCE)


@app.get("/health")
def health() -> dict:
    try:
        with engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception as exc:  # pragma: no cover - surfaced to the caller
        raise HTTPException(status_code=503, detail=f"db unavailable: {exc}")


@app.get("/facilities")
def facilities(
    bbox: Optional[str] = Query(
        None,
        description="Optional 'minLng,minLat,maxLng,maxLat' viewport filter.",
    ),
) -> dict:
    """All accepted (high+medium) matched facilities as a GeoJSON
    FeatureCollection. Properties are kept minimal; fetch a single facility for
    the full record."""
    params: dict = {}
    bbox_clause = ""
    if bbox:
        try:
            minx, miny, maxx, maxy = (float(v) for v in bbox.split(","))
        except ValueError:
            raise HTTPException(400, "bbox must be 'minLng,minLat,maxLng,maxLat'")
        bbox_clause = (
            " AND f.geom && ST_MakeEnvelope(:minx,:miny,:maxx,:maxy,:srid)"
        )
        params.update(minx=minx, miny=miny, maxx=maxx, maxy=maxy, srid=config.SRID)

    sql = text(
        f"""
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(feature), '[]'::json)
        )
        FROM (
            SELECT json_build_object(
                'type', 'Feature',
                'id', f.facility_id,
                'geometry', ST_AsGeoJSON(f.geom, 6)::json,
                'properties', json_build_object(
                    'facility_id', f.facility_id,
                    'confidence', m.confidence,
                    'distance_m', round(m.distance_m::numeric, 1),
                    'community_id', cm.community_id
                )
            ) AS feature
            FROM facilities f
            JOIN match_facility_building m ON m.facility_id = f.facility_id
            -- Spatial attribution: which community polygon contains the point.
            -- Avoids the KOATUU(facility) <-> KATOTTG(community) code mismatch.
            LEFT JOIN LATERAL (
                SELECT c.ogc_fid AS community_id
                FROM community c
                WHERE ST_Contains(c.geom, f.geom)
                LIMIT 1
            ) cm ON true
            WHERE m.confidence IN ({_CONF})
              AND f.geom IS NOT NULL
              {bbox_clause}
        ) t
        """
    )
    with engine().connect() as conn:
        result = conn.execute(sql, params).scalar_one()
    return result


@app.get("/facilities/{facility_id}")
def facility_detail(facility_id: int) -> dict:
    """Full NSZU record (all columns except geometry) plus match metadata."""
    with engine().connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT f.*, m.build_id, m.katottg, m.addr_num,
                       m.match_type, m.distance_m, m.confidence
                FROM facilities f
                JOIN match_facility_building m ON m.facility_id = f.facility_id
                WHERE f.facility_id = :id
                  AND m.confidence IN ({conf})
                """.format(conf=_CONF)
            ),
            {"id": facility_id},
        ).mappings().first()
    if row is None:
        raise HTTPException(404, "facility not found or not an accepted match")

    record = {k: v for k, v in dict(row).items() if k != "geom"}
    return record


@app.get("/communities")
def communities() -> dict:
    """Community boundaries as a (lightly simplified) GeoJSON FeatureCollection
    for an optional administrative overlay."""
    sql = text(
        """
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(feature), '[]'::json)
        )
        FROM (
            SELECT json_build_object(
                'type', 'Feature',
                'id', c.ogc_fid,
                'geometry', ST_AsGeoJSON(
                    ST_SimplifyPreserveTopology(geom, 0.0005), 5
                )::json,
                'properties', json_build_object(
                    'id', c.ogc_fid,
                    'name', c.name_ua,
                    'full_name', c.full_name_
                )
            ) AS feature
            FROM community c
            WHERE c.geom IS NOT NULL
        ) t
        """
    )
    with engine().connect() as conn:
        result = conn.execute(sql).scalar_one()
    return result
