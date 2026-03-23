"""Step 3: Anomaly detection on daily cost per project/team.

This script reads daily aggregated cost data and detects anomalies using a rolling
moving average and standard deviation (z-score) plus a percentage growth threshold.

By default it will read aggregated cost data from the same BigQuery pricing export
used in step 2, and will output detected anomalies to a local CSV file.

Usage:
  python step3_anomaly.py --start 2026-03-01 --end 2026-03-18

Optional:
  python step3_anomaly.py --start 2026-03-01 --end 2026-03-18 --output anomalies.csv
  python step3_anomaly.py --start 2026-03-01 --end 2026-03-18 --output anomalies.csv \
    --bq-table my_dataset.anomalies --zscore 2.5 --pct 0.8

Requirements:
  pip install google-cloud-bigquery

Output columns:
  date, project_id, total_cost, mean_30, std_30, z_score, pct_increase, anomaly_reason
"""

import argparse
import csv
import os
import re
import sys
from collections import deque
from datetime import datetime, timedelta

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
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            os.environ.setdefault(key, val)


def parse_iso_date(text: str) -> datetime:
    """Parse a date string in YYYY-MM-DD format."""
    try:
        return datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid date: {text}. Expected YYYY-MM-DD.")


def build_query(project: str, dataset: str, table: str, start: str, end: str, window_days: int):
    # We query extra days before the requested start range to allow the moving window to compute
    # a full rolling average (i.e., providing `window_days` of history).
    window_start = (datetime.fromisoformat(start) - timedelta(days=window_days)).strftime("%Y-%m-%d")

    return f"""
SELECT
  DATE(export_time) AS date,
  billing_account_id AS project_id,
  SUM(IFNULL(list_price.tiered_rates[SAFE_OFFSET(0)].usd_amount, 0)) AS total_cost
FROM `{project}.{dataset}.{table}`
WHERE DATE(export_time) BETWEEN @start AND @end
GROUP BY date, billing_account_id
ORDER BY project_id, date
""".strip(), window_start


def run_bigquery(project: str, dataset: str, table: str, start: str, end: str, window_days: int):
    client = bigquery.Client(project=project)
    query, window_start = build_query(project, dataset, table, start, end, window_days)

    # Use the query to fetch enough history for rolling statistics.
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("start", "DATE", window_start),
            bigquery.ScalarQueryParameter("end", "DATE", end),
        ]
    )

    query_job = client.query(query, job_config=job_config)
    return list(query_job.result())


def compute_anomalies(rows, window_days: int, z_threshold: float, pct_threshold: float, range_start, range_end):
    # Group rows by project_id
    projects = {}
    for row in rows:
        date = row["date"].strftime("%Y-%m-%d")
        pid = row["project_id"]
        cost = float(row["total_cost"] or 0)
        projects.setdefault(pid, []).append((date, cost))

    anomalies = []

    for pid, data in projects.items():
        # Sort by date (should already be sorted from the query)
        data.sort(key=lambda x: x[0])
        window = deque(maxlen=window_days)
        prev_cost = None

        for date, cost in data:
            if date < range_start or date > range_end:
                # Keep building the window until we reach the target range
                window.append(cost)
                prev_cost = cost
                continue

            # Compute rolling stats using the previous window values (not including current day)
            if len(window) >= 2:
                mean = sum(window) / len(window)
                variance = sum((x - mean) ** 2 for x in window) / len(window)
                std = variance**0.5
            else:
                mean = 0.0
                std = 0.0

            z_score = None
            if std > 0:
                z_score = (cost - mean) / std

            pct_increase = None
            if prev_cost is not None and prev_cost != 0:
                pct_increase = (cost - prev_cost) / prev_cost

            reasons = []
            if z_score is not None and z_score > z_threshold:
                reasons.append(f"z>{z_threshold:.1f}")
            if pct_increase is not None and pct_increase > pct_threshold:
                reasons.append(f"+{pct_threshold*100:.0f}%")

            if reasons:
                mean_key = f"mean_{window_days}"
                std_key = f"std_{window_days}"
                anomalies.append(
                    {
                        "date": date,
                        "project_id": pid,
                        "total_cost": cost,
                        mean_key: mean,
                        std_key: std,
                        "z_score": z_score,
                        "pct_increase": pct_increase,
                        "anomaly_reason": ",".join(reasons),
                    }
                )

            window.append(cost)
            prev_cost = cost

    return anomalies


def write_csv(path: str, rows, window_days: int):
    if not rows:
        print("No anomalies detected (nothing to write).")
        return

    fieldnames = [
        "date",
        "project_id",
        "total_cost",
        f"mean_{window_days}",
        f"std_{window_days}",
        "z_score",
        "pct_increase",
        "anomaly_reason",
    ]

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} anomalies to {path}")


def write_to_bigquery(project: str, dataset: str, table: str, rows):
    client = bigquery.Client(project=project)

    dataset_ref = client.dataset(dataset)
    table_ref = dataset_ref.table(table)

    schema = [
        bigquery.SchemaField("date", "DATE"),
        bigquery.SchemaField("project_id", "STRING"),
        bigquery.SchemaField("total_cost", "FLOAT"),
        bigquery.SchemaField("mean_30", "FLOAT"),
        bigquery.SchemaField("std_30", "FLOAT"),
        bigquery.SchemaField("z_score", "FLOAT"),
        bigquery.SchemaField("pct_increase", "FLOAT"),
        bigquery.SchemaField("anomaly_reason", "STRING"),
        bigquery.SchemaField("detected_at", "TIMESTAMP"),
    ]

    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )

    # Add current timestamp so the table shows when the analysis ran.
    for r in rows:
        r["detected_at"] = datetime.utcnow().isoformat() + "Z"

    job = client.load_table_from_json(rows, table_ref, job_config=job_config)
    job.result()
    print(f"Loaded {len(rows)} rows into {project}.{dataset}.{table}")


def main():
    parser = argparse.ArgumentParser(description="Run daily cost anomaly detection")
    parser.add_argument("--start", required=True, type=parse_iso_date, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, type=parse_iso_date, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output", default="anomalies.csv", help="Output CSV path")
    parser.add_argument("--input", help="Optional input CSV file (if not set, queries BigQuery)")
    parser.add_argument("--window", type=int, default=30, help="Rolling window size in days")
    parser.add_argument("--zscore", type=float, default=2.5, help="Z-score threshold")
    parser.add_argument("--pct", type=float, default=0.8, help="Percent increase threshold (e.g., 0.8 for 80%%)")
    parser.add_argument("--bq-table", help="Optional BigQuery table to write anomalies (dataset.table)")
    args = parser.parse_args()

    load_dotenv(os.path.join(os.path.dirname(__file__), "config", ".env"))

    project = os.environ.get("PROJECT_ID")
    dataset = os.environ.get("DATASET_ID")
    table = os.environ.get("TABLE_ID")

    if not (project and dataset and table):
        raise SystemExit(
            "Missing PROJECT_ID, DATASET_ID, or TABLE_ID in environment (config/.env)."
        )

    # Read data either from CSV or by querying BQ
    if args.input:
        print(f"Reading aggregated data from {args.input}")
        with open(args.input, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = [
                {
                    "date": datetime.strptime(r["date"], "%Y-%m-%d"),
                    "project_id": r["project_id"],
                    "total_cost": float(r["total_cost"]),
                }
                for r in reader
            ]
    else:
        start_date = args.start.strftime("%Y-%m-%d")
        end_date = args.end.strftime("%Y-%m-%d")
        print(f"Querying BigQuery for {start_date} -> {end_date}")
        rows = run_bigquery(project, dataset, table, start_date, end_date, args.window)

    # Convert rows to the format expected by compute_anomalies
    prepared_rows = []
    for r in rows:
        if isinstance(r, dict):
            prepared_rows.append(r)
        else:
            prepared_rows.append(
                {
                    "date": r["date"],
                    "project_id": r["project_id"],
                    "total_cost": float(r["total_cost"] or 0),
                }
            )

    anomalies = compute_anomalies(
        prepared_rows,
        window_days=args.window,
        z_threshold=args.zscore,
        pct_threshold=args.pct,
        range_start=args.start.strftime("%Y-%m-%d"),
        range_end=args.end.strftime("%Y-%m-%d"),
    )

    write_csv(args.output, anomalies, args.window)

    if args.bq_table:
        if "." not in args.bq_table:
            raise SystemExit("--bq-table must be in the form <dataset>.<table>")
        bq_dataset, bq_table = args.bq_table.split(".", 1)
        write_to_bigquery(project, bq_dataset, bq_table, anomalies)


if __name__ == "__main__":
    main()
