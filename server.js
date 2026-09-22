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
  '918778274487': { name: 'Rasheed', tab: 'RAS' },
  '917010171009': { name: 'Jaffer', tab: 'JAF' },
  '919042084992': { name: 'Harris', tab: 'HAR' },
  '918300635880': { name: 'KSI', tab: 'KSI' },
};

const COLUMN_MAP = {
  morning_leave: 'D',
  evening_leave: 'D',
  leave: 'E',
  morning_in: 'B',
  morning_out: 'C',
  evening_in: 'F',
  evening_out: 'G',
};

// Shift to Location Column Mapping (Morning In->P, Morning Out->Q, Evening In->R, Evening Out->S)
const LOCATION_COLUMN_MAP = {
  morning_in: 'P',
  morning_out: 'Q',
  evening_in: 'R',
  evening_out: 'S',
};

const pendingSelections = {};

app.get('/', (req, res) => res.send('Attendance bot is running ✅'));

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
        body: { text: '*Attendance*' },
        action: {
          button: 'Select Shift',
          sections: [
            {
              title: 'Options',
              rows: [
                { id: 'morning_in', title: 'Morning In' },
                { id: 'morning_out', title: 'Morning Out' },
                { id: 'morning_leave', title: 'Morning Leave' },
                { id: 'evening_in', title: 'Evening In' },
                { id: 'evening_out', title: 'Evening Out' },
                { id: 'evening_leave', title: 'Evening Leave' },
                { id: 'leave', title: 'Full Day Leave' },
              ],
            },
          ],
        },
      },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

async function requestLocation(to) {
  await axios.post(
    `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text: '📍 Please tap the button below to share your current location for attendance:' },
        action: { name: 'send_location' },
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

app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Fast response to prevent webhook timeout

  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return;

  const from = message.from;
  const employee = EMPLOYEES[from];
  if (!employee) return;

  // 1. Text message -> Send shift selection menu
  if (message.type === 'text') {
    await sendButtons(from);
    return;
  }

  // 2. Shift selection via Interactive List
  if (message.type === 'interactive' && message.interactive.type === 'list_reply') {
    const buttonId = message.interactive.list_reply.id;
    const column = COLUMN_MAP[buttonId];
    if (!column) return;

    const row = await findTodayRow(employee.tab);
    if (!row) return sendText(from, "⚠️ Today's row not found in sheet. Contact admin.");

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', month: 'numeric', day: 'numeric' });
    const currentHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));

    // Handle Leave options directly
    if (buttonId === 'morning_leave' || buttonId === 'evening_leave') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${employee.tab}!D${row}:E${row}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['TRUE', 'FALSE']] },
      });
      await sendText(from, `✅ Half Day Leave (Date: ${dateStr}) - ${employee.name}`);
      return;
    }

    if (buttonId === 'leave') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${employee.tab}!D${row}:E${row}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['FALSE', 'TRUE']] },
      });
      await sendText(from, `✅ *Full Day Leave* (Date: ${dateStr}) - ${employee.name}`);
      return;
    }

    // Fetch leave statuses and existing time data in parallel for speed
    const [leaveRes, existingRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${employee.tab}!D${row}:E${row}` }),
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${employee.tab}!${column}${row}` })
    ]);

    const leaveValues = leaveRes.data.values?.[0] || ['FALSE', 'FALSE'];
    if (leaveValues[1] === 'TRUE') {
      return sendText(from, `⚠️ You are on *Full Day Leave* today (Date: *${dateStr}*)!`);
    }

    if (leaveValues[0] === 'TRUE') {
      if (currentHour < 12 && (buttonId === 'morning_in' || buttonId === 'morning_out')) {
        return sendText(from, `⚠️ You took Half Day Leave in the *Morning*.`);
      }
      if (currentHour >= 13 && (buttonId === 'evening_in' || buttonId === 'evening_out')) {
        return sendText(from, `⚠️ You took Half Day Leave in the *Afternoon*.`);
      }
    }

    const existingTime = existingRes.data.values?.[0]?.[0] || '';
    if (existingTime) {
      return sendText(from, `⚠️ Already marked at ${existingTime}. Contact admin to fix.`);
    }

    // Save selection temporarily to link with upcoming location
    pendingSelections[from] = { buttonId, column, row };

    // Request Location using native button
    await requestLocation(from);
    return;
  }

  // 3. Location received -> Save Time & Shift-specific Location concurrently
  if (message.type === 'location') {
    const selection = pendingSelections[from];
    if (!selection) {
      return sendText(from, "⚠️ Please select your shift first by sending a message.");
    }

    const { buttonId, column, row } = selection;
    const locationCol = LOCATION_COLUMN_MAP[buttonId]; // P, Q, R, or S based on shift
    const locationStr = `Lat: ${message.location.latitude}, Lon: ${message.location.longitude}`;
    
    const timeStr = new Date().toLocaleTimeString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    delete pendingSelections[from];

    // Build update promises array dynamically
    const updatePromises = [
      sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${employee.tab}!${column}${row}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[timeStr]] },
      }),
      sendText(from, `✅ Attendance Marked: ${employee.name} *${timeStr}*`)
    ];

    // If it's one of the shifts that requires location, add location update promise
    if (locationCol) {
      updatePromises.push(
        sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${employee.tab}!${locationCol}${row}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[locationStr]] },
        })
      );
    }

    // Run all Google Sheet updates and WhatsApp response simultaneously for maximum speed
    await Promise.all(updatePromises);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Fast Server running on port ' + PORT));
    
