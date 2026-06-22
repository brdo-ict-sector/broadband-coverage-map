"""03 - Match report.

Quality metrics for the establishment <-> building match: matched vs unmatched,
and a breakdown by match type / confidence with mean distance. Writes a CSV to
the output directory.

    python 03_match_report.py
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy import text

import config
from db import engine


def main() -> None:
    with engine().connect() as conn:
        total = conn.execute(text(
            f"SELECT count(*) FROM {config.FACILITIES_TABLE} WHERE geom IS NOT NULL"
        )).scalar_one()
        matched = conn.execute(text(
            f"SELECT count(*) FROM {config.MATCH_OUTPUT_TABLE}"
        )).scalar_one()
        breakdown = pd.read_sql(text(f"""
            SELECT match_type, confidence, count(*) AS n,
                   round(avg(distance_m)::numeric, 1) AS avg_dist_m
            FROM {config.MATCH_OUTPUT_TABLE}
            GROUP BY match_type, confidence
            ORDER BY match_type, confidence
        """), conn)

    unmatched = total - matched
    pct = (lambda n: f"{n / total:.1%}" if total else "n/a")
    print(f"\nFacilities with coordinates : {total}")
    print(f"Matched                     : {matched} ({pct(matched)})")
    print(f"Unmatched                   : {unmatched} ({pct(unmatched)})")
    print("\nBreakdown by match type / confidence:")
    print(breakdown.to_string(index=False) if not breakdown.empty else "  (no matches)")

    out = config.OUTPUT_DIR / "match_report.csv"
    breakdown.to_csv(out, index=False)
    print(f"\nWritten: {out}")


if __name__ == "__main__":
    main()
