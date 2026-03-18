'use strict';

/**
 * Integration tests for the REST API routes.
 * Mocks the database and GCP services so no real credentials are needed.
 */

const request = require('supertest');

// Mock all external dependencies before requiring the app
jest.mock('../../src/config/database', () => ({
  query:       jest.fn(),
  transaction: jest.fn(),
  pool:        { query: jest.fn().mockResolvedValue({ rows: [] }), on: jest.fn() },
}));

jest.mock('../../src/config/bigquery', () => ({
  getBigQueryClient: jest.fn().mockReturnValue({
    query: jest.fn().mockResolvedValue([[]]),
  }),
}));

jest.mock('@sendgrid/mail', () => ({
  setApiKey:    jest.fn(),
  sendMultiple: jest.fn().mockResolvedValue([{ statusCode: 202 }]),
}));

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200, data: {} }),
  get:  jest.fn().mockResolvedValue({ status: 200, data: { status: 'ok', checks: {} } }),
}));

process.env.API_KEY = 'test-api-key';
process.env.NODE_ENV = 'test';

const app = require('../../src/server');
const db  = require('../../src/config/database');

const AUTH_HEADER = { 'X-API-Key': 'test-api-key' };

describe('Health Endpoint', () => {
  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
  });
});

describe('Billing Routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /api/billing/fetch — rejects missing date', async () => {
    const res = await request(app)
      .post('/api/billing/fetch')
      .set(AUTH_HEADER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  it('POST /api/billing/fetch — rejects invalid date format', async () => {
    const res = await request(app)
      .post('/api/billing/fetch')
      .set(AUTH_HEADER)
      .send({ date: '14-03-2025' });
    expect(res.status).toBe(400);
  });

  it('POST /api/billing/aggregate — rejects missing date', async () => {
    const res = await request(app)
      .post('/api/billing/aggregate')
      .set(AUTH_HEADER)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('Anomaly Routes', () => {
  it('POST /api/anomaly/detect — rejects missing date', async () => {
    const res = await request(app)
      .post('/api/anomaly/detect')
      .set(AUTH_HEADER)
      .send({});
    expect(res.status).toBe(400);
  });

  it('GET /api/anomaly/list — returns list structure', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/anomaly/list?date=2025-03-10')
      .set(AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('anomalies');
  });
});

describe('Budget Routes', () => {
  it('POST /api/budget/upsert — validates required fields', async () => {
    const res = await request(app)
      .post('/api/budget/upsert')
      .set(AUTH_HEADER)
      .send({ teamId: 'platform' }); // missing projectId + monthlyBudget
    expect(res.status).toBe(400);
  });

  it('GET /api/budget/list — returns budgets', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ team_id: 'platform', monthly_budget: 50000 }] });
    const res = await request(app)
      .get('/api/budget/list')
      .set(AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('budgets');
  });
});

describe('Authentication', () => {
  it('returns 401 when API key is missing', async () => {
    const res = await request(app)
      .post('/api/billing/fetch')
      .send({ date: '2025-03-10' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for wrong API key', async () => {
    const res = await request(app)
      .post('/api/billing/fetch')
      .set('X-API-Key', 'wrong-key')
      .send({ date: '2025-03-10' });
    expect(res.status).toBe(403);
  });
});
