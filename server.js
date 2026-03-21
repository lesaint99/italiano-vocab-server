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

async function addWordToSheet({ italian, english, context, addedDate }) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const today = addedDate || new Date().toISOString().slice(0, 10);

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A:A',
  });

  const rows = existing.data.values || [];
  if (rows.some(r => r[0]?.toLowerCase() === italian.toLowerCase())) {
    return { status: 'exists', message: `"${italian}" already in list` };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A:F',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[italian, english, context || '', 0, today, today]]
    }
  });

  return { status: 'ok', message: `Added "${italian}"` };
}

// Existing GET endpoint
app.get('/add', async (req, res) => {
  try {
    const result = await addWordToSheet(req.query);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Existing POST endpoint
app.post('/add', async (req, res) => {
  try {
    const result = await addWordToSheet(req.body);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── MCP STREAMABLE HTTP TRANSPORT ──────────────────────────────────────────
// Single endpoint handles all MCP communication

app.post('/mcp', async (req, res) => {
  const body = req.body;

  // Handle batch requests (array) or single request
  const requests = Array.isArray(body) ? body : [body];
  const responses = [];

  for (const request of requests) {
    const { method, id, params } = request;

    // Notifications have no id and don't need a response
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
        try {
          const result = await addWordToSheet(args);
          responses.push({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: result.message }] }
          });
        } catch (err) {
          responses.push({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: `Error: ${err.message}` }] }
          });
        }
        continue;
      }
    }

    // Unknown method
    responses.push({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' }
    });
  }

  if (responses.length === 0) {
    return res.status(204).end();
  }

  res.json(responses.length === 1 ? responses[0] : responses);
});

// MCP GET endpoint for session init (Streamable HTTP spec)
app.get('/mcp', (req, res) => {
  res.status(405).json({ error: 'Use POST for MCP Streamable HTTP transport' });
});

// ────────────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`Vocab server running on port ${PORT}`));
