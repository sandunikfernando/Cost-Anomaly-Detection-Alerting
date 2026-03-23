const { BigQuery } = require('@google-cloud/bigquery');
require('dotenv').config({ path: './config/.env' });

async function main() {
  const bq = new BigQuery({
    projectId: process.env.PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  const query = `
    SELECT column_name, data_type
    FROM \`${process.env.PROJECT_ID}.${process.env.DATASET_ID}.INFORMATION_SCHEMA.COLUMNS\`
    WHERE table_name = 'cloud_pricing_export'
      AND column_name = 'export_time'
  `;

  const [rows] = await bq.query({ query });
  console.log(rows);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
