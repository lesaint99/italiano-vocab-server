const express = require('express');
const { google } = require('googleapis');
const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '1jpUV59kY788eTwSEI-s2v2BCd_3Wul1hq8WDyWsHHTs';

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
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

async function addWord({ italian, english, context, addedDate }, res) {
  if (!italian || !english) {
    return res.status(400).json({ status: 'error', message: 'Missing italian or english' });
  }
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const today = addedDate || new Date().toISOString().slice(0, 10);

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:A',
    });

    const rows = existing.data.values || [];
    if (rows.some(r => r[0]?.toLowerCase() === italian.toLowerCase())) {
      return res.json({ status: 'exists', message: `"${italian}" already in list` });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[italian, english, context || '', 0, today, today]]
      }
    });

    res.json({ status: 'ok', message: `Added "${italian}"` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
}

// Existing GET endpoint
app.get('/add', async (req, res) => {
  await addWord(req.query, res);
});

// Existing POST endpoint
app.post('/add', async (req, res) => {
  await addWord(req.body, res);
});

// ─── MCP ENDPOINT ───────────────────────────────────────────────────────────

// MCP discovery
app.get('/', (req, res) => {
  res.json({
    name: 'italiano-vocab',
    version: '1.0.0',
    description: 'Add Italian vocabulary words to Google Sheets',
  });
});

// MCP handler
app.post('/mcp', (req, res) => {
  const { method, id } = req.body;

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'italiano-vocab', version: '1.0.0' }
      }
    });
  }

  if (method === 'notifications/initialized') {
    return res.status(200).end();
  }

  if (method === 'tools/list') {
    return res.json({
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
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = req.body.params;
    if (name === 'add_vocab') {
      const auth = getAuth();
      const sheets = google.sheets({ version: 'v4', auth });
      const today = args.addedDate || new Date().toISOString().slice(0, 10);

      sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A:A',
      }).then(existing => {
        const rows = existing.data.values || [];
        if (rows.some(r => r[0]?.toLowerCase() === args.italian.toLowerCase())) {
          return res.json({
            jsonrpc: '2.0', id,
            result: { content: [{ type: 'text', text: `"${args.italian}" already in your vocab list` }] }
          });
        }
        return sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Sheet1!A:F',
          valueInputOption: 'RAW',
          requestBody: { values: [[args.italian, args.english, args.context || '', 0, today, today]] }
        }).then(() => {
          res.json({
            jsonrpc: '2.0', id,
            result: { content: [{ type: 'text', text: `Added "${args.italian}" (${args.english})` }] }
          });
        });
      }).catch(err => {
        res.json({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: `Error: ${err.message}` }] }
        });
      });
      return;
    }
  }

  res.status(404).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
});

// ────────────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`Vocab server running on port ${PORT}`));
