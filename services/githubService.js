const dotenv = require('dotenv');
const path = require('path');
const fetch = require('node-fetch');

dotenv.config({ path: path.join(__dirname, '..', 'config', '.env') });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // expected format: owner/repo

if (!GITHUB_TOKEN) {
  // We'll allow the service to be imported even if token is missing, but operations will fail.
}

/**
 * Create a GitHub Issue in the configured repository.
 * @param {{title: string, body: string, labels?: string[]}} params
 */
async function createIssue({ title, body, labels = [] }) {
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not configured in config/.env');
  }
  if (!GITHUB_REPO) {
    throw new Error('GITHUB_REPO is not configured in config/.env (format: owner/repo)');
  }

  const url = `https://api.github.com/repos/${GITHUB_REPO}/issues`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({ title, body, labels }),
  });

  const payload = await res.json();
  if (!res.ok) {
    const message = payload && payload.message ? payload.message : res.statusText;
    throw new Error(`GitHub API error: ${res.status} ${message}`);
  }

  return payload;
}

module.exports = {
  createIssue,
};
