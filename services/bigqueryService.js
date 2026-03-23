const { BigQuery } = require('@google-cloud/bigquery');
require('dotenv').config({ path: './config/.env' });

class BigQueryService {
  constructor() {
    this.bigquery = new BigQuery({
      projectId: process.env.PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    this.datasetId = process.env.DATASET_ID;
    this.tableId = process.env.TABLE_ID;
  }

  /**
   * Fetch daily cost data from BigQuery billing table
   * @param {Date} startDate - Start date for data fetch
   * @param {Date} endDate - End date for data fetch
   * @returns {Promise<Array>} Array of billing records
   */
  async fetchBillingData(startDate, endDate) {
    try {
      const query = `
        SELECT
          DATE(export_time) AS date,
          export_time,
          billing_account_id,
          service,
          sku,
          list_price
        FROM \`${this.datasetId}.${this.tableId}\`
        WHERE DATE(export_time) BETWEEN @startDate AND @endDate
        ORDER BY date DESC
        LIMIT 50
      `;

      const options = {
        query: query,
        params: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
        },
      };

      const [rows] = await this.bigquery.query(options);
      console.log(`Fetched ${rows.length} billing records`);
      return rows;
    } catch (error) {
      console.error('Error fetching billing data:', error);
      throw error;
    }
  }

  /**
   * Get total cost for a specific date range
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise<number>} Total cost
   */
  async getTotalCost(startDate, endDate) {
    try {
      const query = `
        SELECT
          SUM(IFNULL(list_price.tiered_rates[SAFE_OFFSET(0)].usd_amount, 0)) as total_cost
        FROM \`${this.datasetId}.${this.tableId}\`
        WHERE DATE(export_time) BETWEEN @startDate AND @endDate
      `;

      const options = {
        query: query,
        params: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
        },
      };

      const [rows] = await this.bigquery.query(options);
      return rows[0].total_cost || 0;
    } catch (error) {
      console.error('Error getting total cost:', error);
      throw error;
    }
  }

  /**
   * Get cost breakdown by service
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise<Array>} Cost by service
   */
  async getCostByService(startDate, endDate) {
    try {
      const query = `
        SELECT
          service as service,
          SUM(IFNULL(list_price.tiered_rates[SAFE_OFFSET(0)].usd_amount, 0)) as total_cost
        FROM \`${this.datasetId}.${this.tableId}\`
        WHERE DATE(export_time) BETWEEN @startDate AND @endDate
        GROUP BY service
        ORDER BY total_cost DESC
      `;

      const options = {
        query: query,
        params: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
        },
      };

      const [rows] = await this.bigquery.query(options);
      return rows;
    } catch (error) {
      console.error('Error getting cost by service:', error);
      throw error;
    }
  }

  /**
   * Get aggregated daily cost per project/team (billing_account_id).
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise<Array<{date: string, projectId: string, cost: number}>>}
   */
  async getCostByProject(startDate, endDate) {
    try {
      const query = `
        SELECT
          DATE(export_time) AS date,
          billing_account_id AS project_id,
          SUM(IFNULL(list_price.tiered_rates[SAFE_OFFSET(0)].usd_amount, 0)) AS total_cost
        FROM \`${this.datasetId}.${this.tableId}\`
        WHERE DATE(export_time) BETWEEN @startDate AND @endDate
        GROUP BY date, billing_account_id
        ORDER BY project_id, date
      `;

      const options = {
        query: query,
        params: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
        },
      };

      const [rows] = await this.bigquery.query(options);
      // Normalize field names for consumers
      return rows.map((r) => ({
        date: r.date ? r.date.toISOString().split('T')[0] : null,
        projectId: r.project_id,
        cost: Number(r.total_cost || 0),
      }));
    } catch (error) {
      console.error('Error getting cost by project:', error);
      throw error;
    }
  }
}

module.exports = BigQueryService;
