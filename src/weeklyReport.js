require("dotenv").config();

const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { google } = require("googleapis");

const TZ_OFFSET_HOURS = Number(process.env.TZ_OFFSET_HOURS || 3); // Москва по умолчанию

function avg(arr, digits = 2) {
  if (!arr.length) return 0;
  return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(digits));
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function pct(part, total, digits = 2) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(digits));
}

function shiftToLocal(date) {
  return new Date(date.getTime() + TZ_OFFSET_HOURS * 60 * 60 * 1000);
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

// Прошлая завершённая неделя в локальной зоне с фиксированным offset:
// Пн..Вс
function weekRangeLocal() {
  const nowUtc = new Date();
  const nowLocal = shiftToLocal(nowUtc);

  const localMidnight = new Date(Date.UTC(
    nowLocal.getUTCFullYear(),
    nowLocal.getUTCMonth(),
    nowLocal.getUTCDate(),
    0, 0, 0, 0
  ));

  const day = localMidnight.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;

  const currentMondayLocal = new Date(localMidnight);
  currentMondayLocal.setUTCDate(localMidnight.getUTCDate() - daysSinceMonday);

  const startLocal = new Date(currentMondayLocal);
  startLocal.setUTCDate(currentMondayLocal.getUTCDate() - 7);

  const endExclusiveLocal = new Date(currentMondayLocal);

  const endDisplayLocal = new Date(endExclusiveLocal);
  endDisplayLocal.setUTCDate(endExclusiveLocal.getUTCDate() - 1);

  return {
    startStr: ymd(startLocal),
    endStr: ymd(endDisplayLocal),
    endExclusiveStr: ymd(endExclusiveLocal)
  };
}

function reactionsCount(message) {
  return (message?.reactions?.results || []).reduce((acc, item) => acc + (item.count || 0), 0);
}

function commentsCount(message) {
  return message?.replies?.replies || 0;
}

function toDate(message) {
  if (!message?.date) return null;

  // gramJS иногда даёт timestamp (секунды)
  if (typeof message.date === "number") {
    return new Date(message.date * 1000);
  }

  // иногда уже Date
  if (message.date instanceof Date) {
    return message.date;
  }

  // fallback
  return new Date(message.date);
}

function localDateStr(message) {
  const dt = toDate(message);
  if (!dt || Number.isNaN(dt.getTime())) return "";
  return ymd(shiftToLocal(dt));
}

async function initTelegram() {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  const session = process.env.TG_STRING_SESSION || "";

  if (!apiId || !apiHash || !session) {
    throw new Error("Проверь TG_API_ID / TG_API_HASH / TG_STRING_SESSION");
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5
  });

  await client.connect();
  return client;
}

async function initGoogleSheets() {
  if (
    !process.env.GOOGLE_SHEET_ID ||
    !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !process.env.GOOGLE_PRIVATE_KEY
  ) {
    throw new Error("Не заданы GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  }

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  await auth.authorize();

  return google.sheets({
    version: "v4",
    auth
  });
}

async function ensureSheetHeader(sheets) {
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
    "Доля пользователей с включёнными уведомлениями %",
    "Сумма просмотров постов",
    "Сумма реакций",
    "Сумма комментариев",
    "Сумма репостов",
    "Engagement на пост",
    "Реакции на 1000 просмотров",
    "Репосты на 1000 просмотров",
    "Комментариев на 1000 просмотров",
    "Виральность постов %",
    "Индекс качества контента",
    "Дата самого нового поста в выборке",
    "Дата самого старого поста в выборке"
  ];

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A1:A1"
  });

  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "weekly_stats!A1:AD1",
      valueInputOption: "RAW",
      requestBody: { values: [header] }
    });
  }
}

async function appendRows(sheets, rows) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A2",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows }
  });
}

async function getChannelStats(client, channelRef, range) {
  console.log(`Собираю: ${channelRef}`);
  console.log(`LOCAL WEEK RANGE: ${range.startStr} -> ${range.endStr} (TZ offset ${TZ_OFFSET_HOURS})`);

  const entity = await client.getEntity(channelRef);
  const full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));

  const subscribers =
    full?.fullChat?.participantsCount ||
    full?.fullChat?.participants_count ||
    full?.chats?.[0]?.participantsCount ||
    0;

  const raw = await client.getMessages(entity, { limit: 1000 });

  const candidateDates = raw
    .map((m) => localDateStr(m))
    .filter(Boolean)
    .slice(0, 10);

  console.log("TOP MESSAGE LOCAL DATES:", candidateDates.join(", "));

  const posts = raw.filter((m) => {
    const d = localDateStr(m);
    if (!d) return false;

    const inWeek = d >= range.startStr && d <= range.endStr;
    if (!inWeek) return false;

    const hasMetrics = (m?.views || 0) > 0 || (m?.forwards || 0) > 0 || reactionsCount(m) > 0;
    const hasContent = Boolean(m?.message || m?.media);

    return !m?.action && (m?.post === true || hasMetrics || hasContent);
  });

  console.log(`POSTS FOUND: ${posts.length}`);

  const newestPostDate = posts[0]?.date ? localDateStr(posts[0]) : "";
  const oldestPostDate = posts[posts.length - 1]?.date ? localDateStr(posts[posts.length - 1]) : "";

  const views = posts.map((m) => m.views || 0);
  const reactions = posts.map(reactionsCount);
  const comments = posts.map(commentsCount);
  const reposts = posts.map((m) => m.forwards || 0);

  const avgViews = avg(views);
  const avgReactions = avg(reactions);
  const avgComments = avg(comments);
  const avgReposts = avg(reposts);

  const totalViews = sum(views);
  const totalReactions = sum(reactions);
  const totalComments = sum(comments);
  const totalReposts = sum(reposts);

  const postErViews = pct(avgViews, subscribers);
  const postErActivities = pct(avgReactions + avgComments + avgReposts, subscribers);

  const engagementPerPost = posts.length
    ? Number(((totalReactions + totalComments + totalReposts) / posts.length).toFixed(2))
    : 0;

  const reactionsPer1000Views = totalViews ? Number(((totalReactions / totalViews) * 1000).toFixed(2)) : 0;
  const repostsPer1000Views = totalViews ? Number(((totalReposts / totalViews) * 1000).toFixed(2)) : 0;
  const commentsPer1000Views = totalViews ? Number(((totalComments / totalViews) * 1000).toFixed(2)) : 0;
  const viralityPct = totalViews ? Number(((totalReposts / totalViews) * 100).toFixed(2)) : 0;
  const contentQualityIndex = Number(((postErViews * 0.6) + (postErActivities * 0.4)).toFixed(2));

  console.log(`OK: ${channelRef}`);

  return {
    subscribers,
    avgReachPost: avgViews,
    avgViewsPost: avgViews,
    postErViews,
    postErActivities,
    avgReactionsPost: avgReactions,
    avgCommentsPost: avgComments,
    avgRepostsPost: avgReposts,
    postsCount: posts.length,
    avgReachStory: 0,
    avgViewsStory: 0,
    storyErViews: 0,
    storyErActivities: 0,
    storiesCount: 0,
    enabledNotificationsPct: 0,
    totalViews,
    totalReactions,
    totalComments,
    totalReposts,
    engagementPerPost,
    reactionsPer1000Views,
    repostsPer1000Views,
    commentsPer1000Views,
    viralityPct,
    contentQualityIndex,
    newestPostDate,
    oldestPostDate
  };
}

function toRow(channelRef, range, s) {
  return [
    range.startStr,
    range.endStr,
    channelRef,
    s.subscribers,
    s.avgReachPost,
    s.avgViewsPost,
    s.postErViews,
    s.postErActivities,
    s.avgReactionsPost,
    s.avgCommentsPost,
    s.avgRepostsPost,
    s.postsCount,
    s.avgReachStory,
    s.avgViewsStory,
    s.storyErViews,
    s.storyErActivities,
    s.storiesCount,
    s.enabledNotificationsPct,
    s.totalViews,
    s.totalReactions,
    s.totalComments,
    s.totalReposts,
    s.engagementPerPost,
    s.reactionsPer1000Views,
    s.repostsPer1000Views,
    s.commentsPer1000Views,
    s.viralityPct,
    s.contentQualityIndex,
    s.newestPostDate,
    s.oldestPostDate
  ];
}

async function main() {
  const channels = (process.env.CHANNELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!channels.length) {
    throw new Error("Не задан CHANNELS");
  }

  console.log("START REPORT");

  const client = await initTelegram();
  const sheets = await initGoogleSheets();
  const range = weekRangeLocal();

  const rows = [];
  for (const channel of channels) {
    const stats = await getChannelStats(client, channel, range);
    rows.push(toRow(channel, range, stats));
  }

  await ensureSheetHeader(sheets);
  await appendRows(sheets, rows);

  await client.disconnect();
  console.log("END REPORT");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
