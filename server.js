const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '1jpUV59kY788eTwSEI-s2v2BCd_3Wul1hq8WDyWsHHTs';

app.use(express.json());

// ── CORS ───────────────────────────────────────────────────────────────────
// Must come BEFORE auth so OPTIONS preflight responds 200 without challenge.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Health check (PUBLIC) ──────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Token Auth (conditional) ───────────────────────────────────────────────
// Set AUTH_TOKEN env var on Render to engage auth. While unset, the server
// behaves as before (no auth) — safe to deploy this code before setting the
// env var so you can cut over without downtime.
//
// Token can be supplied three ways (in order of preference):
//   1. Query param:  ?token=...
//   2. Header:       Authorization: Bearer ...
//   3. Header:       X-Auth-Token: ...
const AUTH_TOKEN = process.env.AUTH_TOKEN;

function tokenAuth(req, res, next) {
  if (!AUTH_TOKEN) return next(); // auth disabled when env var unset

  const queryToken = req.query.token;
  const bearerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const headerToken = req.headers['x-auth-token'];
  const provided = queryToken || bearerToken || headerToken;

  if (provided && provided === AUTH_TOKEN) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

if (AUTH_TOKEN) {
  console.log('[server] Token auth ENABLED');
} else {
  console.log('[server] Token auth DISABLED — set AUTH_TOKEN to enable');
}

// ── Static PWA files (PUBLIC for now) ──────────────────────────────────────
// Harmless if public/ doesn't exist yet. When the redesigned PWA is bundled
// in, revisit whether browser-side auth is needed (cookie session, etc.).
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ── Google Sheets auth ─────────────────────────────────────────────────────
function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

function addWordInBackground({ italian, english, context, addedDate }) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const today = addedDate || new Date().toISOString().slice(0, 10);

  sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A:A',
  }).then(existing => {
    const rows = existing.data.values || [];
    if (rows.some(r => r[0]?.toLowerCase() === italian.toLowerCase())) {
      console.log(`"${italian}" already in list`);
      return;
    }
    return sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[italian, english, context || '', 0, today, today]]
      }
    }).then(() => {
      console.log(`Added "${italian}"`);
    });
  }).catch(err => {
    console.error(`Error adding "${italian}":`, err.message);
  });
}

// ── Protected endpoints — tokenAuth gate ───────────────────────────────────
app.get('/add', tokenAuth, async (req, res) => {
  try {
    addWordInBackground(req.query);
    res.json({ status: 'ok', message: `Adding "${req.query.italian}"` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/add', tokenAuth, async (req, res) => {
  try {
    addWordInBackground(req.body);
    res.json({ status: 'ok', message: `Adding "${req.body.italian}"` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── MCP STREAMABLE HTTP TRANSPORT ──────────────────────────────────────────
app.post('/mcp', tokenAuth, async (req, res) => {
  const body = req.body;
  const requests = Array.isArray(body) ? body : [body];
  const responses = [];

  for (const request of requests) {
    const { method, id, params } = request;

    if (id === undefined) continue;

    if (method === 'initialize') {
      responses.push({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'italiano-vocab', version: '1.0.0' }
        }
      });
      continue;
    }

    if (method === 'tools/list') {
      responses.push({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [{
            name: 'add_vocab',
            description: 'Add an Italian vocabulary word to the user\'s Google Sheet',
            inputSchema: {
              type: 'object',
              properties: {
                italian: { type: 'string', description: 'The Italian word or phrase' },
                english: { type: 'string', description: 'The English translation' },
                context: { type: 'string', description: 'An example sentence in Italian' },
                addedDate: { type: 'string', description: 'Date in YYYY-MM-DD format' }
              },
              required: ['italian', 'english']
            }
          }]
        }
      });
      continue;
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      if (name === 'add_vocab') {
        addWordInBackground(args);
        responses.push({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `✓` }] }
        });
        continue;
      }
    }

    responses.push({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' }
    });
  }

  if (responses.length === 0) return res.status(204).end();
  res.json(responses.length === 1 ? responses[0] : responses);
});

app.get('/mcp', (req, res) => {
  res.status(405).json({ error: 'Use POST for MCP Streamable HTTP transport' });
});

app.listen(PORT, () => console.log(`Vocab server running on port ${PORT}`));
