const express = require('express');
const { google } = require('googleapis');
const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '1jpUV59kY788eTwSEI-s2v2BCd_3Wul1hq8WDyWsHHTs';

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
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

// ─── MCP SSE TRANSPORT ───────────────────────────────────────────────────────

// Store SSE clients
const clients = new Map();
let clientIdCounter = 0;

// MCP SSE endpoint - Claude connects here first
app.get('/mcp', (req, res) => {
  const clientId = ++clientIdCounter;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.set(clientId, res);

  // Send endpoint event to tell Claude where to POST messages
  const postUrl = `https://${req.get('host')}/mcp/message?clientId=${clientId}`;
  res.write(`event: endpoint\ndata: ${JSON.stringify({ uri: postUrl })}\n\n`);

  req.on('close', () => {
    clients.delete(clientId);
  });
});

// MCP message endpoint - Claude POSTs JSON-RPC messages here
app.post('/mcp/message', async (req, res) => {
  const clientId = parseInt(req.query.clientId);
  const sseRes = clients.get(clientId);
  const { method, id, params } = req.body;

  res.status(202).end();

  async function sendResult(result) {
    if (!sseRes) return;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
    sseRes.write(`event: message\ndata: ${msg}\n\n`);
  }

  async function sendError(code, message) {
    if (!sseRes) return;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
    sseRes.write(`event: message\ndata: ${msg}\n\n`);
  }

  if (method === 'initialize') {
    await sendResult({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'italiano-vocab', version: '1.0.0' }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    await sendResult({
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
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    if (name === 'add_vocab') {
      try {
        const result = await addWordToSheet(args);
        await sendResult({
          content: [{ type: 'text', text: result.message }]
        });
      } catch (err) {
        await sendResult({
          content: [{ type: 'text', text: `Error: ${err.message}` }]
        });
      }
      return;
    }
  }

  await sendError(-32601, 'Method not found');
});

// ────────────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`Vocab server running on port ${PORT}`));
