"""Serving API for the Broadband Coverage Map (social facilities + spending).

Endpoints
  GET /health            liveness + DB reachability
  GET /facilities        GeoJSON FeatureCollection of ALL facilities with
                         coordinates (bbox opt.) — properties carry the fields
                         the client filters on (domain/oblast/hromada/
                         settlement/edrpou/confidence/providers)
  GET /facilities/{id}   full facility record + match metadata + payments
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

app = FastAPI(title="Broadband Coverage Map API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


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
    """Every facility with coordinates as a GeoJSON FeatureCollection.

    `confidence` is null for facilities without a building match; `providers`
    lists the distinct internet providers the facility paid (from the spending
    records), so provider search and the top-providers chart work client-side.
    """
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
                    'name', f.name,
                    'domain', f.domain_type,
                    'oblast', f.oblast,
                    'hromada', f.hromada,
                    'settlement', f.settlement,
                    'edrpou', f.edrpou,
                    'confidence', m.confidence,
                    'providers', pr.providers
                )
            ) AS feature
            FROM facilities f
            LEFT JOIN match_facility_building m ON m.facility_id = f.facility_id
            LEFT JOIN LATERAL (
                SELECT json_agg(json_build_object(
                    'edrpou', p.recipt_edrpou, 'name', p.recipt_name
                )) AS providers
                FROM (
                    SELECT DISTINCT recipt_edrpou, recipt_name
                    FROM facility_payments
                    WHERE facility_id = f.facility_id
                      AND recipt_edrpou IS NOT NULL
                ) p
            ) pr ON true
            WHERE f.geom IS NOT NULL
              {bbox_clause}
        ) t
        """
    )
    with engine().connect() as conn:
        result = conn.execute(sql, params).scalar_one()
    return result


@app.get("/facilities/{facility_id}")
def facility_detail(facility_id: int) -> dict:
    """Full facility record (all columns except geometry) plus match metadata
    and the list of internet-access payments."""
    with engine().connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT f.*, m.build_id, m.katottg AS match_katottg,
                       m.match_type, m.distance_m, m.confidence
                FROM facilities f
                LEFT JOIN match_facility_building m
                       ON m.facility_id = f.facility_id
                WHERE f.facility_id = :id
                """
            ),
            {"id": facility_id},
        ).mappings().first()
        if row is None:
            raise HTTPException(404, "facility not found")
        payments = conn.execute(
            text(
                """
                SELECT payer_name, trans_date, currency,
                       recipt_edrpou, recipt_name, amount
                FROM facility_payments
                WHERE facility_id = :id
                ORDER BY trans_date
                """
            ),
            {"id": facility_id},
        ).mappings().all()

    record = {k: v for k, v in dict(row).items() if k != "geom"}
    record["payments"] = [dict(p) for p in payments]
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
