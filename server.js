const express = require('express');
const { google } = require('googleapis');
const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '1jpUV59kY788eTwSEI-s2v2BCd_3Wul1hq8WDyWsHHTs';

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

// Fire-and-forget — does not block the response
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

// Existing GET endpoint
app.get('/add', async (req, res) => {
  try {
    addWordInBackground(req.query);
    res.json({ status: 'ok', message: `Adding "${req.query.italian}"` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Existing POST endpoint
app.post('/add', async (req, res) => {
  try {
    addWordInBackground(req.body);
    res.json({ status: 'ok', message: `Adding "${req.body.italian}"` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── MCP STREAMABLE HTTP TRANSPORT ──────────────────────────────────────────

app.post('/mcp', async (req, res) => {
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
        // Respond immediately, write to sheet in background
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

// ────────────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`Vocab server running on port ${PORT}`));
