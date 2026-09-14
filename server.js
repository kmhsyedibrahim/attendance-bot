const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

// ---------- CONFIG ----------
const VERIFY_TOKEN = 'myAttendanceBot123';
const WHATSAPP_TOKEN = 'EAAPazQdnhX4BSVCXMZAJyHQu3dHDZCy1p4R2IpsvpotZCuCav2Jlc5ZBILPvXEwhysAfrCN9dhOStiUZBDUU8qq62ZCu4WVA8XJeg0CgG3bZB575ZAB0EViQHWZAei4dDGZCYJQvMZCaGT6FNxUsFZAlVqCxn0zGZAQBeIqj9khs73lr0afKZBPawo23UoZCHnw0C4gEZBo6vwZDZD';
const PHONE_NUMBER_ID = '1261057750432639';
const SHEET_ID = '154I8a9o4k9kkH2v-JS3nxnlJks-TFbfOX_lVGR4nm5k';

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const EMPLOYEES = {
  '917826055489': { name: 'Irfan', tab: 'IRF' },
  '918778274487': { name: 'Rasheed', tab: 'RAS' },
  '917010171009': { name: 'Jaffer', tab: 'JAF' },
  '919042084992': { name: 'Harris', tab: 'HAR' },
  '918300635880': { name: 'KSI', tab: 'KSI' },
};

const COLUMN_MAP = {
  half: 'D',
  leave: 'E',
  morning_in: 'B',
  morning_out: 'C',
  evening_in: 'F',
  evening_out: 'G',
};
// -----------------------------

app.get('/', (req, res) => {
  res.send('Attendance bot is running ✅');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
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
        type: 'list',
        body: {
          text: '*Attendance*',
        },
        action: {
          button: 'Select Shift',
          sections: [
            {
              title: 'Options',
              rows: [
                { id: 'half', title: 'Half Day Leave' },
                { id: 'leave', title: 'Full Day Leave' },
                { id: 'morning_in', title: 'Morning In' },
                { id: 'morning_out', title: 'Morning Out' },
                { id: 'evening_in', title: 'Evening In' },
                { id: 'evening_out', title: 'Evening Out' },
              ],
            },
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
  const options = { timeZone: 'Asia/Kolkata', month: 'numeric', day: 'numeric' };
  const target = today.toLocaleDateString('en-US', options);

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
    console.log('Sending options to', from);
    await sendButtons(from);
    return;
  }

  if (message.type === 'interactive') {
    const buttonId = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
    const column = COLUMN_MAP[buttonId];
    if (!column) return;

    const row = await findTodayRow(employee.tab);
    if (!row) return sendText(from, "⚠️ Today's row not found in sheet. Contact admin.");

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', month: 'numeric', day: 'numeric' });
    const currentHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));

    // Handle Half Day Leave selection
    if (buttonId === 'half') {
      await writeTime(employee.tab, row, 'D', 'TRUE');  
      await writeTime(employee.tab, row, 'E', 'FALSE'); 
      await sendText(from, `✅ *Half Day Leave* (Date: ${dateStr}) - ${employee.name}`);
      return;
    }

    // Handle Full Day Leave selection
    if (buttonId === 'leave') {
      await writeTime(employee.tab, row, 'E', 'TRUE');  
      await writeTime(employee.tab, row, 'D', 'FALSE'); 
      await sendText(from, `✅ *Full Day Leave* (Date: ${dateStr}) - ${employee.name}`);
      return;
    }

    // Restriction 1: If Full Day Leave is already marked, block everything
    const fullLeaveMarked = await getCellValue(employee.tab, row, 'E');
    if (fullLeaveMarked === 'TRUE') {
      return sendText(from, `⚠️ You are on Full Day Leave today (${dateStr})!`);
    }

    // Restriction 2: Half Day Leave Time-based restriction logic
    const halfLeaveMarked = await getCellValue(employee.tab, row, 'D');
    if (halfLeaveMarked === 'TRUE') {
      // If Half Day was marked before 12 PM (Morning Half Leave), Evening In/Out is allowed, but Morning In/Out is blocked
      if (currentHour < 12 && (buttonId === 'morning_in' || buttonId === 'morning_out')) {
        return sendText(from, `⚠️ You took Half Day Leave in the morning. Morning shift timings cannot be recorded.`);
      }
      // If Half Day was marked at/after 1 PM (Afternoon Half Leave), Morning In/Out is allowed, but Evening In/Out is blocked
      if (currentHour >= 13 && (buttonId === 'evening_in' || buttonId === 'evening_out')) {
        return sendText(from, `⚠️ You took Half Day Leave in the afternoon. Evening shift timings cannot be recorded.`);
      }
    }

    const existing = await getCellValue(employee.tab, row, column);
    if (existing) return sendText(from, `⚠️ Already marked at ${existing}. Contact admin to fix.`);

    const timeStr = now.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    await writeTime(employee.tab, row, column, timeStr);
    await sendText(from, `✅ Attendance Marked: ${employee.name} *${timeStr}* (Date: ${dateStr})`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Server running on port ' + PORT));
