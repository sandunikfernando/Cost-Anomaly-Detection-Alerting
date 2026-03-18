"""
Cost Anomaly Detection & Alerting — Airflow DAG
================================================
Runs daily at 08:00 UTC. Each task makes an HTTP call to the
Node.js backend API. Tasks are sequential — each one depends on
the previous completing successfully.

DAG Flow:
  fetch_billing → aggregate_costs → detect_anomalies →
  compare_budget → send_alerts → create_ticket
"""

import logging
from datetime import datetime, timedelta

import requests
from airflow import DAG
from airflow.models import Variable
from airflow.operators.python import PythonOperator
from airflow.operators.email import EmailOperator
from airflow.utils.dates import days_ago

log = logging.getLogger(__name__)

# ─── Config ────────────────────────────────────────────────────────────────────
# Store BACKEND_URL and API_KEY in Airflow Variables (Admin → Variables in UI)
BACKEND_URL = Variable.get("COST_ANOMALY_BACKEND_URL", default_var="http://nodejs-backend:3000")
API_KEY     = Variable.get("COST_ANOMALY_API_KEY",     default_var="")
TIMEOUT     = 120  # seconds per HTTP call


# ─── Default DAG Args ──────────────────────────────────────────────────────────
default_args = {
    "owner":            "finops-team",
    "depends_on_past":  False,
    "email":            ["finops-oncall@yourcompany.com"],
    "email_on_failure": True,
    "email_on_retry":   False,
    "retries":          2,
    "retry_delay":      timedelta(minutes=5),
    "execution_timeout": timedelta(minutes=30),
}


# ─── Helper: Call Node.js Backend ──────────────────────────────────────────────
def call_backend(endpoint: str, **context) -> dict:
    """
    Make an authenticated POST to the Node.js backend.

    Airflow passes `ds` (execution date, YYYY-MM-DD) via the context.
    We use yesterday's date because GCP billing export has a 1-day lag.
    """
    # ds = DAG execution date; billing data is available for the day before
    execution_date = context["ds"]
    billing_date   = (datetime.strptime(execution_date, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")

    url     = f"{BACKEND_URL}/api/{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key":    API_KEY,
    }
    payload = {"date": billing_date}

    log.info("Calling backend: POST %s with date=%s", url, billing_date)

    response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)

    if response.status_code != 200:
        raise RuntimeError(
            f"Backend call failed [{response.status_code}]: "
            f"POST {endpoint} → {response.text[:500]}"
        )

    result = response.json()
    log.info("Backend response from %s: %s", endpoint, result)

    # Push result to XCom so downstream tasks can inspect it
    context["ti"].xcom_push(key=endpoint.replace("/", "_"), value=result)
    return result


# ─── Task Functions ────────────────────────────────────────────────────────────
def task_fetch_billing(**context):
    """Task 1 — Pull billing data from GCP BigQuery via Node.js backend."""
    result = call_backend("billing/fetch", **context)
    log.info("Fetched %s rows, total cost: $%s", result.get("rowsFetched"), result.get("totalCost"))
    return result


def task_aggregate_costs(**context):
    """Task 2 — Aggregate raw billing rows by team/project."""
    result = call_backend("billing/aggregate", **context)
    log.info("Aggregated %s team/project records", len(result.get("aggregated", [])))
    return result


def task_detect_anomalies(**context):
    """Task 3 — Run statistical anomaly detection on aggregated costs."""
    result = call_backend("anomaly/detect", **context)
    n = result.get("anomaliesFound", 0)
    log.info("Anomaly detection complete: %s anomalies found out of %s evaluated",
             n, result.get("totalEvaluated", 0))
    if n == 0:
        log.info("No anomalies detected — downstream alert/ticket tasks will no-op")
    return result


def task_compare_budget(**context):
    """Task 4 — Compare anomalies against team budgets stored in Postgres."""
    result = call_backend("budget/compare", **context)
    log.info("Budget comparison: %s breaches out of %s anomalies",
             len(result.get("budgetBreaches", [])), result.get("compared", 0))
    return result


def task_send_alerts(**context):
    """Task 5 — Send Slack + email alerts for all detected anomalies."""
    result = call_backend("alerts/send", **context)
    log.info("Alerts sent: %s", result.get("alertsSent", 0))
    return result


def task_create_tickets(**context):
    """Task 6 — Create ServiceNow investigation tickets for anomalies."""
    result = call_backend("tickets/create", **context)
    log.info("Tickets created: %s", result.get("ticketsCreated", 0))
    return result


def task_health_check(**context):
    """Pre-flight health check — verifies backend + Postgres + BigQuery are up."""
    url      = f"{BACKEND_URL}/health"
    headers  = {"X-API-Key": API_KEY}
    response = requests.get(url, headers=headers, timeout=30)
    health   = response.json()

    if health.get("status") != "ok":
        raise RuntimeError(f"Backend health check failed: {health}")

    log.info("Backend health OK: %s", health)
    return health


# ─── DAG Definition ────────────────────────────────────────────────────────────
with DAG(
    dag_id="cost_anomaly_detection",
    description="Daily GCP cost anomaly detection and alerting pipeline",
    default_args=default_args,
    schedule_interval="0 8 * * *",   # 08:00 UTC daily
    start_date=days_ago(1),
    catchup=False,
    max_active_runs=1,               # Prevent concurrent DAG runs
    tags=["finops", "cost", "anomaly", "gcp"],
) as dag:

    # ── Task 0: Health Check ────────────────────────────────────────────────────
    health_check = PythonOperator(
        task_id="health_check",
        python_callable=task_health_check,
        doc_md="Verify the Node.js backend, Postgres, and BigQuery are reachable.",
    )

    # ── Task 1: Fetch Billing ───────────────────────────────────────────────────
    fetch_billing = PythonOperator(
        task_id="fetch_billing",
        python_callable=task_fetch_billing,
        doc_md="Pull raw billing line items from GCP BigQuery for yesterday.",
    )

    # ── Task 2: Aggregate ───────────────────────────────────────────────────────
    aggregate_costs = PythonOperator(
        task_id="aggregate_costs",
        python_callable=task_aggregate_costs,
        doc_md="Group raw billing rows by team + project into daily totals.",
    )

    # ── Task 3: Detect Anomalies ────────────────────────────────────────────────
    detect_anomalies = PythonOperator(
        task_id="detect_anomalies",
        python_callable=task_detect_anomalies,
        doc_md="Run z-score statistical analysis to flag unusual spend patterns.",
    )

    # ── Task 4: Compare Budget ──────────────────────────────────────────────────
    compare_budget = PythonOperator(
        task_id="compare_budget",
        python_callable=task_compare_budget,
        doc_md="Compare each anomaly against the team's monthly budget from Postgres.",
    )

    # ── Task 5: Send Alerts ─────────────────────────────────────────────────────
    send_alerts = PythonOperator(
        task_id="send_alerts",
        python_callable=task_send_alerts,
        doc_md="Post Slack messages and send emails to team owners for each anomaly.",
    )

    # ── Task 6: Create Tickets ──────────────────────────────────────────────────
    create_tickets = PythonOperator(
        task_id="create_tickets",
        python_callable=task_create_tickets,
        doc_md="Open ServiceNow incident tickets for investigation and assignment.",
    )

    # ─── Task Dependencies (Sequential Pipeline) ───────────────────────────────
    health_check >> fetch_billing >> aggregate_costs >> detect_anomalies >> \
        compare_budget >> send_alerts >> create_tickets
