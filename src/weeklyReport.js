require("dotenv").config();

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { google } = require("googleapis");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");

const CHANNELS = (process.env.CHANNELS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const OUTPUT_XLSX = process.env.OUTPUT_XLSX || "./tg_weekly_stats.xlsx";

function getWeekRange() {
  const now = new Date();
  const utc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  ));

  const day = utc.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;

  const currentMonday = new Date(utc);
  currentMonday.setUTCDate(utc.getUTCDate() - daysSinceMonday);

  const start = new Date(currentMonday);
  start.setUTCDate(currentMonday.getUTCDate() - 7);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(currentMonday);
  end.setUTCSeconds(-1);

  return { start, end };
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function safeNumber(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percent(part, total) {
  if (!total) return 0;
  return (part / total) * 100;
}

function erByViews(avgViews, subscribers) {
  if (!subscribers) return 0;
  return (avgViews / subscribers) * 100;
}

function erByActivities(avgReactions, avgComments, avgReposts, subscribers) {
  if (!subscribers) return 0;
  return ((avgReactions + avgComments + avgReposts) / subscribers) * 100;
}

function sumReactionCounts(message) {
  try {
    const results = message?.reactions?.results || [];
    return results.reduce((acc, r) => acc + (r.count || 0), 0);
  } catch {
    return 0;
  }
}

function getCommentsCount(message) {
  return message?.replies?.replies || 0;
}

function getForwardsCount(message) {
  return message?.forwards || 0;
}

function getViewsCount(message) {
  return message?.views || 0;
}

async function createTelegramClient() {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  const session = new StringSession(process.env.TG_STRING_SESSION || "");

  if (!apiId || !apiHash || !process.env.TG_STRING_SESSION) {
    throw new Error("Проверь TG_API_ID / TG_API_HASH / TG_STRING_SESSION");
  }

  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  return client;
}

async function getGoogleSheetsClient() {
  if (
    !process.env.GOOGLE_SHEET_ID ||
    !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !process.env.GOOGLE_PRIVATE_KEY
  ) {
    return null;
  }

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}

async function getChannelFull(client, channelRef) {
  const entity = await client.getEntity(channelRef);
  const full = await client.invoke(
    new Api.channels.GetFullChannel({
      channel: entity,
    })
  );
  return { entity, full };
}

async function getBroadcastStats(client, entity) {
  return client.invoke(
    new Api.stats.GetBroadcastStats({
      channel: entity,
      dark: false,
    })
  );
}

async function collectPostsStats(client, entity, start, end) {
  const posts = [];

  for await (const msg of client.iterMessages(entity, { limit: 300 })) {
    if (!msg || !msg.date) continue;

    const msgDate = new Date(msg.date);
    if (msgDate < start) break;
    if (msgDate > end) continue;
    if (msg.post !== true) continue;
    if (msg.action) continue;

    posts.push(msg);
  }

  const views = posts.map(getViewsCount);
  const reactions = posts.map(sumReactionCounts);
  const comments = posts.map(getCommentsCount);
  const reposts = posts.map(getForwardsCount);

  return {
    postsCount: posts.length,
    avgViewsPostRaw: avg(views),
    avgReactionsPost: avg(reactions),
    avgCommentsPost: avg(comments),
    avgRepostsPost: avg(reposts),
  };
}

async function fetchStoryArchive(client, entity, limit = 100) {
  try {
    const archive = await client.invoke(
      new Api.stories.GetStoriesArchive({
        peer: entity,
        offsetId: 0,
        limit,
      })
    );

    return archive?.stories || [];
  } catch (e) {
    console.warn("Не удалось получить архив сториз:", e.message);
    return [];
  }
}

async function fetchActiveStories(client, entity) {
  try {
    const peerStories = await client.invoke(
      new Api.stories.GetPeerStories({
        peer: entity,
      })
    );

    return peerStories?.stories?.stories || peerStories?.stories || [];
  } catch (e) {
    console.warn("Не удалось получить активные сториз:", e.message);
    return [];
  }
}

async function getStoriesViews(client, entity, storyIds) {
  if (!storyIds.length) return null;

  try {
    const result = await client.invoke(
      new Api.stories.GetStoriesViews({
        peer: entity,
        id: storyIds,
      })
    );
    return result;
  } catch (e) {
    console.warn("Не удалось получить просмотры сториз:", e.message);
    return null;
  }
}

function extractStoriesInRange(stories, start, end) {
  return stories.filter((story) => {
    const unix = story?.date;
    if (!unix) return false;
    const dt = new Date(unix * 1000);
    return dt >= start && dt <= end;
  });
}

function parseStoryViewsResult(storiesViewsResult) {
  const items = storiesViewsResult?.views || [];

  const normalized = items.map((v) => {
    const inner = v?.views || v || {};
    const reactions = Array.isArray(inner?.reactions)
      ? inner.reactions.reduce((acc, x) => acc + (x.count || 0), 0)
      : (inner?.reactionsCount || 0);

    return {
      views: inner?.viewsCount || inner?.views || 0,
      reposts: inner?.forwardsCount || inner?.forwards || 0,
      reactions,
    };
  });

  return {
    avgViewsStory: avg(normalized.map((x) => x.views)),
    avgReactionsStory: avg(normalized.map((x) => x.reactions)),
    avgRepostsStory: avg(normalized.map((x) => x.reposts)),
  };
}

function buildRow(channelRef, range, data) {
  return [
    formatDate(range.start),
    formatDate(range.end),
    channelRef,

    data.subscribers,
    safeNumber(data.avgReachPost),
    safeNumber(data.avgViewsPost),
    safeNumber(data.postErViews),
    safeNumber(data.postErActivities),
    safeNumber(data.avgReactionsPost),
    safeNumber(data.avgCommentsPost),
    safeNumber(data.avgRepostsPost),
    data.postsCount,

    safeNumber(data.avgReachStory),
    safeNumber(data.avgViewsStory),
    safeNumber(data.storyErViews),
    safeNumber(data.storyErActivities),
    data.storiesCount,

    safeNumber(data.enabledNotificationsPercent),
  ];
}

async function appendToGoogleSheet(sheets, rows) {
  if (!sheets) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows,
    },
  });
}

async function ensureWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  const exists = fs.existsSync(filePath);

  if (exists) {
    await workbook.xlsx.readFile(filePath);
  }

  let ws = workbook.getWorksheet("weekly_stats");
  if (!ws) {
    ws = workbook.addWorksheet("weekly_stats");
    ws.addRow([
      "week_start",
      "week_end",
      "channel",
      "subscribers",
      "avg_reach_post",
      "avg_views_post",
      "post_er_views_pct",
      "post_er_activities_pct",
      "avg_reactions_post",
      "avg_comments_post",
      "avg_reposts_post",
      "posts_count",
      "avg_reach_story",
      "avg_views_story",
      "story_er_views_pct",
      "story_er_activities_pct",
      "stories_count",
      "enabled_notifications_pct",
    ]);
  }

  return { workbook, ws };
}

async function appendToXlsx(rows) {
  const { workbook, ws } = await ensureWorkbook(OUTPUT_XLSX);
  rows.forEach((row) => ws.addRow(row));
  await workbook.xlsx.writeFile(OUTPUT_XLSX);
}

async function collectStoriesStats(client, entity, start, end, broadcastStats) {
  const activeStories = await fetchActiveStories(client, entity);
  const archiveStories = await fetchStoryArchive(client, entity, 200);

  const mergedMap = new Map();
  [...activeStories, ...archiveStories].forEach((story) => {
    if (story?.id) mergedMap.set(story.id, story);
  });

  const weeklyStories = extractStoriesInRange([...mergedMap.values()], start, end);
  const storyIds = weeklyStories.map((s) => s.id);

  const viewsResult = await getStoriesViews(client, entity, storyIds);
  const detailed = parseStoryViewsResult(viewsResult);

  const avgViewsStory =
    detailed.avgViewsStory || Number(broadcastStats?.viewsPerStory?.current || broadcastStats?.views_per_story?.current || 0);

  const avgReactionsStory =
    detailed.avgReactionsStory || Number(broadcastStats?.reactionsPerStory?.current || broadcastStats?.reactions_per_story?.current || 0);

  const avgRepostsStory =
    detailed.avgRepostsStory || Number(broadcastStats?.sharesPerStory?.current || broadcastStats?.shares_per_story?.current || 0);

  return {
    storiesCount: weeklyStories.length,
    avgViewsStory,
    avgReactionsStory,
    avgRepostsStory,
  };
}

async function collectOneChannel(client, channelRef, range) {
  const { entity, full } = await getChannelFull(client, channelRef);
  const fullChat = full?.fullChat || {};

  const participantsCount = fullChat?.participantsCount ?? fullChat?.participants_count ?? 0;
  const canViewStats = !!(fullChat?.canViewStats ?? fullChat?.can_view_stats);

  if (!canViewStats) {
    throw new Error(
      `У канала ${channelRef} нет can_view_stats. Telegram не отдаёт детальную статистику для этого канала.`
    );
  }

  const broadcastStats = await getBroadcastStats(client, entity);

  const subscribers = Number(broadcastStats?.followers?.current || 0) || participantsCount;

  const avgViewsPostOfficial = Number(
    broadcastStats?.viewsPerPost?.current || broadcastStats?.views_per_post?.current || 0
  );

  const reactionsPerPostOfficial = Number(
    broadcastStats?.reactionsPerPost?.current || broadcastStats?.reactions_per_post?.current || 0
  );

  const sharesPerPostOfficial = Number(
    broadcastStats?.sharesPerPost?.current || broadcastStats?.shares_per_post?.current || 0
  );

  const enabledPart = Number(
    broadcastStats?.enabledNotifications?.part || broadcastStats?.enabled_notifications?.part || 0
  );

  const enabledTotal = Number(
    broadcastStats?.enabledNotifications?.total || broadcastStats?.enabled_notifications?.total || 0
  );

  const postsStats = await collectPostsStats(client, entity, range.start, range.end);
  const storiesStats = await collectStoriesStats(client, entity, range.start, range.end, broadcastStats);

  const avgViewsPost = postsStats.avgViewsPostRaw || avgViewsPostOfficial;
  const avgReactionsPost = postsStats.avgReactionsPost || reactionsPerPostOfficial;
  const avgCommentsPost = postsStats.avgCommentsPost || 0;
  const avgRepostsPost = postsStats.avgRepostsPost || sharesPerPostOfficial;

  const avgViewsStory = storiesStats.avgViewsStory || 0;
  const avgReactionsStory = storiesStats.avgReactionsStory || 0;
  const avgRepostsStory = storiesStats.avgRepostsStory || 0;

  return {
    subscribers,
    avgReachPost: avgViewsPost,
    avgViewsPost,
    postErViews: erByViews(avgViewsPost, subscribers),
    postErActivities: erByActivities(avgReactionsPost, avgCommentsPost, avgRepostsPost, subscribers),
    avgReactionsPost,
    avgCommentsPost,
    avgRepostsPost,
    postsCount: postsStats.postsCount,
    avgReachStory: avgViewsStory,
    avgViewsStory,
    storyErViews: erByViews(avgViewsStory, subscribers),
    storyErActivities: erByActivities(avgReactionsStory, 0, avgRepostsStory, subscribers),
    storiesCount: storiesStats.storiesCount,
    enabledNotificationsPercent: percent(enabledPart, enabledTotal),
  };
}

async function main() {
  if (!CHANNELS.length) {
    throw new Error("В .env не задан CHANNELS");
  }

  const range = getWeekRange();
  const client = await createTelegramClient();
  const sheets = await getGoogleSheetsClient();
  const rows = [];

  for (const channelRef of CHANNELS) {
    try {
      console.log(`Собираю: ${channelRef}`);
      const data = await collectOneChannel(client, channelRef, range);
      const row = buildRow(channelRef, range, data);
      rows.push(row);
      console.log(`OK: ${channelRef}`);
    } catch (e) {
      console.error(`Ошибка в ${channelRef}:`, e.message);
    }
  }

  if (!rows.length) {
    throw new Error("Не удалось собрать ни одной строки");
  }

  await appendToGoogleSheet(sheets, rows);
  await appendToXlsx(rows);

  console.log("Готово.");
  console.log("Rows:", rows.length);
  console.log("XLSX:", path.resolve(OUTPUT_XLSX));

  await client.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
