"""Step 2: Aggregate daily cost per project/team.

This script reads the same BigQuery pricing export table used by the Node.js step 1,
then computes daily totals grouped by "project/team" (billing_account_id) and date.

Usage:
  python step2_aggregate.py --start 2026-03-01 --end 2026-03-18

Optional:
  python step2_aggregate.py --start 2026-03-01 --end 2026-03-18 --output out.csv

Requirements:
  pip install google-cloud-bigquery

The script will read `config/.env` for:
  GOOGLE_APPLICATION_CREDENTIALS, PROJECT_ID, DATASET_ID, TABLE_ID
"""

import argparse
import csv
import os
import re
import sys
from datetime import datetime

try:
    from google.cloud import bigquery
except ImportError as e:
    raise SystemExit(
        "Missing dependency: google-cloud-bigquery. Install it with `pip install google-cloud-bigquery`."
    )


def load_dotenv(dotenv_path: str):
    """Read a simple .env file and load it into os.environ."""
    if not os.path.exists(dotenv_path):
        return

    with open(dotenv_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
            if not match:
                continue
            key, val = match.group(1), match.group(2)
            # Strip optional quotes
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            os.environ.setdefault(key, val)


def parse_iso_date(text: str) -> str:
    """Parse a date string in YYYY-MM-DD format, returning the same string on success."""
    try:
        datetime.strptime(text, "%Y-%m-%d")
        return text
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid date: {text}. Expected YYYY-MM-DD.")


def build_query(project: str, dataset: str, table: str) -> str:
    # We treat billing_account_id as the proxy for project/team.
    # export_time is a TIMESTAMP, and list_price.tiered_rates[0].usd_amount holds the numeric price.
    return f"""
SELECT
  DATE(export_time) AS date,
  billing_account_id AS project_id,
  SUM(IFNULL(list_price.tiered_rates[SAFE_OFFSET(0)].usd_amount, 0)) AS total_cost
FROM `{project}.{dataset}.{table}`
WHERE DATE(export_time) BETWEEN @start AND @end
GROUP BY date, billing_account_id
ORDER BY date, total_cost DESC
""".strip()


def run_query(project: str, dataset: str, table: str, start: str, end: str):
    client = bigquery.Client(project=project)

    query = build_query(project, dataset, table)
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("start", "DATE", start),
            bigquery.ScalarQueryParameter("end", "DATE", end),
        ]
    )

    query_job = client.query(query, job_config=job_config)
    return query_job.result()


def main():
    parser = argparse.ArgumentParser(description="Aggregate daily cost per project/team")
    parser.add_argument("--start", required=True, type=parse_iso_date, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, type=parse_iso_date, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output", help="Optional output CSV file")
    args = parser.parse_args()

    # Load config from .env (same file used by node app)
    load_dotenv(os.path.join(os.path.dirname(__file__), "config", ".env"))

    project = os.environ.get("PROJECT_ID")
    dataset = os.environ.get("DATASET_ID")
    table = os.environ.get("TABLE_ID")

    if not (project and dataset and table):
        raise SystemExit(
            "Missing PROJECT_ID, DATASET_ID, or TABLE_ID in environment (config/.env)."
        )

    print(f"Querying {project}.{dataset}.{table} for {args.start} -> {args.end}")

    rows = run_query(project, dataset, table, args.start, args.end)

    out = []
    for row in rows:
        out.append({
            "date": row["date"].isoformat() if row["date"] else None,
            "project_id": row["project_id"],
            "total_cost": float(row["total_cost"] or 0),
        })

    if args.output:
        with open(args.output, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["date", "project_id", "total_cost"])
            writer.writeheader()
            writer.writerows(out)
        print(f"Wrote {len(out)} rows to {args.output}")
    else:
        for r in out:
            print(f"{r['date']}\t{r['project_id']}\t{r['total_cost']}")


if __name__ == "__main__":
    main()
