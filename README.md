# FinOps Cost Anomaly Detection & Alerting

Automatically detects unexpected GCP cloud spending and routes alerts
and investigation tickets to the right teams before costs spiral.

---

## Architecture Overview

```
GCP BigQuery  ──►  Node.js Backend (Express)  ◄──  Airflow DAG (Python)
                        │
               ┌────────┼────────┐
           Postgres   Slack   ServiceNow
          (budgets,  (alerts)  (tickets)
           state)
```

| Layer | Technology | Role |
|---|---|---|
| Data source | GCP BigQuery | Billing export |
| Orchestration | Apache Airflow (Python DAG) | Schedule & sequence |
| Business logic | Node.js + Express | All processing |
| State storage | PostgreSQL | Budgets, anomalies, history |
| Alerting | Slack Webhooks + SendGrid | Notifications |
| Ticketing | ServiceNow REST API | Investigation tracking |

---

## Project Structure

```
cost-anomaly-project/
├── backend/                      # Node.js Express API
│   ├── src/
│   │   ├── server.js             # Entry point
│   │   ├── config/
│   │   │   ├── bigquery.js       # GCP BigQuery client
│   │   │   └── database.js       # Postgres connection pool
│   │   ├── routes/
│   │   │   ├── billing.js        # /api/billing/*
│   │   │   ├── anomaly.js        # /api/anomaly/*
│   │   │   ├── budget.js         # /api/budget/*
│   │   │   ├── alerts.js         # /api/alerts/*
│   │   │   ├── tickets.js        # /api/tickets/*
│   │   │   └── health.js         # /health
│   │   ├── services/
│   │   │   ├── billingService.js   # BigQuery fetch + aggregation
│   │   │   ├── anomalyService.js   # Z-score detection
│   │   │   ├── budgetService.js    # Budget comparison
│   │   │   ├── alertService.js     # Slack + email
│   │   │   └── ticketService.js    # ServiceNow
│   │   ├── middleware/
│   │   │   ├── auth.js           # API key check
│   │   │   └── errorHandler.js   # Global error handler
│   │   ├── models/
│   │   │   └── schema.sql        # PostgreSQL table definitions
│   │   └── utils/
│   │       ├── logger.js         # Winston logger
│   │       └── statistics.js     # mean, stddev, z-score
│   ├── tests/
│   │   ├── unit/statistics.test.js
│   │   └── integration/api.test.js
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
│
├── airflow/
│   ├── dags/
│   │   └── cost_anomaly_dag.py   # Main DAG (6 tasks)
│   └── requirements.txt
│
├── docker/
│   └── postgres-init.sh          # Multi-DB bootstrap
│
├── docker-compose.yml            # Full stack
└── README.md
```

---

## Prerequisites

- Docker & Docker Compose
- GCP project with **Billing Export to BigQuery** enabled
- A GCP Service Account with roles:
  - `roles/bigquery.dataViewer`
  - `roles/bigquery.jobUser`
- Slack Incoming Webhook URL
- SendGrid API key
- ServiceNow instance (optional)

---

## Quick Start

### 1. Clone and configure

```bash
git clone <your-repo>
cd cost-anomaly-project

# Copy and fill in your secrets
cp backend/.env.example backend/.env
nano backend/.env
```

### 2. Add your GCP service account key

```bash
# Place your downloaded key file here:
cp ~/Downloads/my-sa-key.json backend/config/service-account-key.json
```

### 3. Start the full stack

```bash
docker-compose up -d
```

First boot takes ~2 minutes. This will:
- Start PostgreSQL and create both `finops_db` and `airflow_db`
- Apply the SQL schema automatically
- Start the Node.js backend on port 3000
- Initialize and start Airflow (webserver + scheduler)

### 4. Verify everything is running

```bash
# Node.js backend health
curl http://localhost:3000/health

# Airflow UI
open http://localhost:8080   # admin / admin
```

### 5. Enable the DAG

In the Airflow UI, toggle **cost_anomaly_detection** from Paused → Active.
It will run daily at 08:00 UTC, or you can trigger it manually.

---

## Manual API Testing

All endpoints require the `X-API-Key` header.

```bash
export API_KEY="your-api-key"
export DATE="2025-03-13"

# Task 1: Fetch billing from GCP
curl -X POST http://localhost:3000/api/billing/fetch \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"date\": \"$DATE\"}"

# Task 2: Aggregate by team
curl -X POST http://localhost:3000/api/billing/aggregate \
  -H "X-API-Key: $API_KEY" \
  -d "{\"date\": \"$DATE\"}" -H "Content-Type: application/json"

# Task 3: Detect anomalies
curl -X POST http://localhost:3000/api/anomaly/detect \
  -H "X-API-Key: $API_KEY" \
  -d "{\"date\": \"$DATE\"}" -H "Content-Type: application/json"

# Task 4: Compare budgets
curl -X POST http://localhost:3000/api/budget/compare \
  -H "X-API-Key: $API_KEY" \
  -d "{\"date\": \"$DATE\"}" -H "Content-Type: application/json"

# Task 5: Send alerts
curl -X POST http://localhost:3000/api/alerts/send \
  -H "X-API-Key: $API_KEY" \
  -d "{\"date\": \"$DATE\"}" -H "Content-Type: application/json"

# Task 6: Create tickets
curl -X POST http://localhost:3000/api/tickets/create \
  -H "X-API-Key: $API_KEY" \
  -d "{\"date\": \"$DATE\"}" -H "Content-Type: application/json"

# List anomalies for a date
curl "http://localhost:3000/api/anomaly/list?date=$DATE" \
  -H "X-API-Key: $API_KEY"

# Add/update a budget
curl -X POST http://localhost:3000/api/budget/upsert \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "teamId": "platform",
    "projectId": "proj-platform-prod",
    "monthlyBudget": 50000,
    "alertThreshold": 0.8,
    "ownerEmail": "platform@yourcompany.com"
  }'
```

---

## Running Tests

```bash
cd backend
npm install
npm test              # run all tests
npm test -- --coverage  # with coverage report
```

---

## How Anomaly Detection Works

Each team/project cost is compared against its own 7-day history using the **z-score method**:

```
z = (today's cost − 7-day average) / standard deviation
```

| Z-Score | Severity |
|---|---|
| < 2.5 | Normal — no alert |
| 2.5 – 3.75 | Warning |
| 3.75 – 5.0 | High |
| > 5.0 | Critical |

Thresholds are configurable via environment variables:
- `ANOMALY_ZSCORE_THRESHOLD` (default: 2.5)
- `ANOMALY_LOOKBACK_DAYS` (default: 7)
- `BUDGET_ALERT_THRESHOLD` (default: 0.80 = 80% of monthly budget)

Teams with fewer than 3 days of history are skipped (insufficient baseline).

---

## GCP Billing Labels

To map costs to teams, tag your GCP resources with a `team` label:

```bash
# Example: label a GCP project
gcloud projects add-labels proj-platform-prod --labels=team=platform
```

Resources without a `team` label are grouped under `untagged`.

---

## Airflow Variables

Set these in the Airflow UI under **Admin → Variables**:

| Variable | Description | Example |
|---|---|---|
| `COST_ANOMALY_BACKEND_URL` | Node.js backend URL | `http://nodejs-backend:3000` |
| `COST_ANOMALY_API_KEY` | Shared API key | `your-secret-key` |

---

## Troubleshooting

**BigQuery returns no data**
- Confirm billing export is enabled in GCP Console → Billing → Billing Export
- Export has a 1-day delay — always query for yesterday's date
- Verify your service account has `bigquery.dataViewer` on the billing dataset

**Anomalies not detected**
- Teams need at least 3 days of history (configurable)
- Lower `ANOMALY_ZSCORE_THRESHOLD` to increase sensitivity
- Check logs: `docker logs finops-backend`

**Slack alerts not sending**
- Test webhook: `curl -X POST $SLACK_WEBHOOK_URL -d '{"text":"test"}'`
- Verify `SLACK_WEBHOOK_URL` is set in `.env`

**Airflow tasks failing**
- Check Airflow logs in UI → DAG → Task → Logs
- Verify `COST_ANOMALY_BACKEND_URL` Airflow variable points to the running backend
- Run `curl http://localhost:3000/health` to confirm backend is up

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GCP_PROJECT_ID` | Yes | — | Your GCP project ID |
| `GCP_KEY_FILE` | Yes | — | Path to service account JSON |
| `GCP_BILLING_DATASET` | No | `billing_dataset` | BigQuery dataset name |
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `SLACK_WEBHOOK_URL` | Yes | — | Incoming webhook URL |
| `SENDGRID_API_KEY` | Yes | — | SendGrid API key |
| `ALERT_EMAIL_FROM` | Yes | — | From address for email alerts |
| `ALERT_EMAIL_TO` | Yes | — | Default recipient email |
| `SERVICENOW_INSTANCE` | No | — | ServiceNow base URL |
| `SERVICENOW_USER` | No | — | ServiceNow username |
| `SERVICENOW_PASS` | No | — | ServiceNow password |
| `ANOMALY_ZSCORE_THRESHOLD` | No | `2.5` | Detection sensitivity |
| `ANOMALY_LOOKBACK_DAYS` | No | `7` | Historical baseline window |
| `BUDGET_ALERT_THRESHOLD` | No | `0.8` | Budget % that triggers alert |
| `API_KEY` | Yes | — | Shared key for Airflow→Node.js |
=======

