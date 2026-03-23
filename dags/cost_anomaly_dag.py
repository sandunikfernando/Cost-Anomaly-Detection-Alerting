from airflow import DAG
from airflow.operators.bash import BashOperator
from datetime import datetime, timedelta

# Update this path to your repository root where `index.js` lives
PROJECT_DIR = '/path/to/your/repo'

default_args = {
    'owner': 'finops',
    'depends_on_past': False,
    'start_date': datetime(2026, 1, 1),
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}

with DAG(
    'cost_anomaly_detection',
    default_args=default_args,
    description='Daily cost anomaly detection with Slack + GitHub alerts',
    schedule_interval='@daily',
    catchup=False,
    max_active_runs=1,
) as dag:

    fetch_and_detect = BashOperator(
        task_id='fetch_and_detect',
        bash_command=(
            f'cd {PROJECT_DIR} && '
            'node index.js --steps=fetch,anomaly,budget '
            '--end={{ ds }} --start={{ macros.ds_add(ds, -30) }}'
        ),
    )

    send_alerts = BashOperator(
        task_id='send_alerts',
        bash_command=(
            f'cd {PROJECT_DIR} && '
            'node index.js --steps=alert,ticket '
            '--end={{ ds }} --start={{ macros.ds_add(ds, -30) }} --sendEmail=true'
        ),
    )

    fetch_and_detect >> send_alerts
