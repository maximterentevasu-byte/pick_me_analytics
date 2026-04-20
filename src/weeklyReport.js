
// STEP4 + STORIES COUNT (SAFE VERSION)

require("dotenv").config();

const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { google } = require("googleapis");

// ===== EXISTING HELPERS (UNCHANGED) =====
const avg = (a, d = 2) => a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(d)) : 0;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const pct = (a, b, d = 2) => b ? Number(((a / b) * 100).toFixed(d)) : 0;

function weekRange() {
  const now = new Date();
  const d = (now.getDay() + 6) % 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - d);
  mon.setHours(0, 0, 0, 0);
  const start = new Date(mon);
  start.setDate(mon.getDate() - 7);
  return {
    start,
    end: mon,
    startStr: start.toISOString().slice(0, 10),
    endStr: new Date(mon - 86400000).toISOString().slice(0, 10)
  };
}

// ===== NEW: STORIES COUNT =====
async function getStoriesCount(client, entity) {
  try {
    const res = await client.invoke(
      new Api.stories.GetPeerStories({ peer: entity })
    );
    return (res.stories?.stories || []).length;
  } catch (e) {
    console.log("Stories error:", e.message);
    return 0;
  }
}

// ===== CONNECTIONS =====
async function tg() {
  const c = new TelegramClient(
    new StringSession(process.env.TG_STRING_SESSION),
    Number(process.env.TG_API_ID),
    process.env.TG_API_HASH,
    { connectionRetries: 5 }
  );
  await c.connect();
  return c;
}

async function sheets() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

// ===== HEADERS =====
async function ensureHeaders(s) {

  const storiesHeader = [[
    "Дата начала недели",
    "Дата конца недели",
    "Канал",
    "Количество сторис"
  ]];

  const resStories = await s.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "stories_weekly!A1:A1"
  }).catch(() => ({ data: {} }));

  if (!resStories.data.values || resStories.data.values.length === 0) {
    await s.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "stories_weekly!A1",
      valueInputOption: "RAW",
      requestBody: { values: storiesHeader }
    });
  }
}

// ===== MAIN =====
async function main() {
  console.log("STEP4 + STORIES COUNT");

  const c = await tg();
  const s = await sheets();
  const range = weekRange();

  await ensureHeaders(s);

  const chs = process.env.CHANNELS.split(",").map(x => x.trim()).filter(Boolean);

  for (const ch of chs) {
    console.log("CHANNEL:", ch);

    const entity = await c.getEntity(ch);
    const storiesCount = await getStoriesCount(c, entity);

    await s.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "stories_weekly!A2",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          range.startStr,
          range.endStr,
          ch,
          storiesCount
        ]]
      }
    });

    console.log("STORIES:", storiesCount);
  }

  await c.disconnect();
  console.log("DONE");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
