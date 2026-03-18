'use strict'; //strict mode - catch common mistakes like undeclared variables

const { BigQuery } = require('@google-cloud/bigquery');
const logger = require('../utils/logger');

let bigqueryClient = null;

//return a BigQuery client instance, creating it if it doesn’t exist yet
function getBigQueryClient() {
  if (bigqueryClient) return bigqueryClient;

  const options = {
    projectId: process.env.GCP_PROJECT_ID,
  };

  if (process.env.GCP_KEY_FILE) {
    options.keyFilename = process.env.GCP_KEY_FILE;
  }

  bigqueryClient = new BigQuery(options);
  
  logger.info(`BigQuery client initialized for project: ${process.env.GCP_PROJECT_ID}`);
  return bigqueryClient;
}

module.exports = { getBigQueryClient };
