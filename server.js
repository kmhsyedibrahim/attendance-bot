const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

// ---------- CONFIG ----------
const VERIFY_TOKEN = 'myAttendanceBot123';
const WHATSAPP_TOKEN = 'EAAPazQdnhX4BSTjIWG9OV8nlXar6ZBesPzjQcqaCifdUkT4QhS4hnuUjSL8UhZAi1FtZCXGcYpeVFGExkMFHCcBtEAfj8UnohRr7VyoF5TseCLZCNEdqM3w0TQktBxBaLw3dDEGAGvTKlYEvzALdMvcqCw0CwNtwJYVlw4F4djD321eRCxnqTJxTNmyHx8oalwHmNar2eefZCcJ0kwfG8gCldSqZCQRupxKvRVOY8oUYGNafQvjZBwMshicsfqOerarP3o1k4XFYj1SQESUZCgiqZBPoN';
const PHONE_NUMBER_ID = '1261057750432639';
const SHEET_ID = '154I8a9o4k9kkH2v-JS3nxnlJks-TFbfOX_lVGR4nm5k';

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const EMPLOYEES = {
  '919XXXXXXXXX': { name: 'Test', tab: 'RAS' }, // ← unga real number podunga
};

const COLUMN_MAP = {
  morning_in: 'B',
  morning_out: 'C',
  evening_in: 'F',
  evening_out: 'G',
};
// -----------------------------

// Health check route - browser-la open pannalam test panna
app.get('/', (req, res) => {
  res.send('Attendance bot is running ✅');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log('Webhook verification attempt:', { mode, token });
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully ✅');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification FAILED ❌');
    res.sendStatus(403);
  }
});

async function sendButtons(to) {
  await axios.post(
    `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Mark your attendance:' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'morning_in', title: 'Morning In' } },
            { type: 'reply', reply: { id: 'morning_out', title: 'Morning Out' } },
          ],
        },
      },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
  await axios.post(
    `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Evening:' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'evening_in', title: 'Evening In' } },
            { type: 'reply', reply: { id: 'evening_out', title: 'Evening Out' } },
          ],
        },
      },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

async function sendText(to, text) {
  await axios.post(
    `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

async function findTodayRow(tab) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A2:A100` });
  const rows = res.data.values || [];
  const today = new Date();
  const target = `${today.getMonth() + 1}/${today.getDate()}`;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] || '').includes(target)) return i + 2;
  }
  return null;
}

async function getCellValue(tab, row, column) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!${column}${row}` });
  return res.data.values ? res.data.values[0][0] : '';
}

async function writeTime(tab, row, column, timeStr) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tab}!${column}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[timeStr]] },
  });
}

app.post('/webhook', async (req, res) => {
  console.log('Webhook POST received:', JSON.stringify(req.body));
  res.sendStatus(200);

  const entry = req.body.entry?.[0]?.changes?.[0]?.value;
  const message = entry?.messages?.[0];
  if (!message) {
    console.log('No message found in payload');
    return;
  }

  const from = message.from;
  console.log('Message from:', from);
  const employee = EMPLOYEES[from];

  if (!employee) {
    console.log('Unknown number, not in EMPLOYEES list:', from);
    return;
  }

  if (message.type === 'text') {
    console.log('Sending buttons to', from);
    await sendButtons(from);
    return;
  }

  if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
    const buttonId = message.interactive.button_reply.id;
    const column = COLUMN_MAP[buttonId];
    if (!column) return;

    const row = await findTodayRow(employee.tab);
    if (!row) return sendText(from, "⚠️ Today's row not found in sheet. Contact admin.");

    const existing = await getCellValue(employee.tab, row, column);
    if (existing) return sendText(from, `⚠️ Already marked at ${existing}. Contact admin to fix.`);

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    await writeTime(employee.tab, row, column, timeStr);
    await sendText(from, `✅ ${employee.name}, recorded at ${timeStr}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Server running on port ' + PORT));
