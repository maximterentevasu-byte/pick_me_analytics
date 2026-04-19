// заменяй файл src/weeklyReport.js этим содержимым
require("dotenv").config();

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram");
const { google } = require("googleapis");

async function initTelegram() {
  const client = new TelegramClient(
    new StringSession(process.env.TG_STRING_SESSION),
    Number(process.env.TG_API_ID),
    process.env.TG_API_HASH,
    { connectionRetries: 5 }
  );
  await client.connect();
  return client;
}

async function initGoogleSheets() {
  if (
    !process.env.GOOGLE_SHEET_ID ||
    !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !process.env.GOOGLE_PRIVATE_KEY
  ) return null;

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}

async function appendToGoogleSheet(sheets, rows) {
  if (!sheets) return;

  const header = [
    "Дата начала недели","Дата конца недели","Канал","Подписчики",
    "Средний охват поста","Средний просмотр поста","ER (по просмотрам) %",
    "ER (по активностям) %","Ср. кол-во реакций","Ср. кол-во комментариев",
    "Ср. кол-во репостов","Кол-во постов","Средний охват сторис",
    "Средний просмотр сторис","ER сторис (по просмотрам) %",
    "ER сторис (по активностям) %","Кол-во сторис",
    "Доля пользователей с включёнными уведомлениями %"
  ];

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A1:A1"
  });

  if (!existing.data.values) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "weekly_stats!A1",
      valueInputOption: "RAW",
      requestBody: { values: [header] }
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A2",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows }
  });
}

async function getChannelStats(client, channelUsername) {
  console.log(`Собираю: ${channelUsername}`);

  const entity = await client.getEntity(channelUsername);
  const full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));

  const subscribers = full.fullChat.participantsCount || 0;
  const posts = await client.getMessages(entity, { limit: 50 });
  const validPosts = posts.filter(p => p.message);

  const views = validPosts.map(p => p.views || 0);
  const reactions = validPosts.map(p => p.reactions?.results?.reduce((a, r) => a + r.count, 0) || 0);
  const forwards = validPosts.map(p => p.forwards || 0);

  const avgViews = avg(views);
  const avgReactions = avg(reactions);
  const avgForwards = avg(forwards);

  const erViews = subscribers ? (avgViews / subscribers) * 100 : 0;
  const erActions = subscribers ? ((avgReactions + avgForwards) / subscribers) * 100 : 0;

  console.log(`OK: ${channelUsername}`);

  return { subscribers, avgViews, avgReactions, avgForwards, erViews, erActions, postsCount: validPosts.length };
}

function avg(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);
  monday.setDate(now.getDate() + diff - 7);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10)
  };
}

async function main() {
  const client = await initTelegram();
  const sheets = await initGoogleSheets();

  const channels = process.env.CHANNELS.split(",").map(c => c.trim());
  const week = getWeekRange();

  const rows = [];

  for (const channel of channels) {
    const s = await getChannelStats(client, channel);
    rows.push([
      week.start, week.end, channel,
      s.subscribers, s.avgViews, s.avgViews,
      Number(s.erViews.toFixed(2)),
      Number(s.erActions.toFixed(2)),
      s.avgReactions, 0, s.avgForwards,
      s.postsCount, 0,0,0,0,0,0
    ]);
  }

  await appendToGoogleSheet(sheets, rows);
  console.log("Готово.");
}

main().catch(console.error);
