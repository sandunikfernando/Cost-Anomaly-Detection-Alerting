CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Stores every line-item pulled from GCP BigQuery each day.
-- Populated by Airflow Task 1 (fetch_billing).
CREATE TABLE IF NOT EXISTS raw_costs (
    id               BIGSERIAL PRIMARY KEY,
    project_id       VARCHAR(100)   NOT NULL,
    project_name     VARCHAR(255),
    team             VARCHAR(100)   NOT NULL DEFAULT 'untagged',
    service_name     VARCHAR(255),
    sku_description  VARCHAR(255),
    total_cost       NUMERIC(14,4)  NOT NULL DEFAULT 0,
    currency         VARCHAR(10)    NOT NULL DEFAULT 'USD',
    cost_date        DATE           NOT NULL,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_costs_date        ON raw_costs (cost_date);
CREATE INDEX IF NOT EXISTS idx_raw_costs_team_date   ON raw_costs (team, cost_date);
CREATE INDEX IF NOT EXISTS idx_raw_costs_project     ON raw_costs (project_id, cost_date);

-- Daily spend rolled up per team + project.
-- Populated by Airflow Task 2 (aggregate_costs).
CREATE TABLE IF NOT EXISTS aggregated_costs (
    id                  BIGSERIAL PRIMARY KEY,
    team                VARCHAR(100)   NOT NULL,
    project_id          VARCHAR(100)   NOT NULL,
    total_cost          NUMERIC(14,2)  NOT NULL DEFAULT 0,
    service_breakdown   JSONB,
    cost_date           DATE           NOT NULL,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agg_costs_team_project_date
    ON aggregated_costs (team, project_id, cost_date);
CREATE INDEX IF NOT EXISTS idx_agg_costs_date
    ON aggregated_costs (cost_date);

-- Monthly spend limits per team + project.
-- Managed manually or via POST /api/budget/upsert.
CREATE TABLE IF NOT EXISTS budgets (
    id               BIGSERIAL PRIMARY KEY,
    team_id          VARCHAR(100)   NOT NULL,
    project_id       VARCHAR(100)   NOT NULL,
    monthly_budget   NUMERIC(14,2)  NOT NULL,
    alert_threshold  NUMERIC(4,2)   NOT NULL DEFAULT 0.80, -- 80%
    owner_email      VARCHAR(255),
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT budgets_team_project_uq UNIQUE (team_id, project_id)
);

-- Detected cost anomalies.
-- Populated by Airflow Task 3 (detect_anomalies).
-- Enriched by Tasks 4, 5, 6 with budget / alert / ticket info.
CREATE TABLE IF NOT EXISTS anomalies (
    id                    BIGSERIAL PRIMARY KEY,
    team                  VARCHAR(100)   NOT NULL,
    project_id            VARCHAR(100)   NOT NULL,
    detection_date        DATE           NOT NULL,
    today_cost            NUMERIC(14,2)  NOT NULL,
    avg_cost              NUMERIC(14,2)  NOT NULL,
    std_dev               NUMERIC(14,4),
    z_score               NUMERIC(10,4)  NOT NULL,
    percent_change        NUMERIC(10,2),
    severity              VARCHAR(20)    NOT NULL DEFAULT 'warning',
    service_breakdown     JSONB,

    -- Populated by Task 4 (compare_budget)
    month_to_date_spend   NUMERIC(14,2),
    budget_amount         NUMERIC(14,2),
    budget_utilization    NUMERIC(5,2),
    budget_breached       BOOLEAN        DEFAULT FALSE,
    owner_email           VARCHAR(255),

    -- Populated by Task 6 (create_ticket)
    servicenow_ticket     VARCHAR(50),

    created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT anomalies_team_project_date_uq
        UNIQUE (team, project_id, detection_date)
);

CREATE INDEX IF NOT EXISTS idx_anomalies_date       ON anomalies (detection_date);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity   ON anomalies (severity);
CREATE INDEX IF NOT EXISTS idx_anomalies_team       ON anomalies (team);

-- Tracks which alerts were sent (prevents duplicate notifications).
-- Populated by Airflow Task 5 (send_alerts).
CREATE TABLE IF NOT EXISTS alert_log (
    id           BIGSERIAL PRIMARY KEY,
    anomaly_id   BIGINT         NOT NULL REFERENCES anomalies(id) ON DELETE CASCADE,
    alert_date   DATE           NOT NULL,
    slack_sent   BOOLEAN        NOT NULL DEFAULT FALSE,
    email_sent   BOOLEAN        NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT alert_log_anomaly_uq UNIQUE (anomaly_id)
);

-- Seed Data: Sample Budgets
-- Replace with your real team/project IDs from GCP
INSERT INTO budgets (team_id, project_id, monthly_budget, alert_threshold, owner_email)
VALUES
    ('platform',    'proj-platform-prod',    50000.00, 0.80, 'platform-lead@yourcompany.com'),
    ('data',        'proj-data-prod',        30000.00, 0.80, 'data-lead@yourcompany.com'),
    ('ml',          'proj-ml-prod',          40000.00, 0.75, 'ml-lead@yourcompany.com'),
    ('frontend',    'proj-frontend-prod',    10000.00, 0.85, 'frontend-lead@yourcompany.com'),
    ('backend',     'proj-backend-prod',     25000.00, 0.80, 'backend-lead@yourcompany.com')
ON CONFLICT (team_id, project_id) DO NOTHING;
