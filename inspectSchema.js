const {BigQuery} = require('@google-cloud/bigquery');
require('dotenv').config({path: './config/.env'});

async function main() {
  const bq = new BigQuery({
    projectId: process.env.PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // Query for one row to inspect nested fields
  const query =
    "SELECT export_time, service, sku, list_price, consumption_model_prices " +
    "FROM `" +
    process.env.PROJECT_ID +
    "." +
    process.env.DATASET_ID +
    "." +
    process.env.TABLE_ID +
    "` LIMIT 1";

  const [rows] = await bq.query({ query });
  console.log('Row sample:', JSON.stringify(rows[0], null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
