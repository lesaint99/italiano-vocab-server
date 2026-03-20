const express = require('express');
const { google } = require('googleapis');
const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '1jpUV59kY788eTwSEI-s2v2BCd_3Wul1hq8WDyWsHHTs';

app.use(express.json());

// Allow requests from Claude artifacts
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

// Existing GET endpoint (unchanged)
app.get('/add', async (req, res) => {
  await addWord(req.query, res);
});

// New POST endpoint for artifact calls
app.post('/add', async (req, res) => {
  await addWord(req.body, res);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`Vocab server running on port ${PORT}`));
