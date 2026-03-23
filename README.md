# Cost Anomaly Detection & Alerting System

Automated system for monitoring cloud billing data and detecting cost anomalies using Google BigQuery, Node.js, and Apache Airflow.

---

## ✅ What This Project Provides

- Fetch daily cost data from BigQuery
- Aggregate cost by project/team (billing account)
- Detect anomalies using rolling statistics (z-score + % increase)
- Compare actual spend against configured budgets
- Send Slack alerts (and optional email alerts)
- Create GitHub issue tickets for investigation
- Orchestrate the workflow using an Airflow DAG

---

## 1) Prerequisites

- Node.js (v14 or higher)
- Google Cloud Project with BigQuery enabled
- Service Account with BigQuery Data Viewer permissions
- GCP Billing export enabled to BigQuery

---

## 2) Google Cloud Setup

1. **Create a Service Account:**
   ```bash
   gcloud iam service-accounts create bq-data-reader \
     --description="Service account for reading BigQuery billing data" \
     --display-name="BQ Data Reader"
   ```

2. **Grant BigQuery Data Viewer role:**
   ```bash
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:bq-data-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.dataViewer"
   ```

3. **Download Service Account Key:**
   - Go to IAM & Admin > Service Accounts
   - Click on the service account
   - Go to Keys tab
   - Create new key (JSON)
   - Save as `bq-data-reader-key.json` in the project root

4. **Enable GCP Billing Export to BigQuery:**
   - Go to Billing > Billing export
   - Configure export to BigQuery
   - Note the dataset and table names

---

## 3) Environment Configuration

Update `config/.env` with your actual values.

Example:

```env
GOOGLE_APPLICATION_CREDENTIALS=./bq-data-reader-key.json
PROJECT_ID=your-gcp-project-id
DATASET_ID=your-billing-dataset-name
TABLE_ID=gcp_billing_export_v1_YOUR_BILLING_ACCOUNT_ID
```

### 3.1) Alerting & Ticketing Configuration

The repository includes placeholders for Slack, email, and GitHub in `config/.env`.

```env
# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXXX/YYYY/ZZZZ

# Email (optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@example.com
SMTP_PASSWORD=yourpassword
ALERT_EMAIL_FROM=alerts@example.com
ALERT_EMAIL_TO=team@example.com

# GitHub (for creating investigation tickets)
GITHUB_TOKEN=ghp_xxx
GITHUB_REPO=your-org/your-repo
```

---

## 4) Budget Configuration (Step 4)

Define project/team budgets in `config/budgets.json` (sample values included):

```json
{
  "hireup-backend": 100,
  "ml-service": 200,
  "etl-pipeline": 150
}
```

The system compares the latest daily cost for each project against its budget and flags it if the budget is exceeded.

---

## 5) Install Dependencies

```bash
npm install
```

---

## 6) Run the Pipeline (Local / Manual)

The main entrypoint is `index.js`.

### 6.1 Run Full Pipeline (Fetch, Detect, Compare, Alert, Ticket)

```bash
node index.js
```

### 6.2 Run with Specific Date Range

```bash
node index.js --start=2026-03-01 --end=2026-03-18
```

### 6.3 Run Just Alerts / Ticketing (useful in Airflow tasks)

```bash
node index.js --steps=alert,ticket --end=2026-03-18 --start=2026-02-16 --sendEmail=true
```

---

## 7) Airflow DAG (Step 4)

The Airflow DAG is defined in `dags/cost_anomaly_dag.py`.

### 7.1 Configure the DAG

Update the `PROJECT_DIR` variable in `dags/cost_anomaly_dag.py` to match your repo path.

### 7.2 DAG Behavior

- **Task 1:** Fetch + aggregate + run anomaly detection + compare budgets
- **Task 2:** Send alerts (Slack/email) and create GitHub tickets

---

## Project Structure

```
├── config/
│   ├── .env
│   └── budgets.json
├── dags/
│   └── cost_anomaly_dag.py
├── services/
│   ├── alertService.js
│   ├── anomalyService.js
│   ├── bigqueryService.js
│   ├── budgetService.js
│   └── githubService.js
├── index.js
├── package.json
├── step2_aggregate.py
├── step3_anomaly.py
└── bq-data-reader-key.json
```

---

## Notes

- **Credentials**: Keep `bq-data-reader-key.json` and `.env` out of version control (add to `.gitignore`).
- **Budget Definition**: Budgets are treated as daily spend limits; adjust as needed.
- **Airflow**: The DAG uses `BashOperator` to call the Node.js pipeline; you can replace this with a Python operator if desired.
