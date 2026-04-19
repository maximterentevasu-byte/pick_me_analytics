require("dotenv").config();

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram");
const { google } = require("googleapis");

// =======================
// TELEGRAM INIT
// =======================

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

// =======================
// GOOGLE SHEETS INIT
// =======================

function initGoogleSheets() {
  if (!process.env.GOOGLE_SHEET_ID) return null;

  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  return google.sheets({ version: "v4", auth });
}

// =======================
// WRITE TO GOOGLE SHEETS
// =======================

async function appendToGoogleSheet(sheets, rows) {
  if (!sheets) return;

  const header = [
    "Дата начала недели",
    "Дата конца недели",
    "Канал",
    "Подписчики",
    "Средний охват поста",
    "Средний просмотр поста",
    "ER (по просмотрам) %",
    "ER (по активностям) %",
    "Ср. кол-во реакций",
    "Ср. кол-во комментариев",
    "Ср. кол-во репостов",
    "Кол-во постов",
    "Средний охват сторис",
    "Средний просмотр сторис",
    "ER сторис (по просмотрам) %",
    "ER сторис (по активностям) %",
    "Кол-во сторис",
    "Доля пользователей с включёнными уведомлениями %"
  ];

  // Проверяем есть ли уже заголовок
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A1:A1"
  });

  const isEmpty = !existing.data.values;

  if (isEmpty) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "weekly_stats!A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [header]
      }
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A2",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows
    }
  });
}

// =======================
// GET CHANNEL STATS
// =======================

async function getChannelStats(client, channelUsername) {
  console.log(`Собираю: ${channelUsername}`);

  const entity = await client.getEntity(channelUsername);

  const full = await client.invoke(
    new Api.channels.GetFullChannel({
      channel: entity
    })
  );

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

  return {
    subscribers,
    avgViews,
    avgReactions,
    avgForwards,
    erViews,
    erActions,
    postsCount: validPosts.length
  };
}

// =======================
// UTILS
// =======================

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day === 0 ? -6 : 1 - day);

  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday - 7);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10)
  };
}

// =======================
// MAIN
// =======================

async function main() {
  const client = await initTelegram();
  const sheets = initGoogleSheets();

  const channels = process.env.CHANNELS.split(",").map(c => c.trim());

  const week = getWeekRange();

  const rows = [];

  for (const channel of channels) {
    const stats = await getChannelStats(client, channel);

    rows.push([
      week.start,
      week.end,
      channel,
      stats.subscribers,
      stats.avgViews,
      stats.avgViews,
      Number(stats.erViews.toFixed(2)),
      Number(stats.erActions.toFixed(2)),
      stats.avgReactions,
      0,
      stats.avgForwards,
      stats.postsCount,
      0,
      0,
      0,
      0,
      0,
      0
    ]);
  }

  await appendToGoogleSheet(sheets, rows);

  console.log("Готово.");
}

main().catch(console.error);
