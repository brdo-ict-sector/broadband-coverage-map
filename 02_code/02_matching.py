"""02 - Matching.

Attribute each social establishment to a building footprint, purely spatially -
no KOATUU<->KATOTTG crosswalk required.

  1. containment - facility point inside an addressed building polygon  -> high
  2. nearest     - else nearest building within NEAREST_THRESHOLD_M
                   (<= HIGH_CONF_NEAREST_M => medium, else low)

Output: one row per matched facility in MATCH_OUTPUT_TABLE with build_id,
katottg, matched addr_num, distance_m and a confidence flag.

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

# Pass 2: nearest building within threshold for facilities not yet matched.
# A planar ST_DWithin prefilter (:deg, in degrees) keeps the KNN search on the
# GIST index bounded to nearby candidates; the exact distance is then computed in
# metres via the geography cast and filtered to :thr.
NEAREST_SQL = f"""
INSERT INTO {config.MATCH_OUTPUT_TABLE}
    (facility_id, build_id, katottg, addr_num, match_type, distance_m, confidence)
SELECT f.facility_id, n.build_id, n.katottg, n.addr_num, 'nearest', n.dist_m,
       CASE WHEN n.dist_m <= :hi THEN 'medium' ELSE 'low' END
FROM {config.FACILITIES_TABLE} f
CROSS JOIN LATERAL (
    SELECT b.build_id, b.katottg, b.addr_num,
           ST_Distance(f.geom::geography, b.geom::geography) AS dist_m
    FROM {config.BUILDINGS_MATCH_TABLE} b
    WHERE ST_DWithin(f.geom, b.geom, :deg)
    ORDER BY f.geom <-> b.geom
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
    # 1° lon ~73 km); the exact metre filter in the query keeps results correct.
    deg = config.NEAREST_THRESHOLD_M / 70000.0 * 2.0

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
            {"thr": config.NEAREST_THRESHOLD_M, "hi": config.HIGH_CONF_NEAREST_M, "deg": deg},
        )

    print(f"Done -> {config.MATCH_OUTPUT_TABLE}")


if __name__ == "__main__":
    main()
