"""02 - Matching.

Attribute each social establishment to a building footprint, purely spatially -
no KOATUU<->KATOTTG crosswalk required.

  1. containment - facility point inside an addressed building polygon  -> high
  2. centroid    - else nearest building whose polygon CENTROID is within
                   CENTROID_THRESHOLD_M (100 m)                         -> medium

Output: one row per matched facility in MATCH_OUTPUT_TABLE with build_id,
katottg, matched addr_num, distance_m (to the centroid) and a confidence flag.

    python 02_matching.py
"""
from __future__ import annotations

from sqlalchemy import text

import config
from db import engine

CREATE_SQL = f"""
DROP TABLE IF EXISTS {config.MATCH_OUTPUT_TABLE};
CREATE TABLE {config.MATCH_OUTPUT_TABLE} (
    facility_id bigint PRIMARY KEY,
    build_id    text,
    katottg     text,
    addr_num    text,
    match_type  text,
    distance_m  double precision,
    confidence  text
);
"""

# Both passes are driven from the (small) facilities table via LATERAL so each
# point does ONE GIST-indexed lookup against build_polygon. This sidesteps the
# planner's unreliable spatial-join selectivity estimate, which otherwise picks
# a full scan of the 9.9M-row building layer.

# Pass 1: facility point contained by a building polygon (exact, high confidence).
CONTAIN_SQL = f"""
INSERT INTO {config.MATCH_OUTPUT_TABLE}
    (facility_id, build_id, katottg, addr_num, match_type, distance_m, confidence)
SELECT f.facility_id, c.build_id, c.katottg, c.addr_num, 'contained', 0.0, 'high'
FROM {config.FACILITIES_TABLE} f
CROSS JOIN LATERAL (
    SELECT b.build_id, b.katottg, b.addr_num
    FROM {config.BUILDINGS_MATCH_TABLE} b
    WHERE ST_Contains(b.geom, f.geom)
    LIMIT 1
) c
WHERE f.geom IS NOT NULL;
"""

# Pass 2: nearest building CENTROID within threshold for facilities not yet
# matched. The planar ST_DWithin prefilter (:deg, in degrees, on the polygon so
# the GIST index applies) bounds the candidate set; the decision distance is
# point -> ST_Centroid(polygon) in metres via the geography cast, capped at :thr.
NEAREST_SQL = f"""
INSERT INTO {config.MATCH_OUTPUT_TABLE}
    (facility_id, build_id, katottg, addr_num, match_type, distance_m, confidence)
SELECT f.facility_id, n.build_id, n.katottg, n.addr_num, 'centroid', n.dist_m,
       'medium'
FROM {config.FACILITIES_TABLE} f
CROSS JOIN LATERAL (
    SELECT b.build_id, b.katottg, b.addr_num,
           ST_Distance(
               f.geom::geography, ST_Centroid(b.geom)::geography
           ) AS dist_m
    FROM {config.BUILDINGS_MATCH_TABLE} b
    WHERE ST_DWithin(f.geom, b.geom, :deg)
    ORDER BY ST_Distance(f.geom, ST_Centroid(b.geom))
    LIMIT 1
) n
WHERE f.geom IS NOT NULL
  AND n.dist_m <= :thr
  AND NOT EXISTS (
      SELECT 1 FROM {config.MATCH_OUTPUT_TABLE} m WHERE m.facility_id = f.facility_id
  );
"""


def main() -> None:
    eng = engine()
    # Generous metres->degrees conversion for the planar prefilter (Ukraine ~49°N,
    # 1° lon ~73 km). The prefilter measures to the polygon EDGE while the
    # decision distance is to its centroid, so pad ~3x to keep large buildings
    # whose centroid is within 100 m from being pre-filtered away.
    deg = config.CENTROID_THRESHOLD_M / 70000.0 * 3.0

    with eng.begin() as conn:
        conn.execute(text(CREATE_SQL))

    with eng.begin() as conn:
        print("Matching: containment pass ...")
        conn.execute(text(CONTAIN_SQL))
        n = conn.execute(text(
            f"SELECT count(*) FROM {config.MATCH_OUTPUT_TABLE}"
        )).scalar_one()
        print(f"  contained: {n}")

    with eng.begin() as conn:
        print("Matching: nearest-fallback pass ...")
        conn.execute(
            text(NEAREST_SQL),
            {"thr": config.CENTROID_THRESHOLD_M, "deg": deg},
        )

    print(f"Done -> {config.MATCH_OUTPUT_TABLE}")


if __name__ == "__main__":
    main()
