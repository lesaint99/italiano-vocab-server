const express = require('express');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

const SPREADSHEET_ID = '1jpUV59kY788eTwSEI-s2v2BCd_3Wul1hq8WDyWsHHTs';

function getAuth() {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    return new google.auth.JWT(
          creds.client_email,
          null,
          creds.private_key,
          ['https://www.googleapis.com/auth/spreadsheets']
        );
}

app.get('/add', async (req, res) => {
    const { italian, english, context, addedDate } = req.query;

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
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Vocab server running on port ${PORT}`));
