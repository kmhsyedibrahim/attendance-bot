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

// Helper to delete a WhatsApp message (Revoke / Delete for everyone)
async function deleteWhatsAppMessage(messageId) {
  try {
    await axios.delete(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        data: {
          messaging_product: 'whatsapp',
          status: 'deleted',
          message_id: messageId
        }
      }
    );
  } catch (err) {
    // Sometimes deletion fails if message is too old, ignore safely
  }
}

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

// Native One-Tap Location Request Message (Returns message_id so we can delete it later)
async function requestLocation(to) {
  try {
    const res = await axios.post(
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
    return res.data?.messages?.[0]?.id || null;
  } catch (err) {
    return null;
  }
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

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const entry = req.body.entry?.[0]?.changes?.[0]?.value;
  const message = entry?.messages?.[0];
  if (!message) return;

  const from = message.from;
  const employee = EMPLOYEES[from];
  if (!employee) return;

  // 1. If user sends text, send shift selection list
  if (message.type === 'text') {
    await sendButtons(from);
    return;
  }

  // 2. If user selects options from the shift list
  if (message.type === 'interactive' && message.interactive.type === 'list_reply') {
    const buttonId = message.interactive.list_reply.id;
    const column = COLUMN_MAP[buttonId];
    if (!column) return;

    const row = await findTodayRow(employee.tab);
    if (!row) return sendText(from, "⚠️ Today's row not found in sheet. Contact admin.");

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', month: 'numeric', day: 'numeric' });
    const currentHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));

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

    const fullLeaveMarked = await getCellValue(employee.tab, row, 'E');
    if (fullLeaveMarked === 'TRUE') {
      return sendText(from, `⚠️ You are on *Full Day Leave* today (Date: *${dateStr}*)!`);
    }

    const halfLeaveMarked = await getCellValue(employee.tab, row, 'D');
    if (halfLeaveMarked === 'TRUE') {
      if (currentHour < 12 && (buttonId === 'morning_in' || buttonId === 'morning_out')) {
        return sendText(from, `⚠️ You took Half Day Leave in the *Morning*. Morning shift timings cannot be recorded.`);
      }
      if (currentHour >= 13 && (buttonId === 'evening_in' || buttonId === 'evening_out')) {
        return sendText(from, `⚠️ You took Half Day Leave in the *Afternoon*. Evening shift timings cannot be recorded.`);
      }
    }

    const existing = await getCellValue(employee.tab, row, column);
    if (existing) return sendText(from, `⚠️ Already marked at ${existing}. Contact admin to fix.`);

    // Request Location and get the bot message ID so we can delete it later
    const sentMessageId = await requestLocation(from);

    // Save selection temporarily along with bot's prompt message ID
    pendingSelections[from] = { buttonId, column, row, sentMessageId };
    return;
  }

  // 3. If user shares location
  if (message.type === 'location') {
    const selection = pendingSelections[from];
    if (!selection) {
      return sendText(from, "⚠️ Please select your shift first by sending a message or clicking options.");
    }

    const { column, row, sentMessageId } = selection;
    const employeeLat = message.location.latitude;
    const employeeLon = message.location.longitude;
    const locationStr = `Lat: ${employeeLat}, Lon: ${employeeLon}`;
    const userLocationMsgId = message.id; // User's shared location message ID

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    delete pendingSelections[from];

    // Execute everything concurrently: Update Google Sheets, Send Success Text, AND Delete the unwanted messages from chat
    await Promise.all([
      sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${employee.tab}!${column}${row}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[timeStr]] },
      }),
      sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${employee.tab}!P${row}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[locationStr]] },
      }),
      sendText(from, `✅ Attendance Marked: ${employee.name} *${timeStr}*`),
      // Clean up chat: Delete bot's location prompt & user's location message
      sentMessageId ? deleteWhatsAppMessage(sentMessageId) : Promise.resolve(),
      deleteWhatsAppMessage(userLocationMsgId)
    ]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Server running on port ' + PORT));
