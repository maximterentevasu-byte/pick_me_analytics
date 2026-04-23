require("dotenv").config();

const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { google } = require("googleapis");

const avg = (a, d = 2) => a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(d)) : 0;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const pct = (a, b, d = 2) => b ? Number(((a / b) * 100).toFixed(d)) : 0;
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Number(((s[m - 1] + s[m]) / 2).toFixed(2));
};
const toDate = (m) => !m?.date ? null : (typeof m.date === "number" ? new Date(m.date * 1000) : new Date(m.date));
const delta = (c, p) => (p === "" || p == null) ? "" : Number((Number(c) - Number(p)).toFixed(2));
const deltaPct = (c, p) => (p === "" || p == null || Number(p) === 0) ? "" : Number((((Number(c) - Number(p)) / Number(p)) * 100).toFixed(2));

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

function getCurrentMonday() {
  const now = new Date();
  const d = (now.getDay() + 6) % 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - d);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function weekStartOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekKeyFromDate(date) {
  const start = weekStartOf(date);
  return start.toISOString().slice(0, 10);
}

function buildWeekMeta(start) {
  const s = new Date(start);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return {
    start: s,
    end: new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7),
    startStr: s.toISOString().slice(0, 10),
    endStr: e.toISOString().slice(0, 10)
  };
}

function buildWeekSeries(earliestDate) {
  if (!earliestDate) return [];
  const startMonday = weekStartOf(earliestDate);
  const currentMonday = getCurrentMonday();
  const weeks = [];
  const cursor = new Date(startMonday);
  while (cursor < currentMonday) {
    weeks.push(buildWeekMeta(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function normalizeCell(v) {
  if (v === undefined || v === null) return "";
  return String(v);
}

const reactions = (m) => (m?.reactions?.results || []).reduce((a, i) => a + (i.count || 0), 0);
const comments = (m) => m?.replies?.replies || 0;

function truncateText(text, maxLen = 160) {
  if (!text) return "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

function safeTextMetricPost(post) {
  return truncateText(post?.message || post?.media?.caption || "");
}

function classifyRecommendation(metrics, prev, bestPost, worstPost) {
  const reasons = [];
  let main = "Поддерживать текущую частоту и формат";
  let scale = "Посты с высокой виральностью и высоким ER";
  let reduce = "Посты с низким ER и низкими просмотрами";

  const dViewsPct = deltaPct(metrics.avgViews, prev?.avgViews);
  const dErActPct = deltaPct(metrics.erA, prev?.erAct);
  const dQualityPct = deltaPct(metrics.quality, prev?.quality);
  const dSubsPct = deltaPct(metrics.subs, prev?.subs);

  if (dViewsPct !== "" && dViewsPct < -20) {
    reasons.push("Просадка просмотров");
    main = "Пересмотреть темы, подачу и время публикации";
  }
  if (dErActPct !== "" && dErActPct > 15) {
    reasons.push("Рост вовлечения");
    main = "Увеличить долю вовлекающих форматов";
  }
  if (dQualityPct !== "" && dQualityPct > 15) {
    reasons.push("Рост качества");
    main = "Масштабировать текущую модель контента";
  }
  if (dSubsPct !== "" && dSubsPct < 0) {
    reasons.push("Снижение подписчиков");
    main = "Снизить частоту слабых постов и усилить ценность контента";
  }

  if (bestPost) scale = safeTextMetricPost(bestPost) || scale;
  if (worstPost) reduce = safeTextMetricPost(worstPost) || reduce;

  const status = !prev ? "Новая неделя" : reasons.length ? "Аномалия" : "Стабильно";
  const reason = reasons.length ? reasons.join(", ") : "—";

  return { status, reason, main, scale, reduce };
}

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

async function ensureHeaders(s) {
  const weeklyHeader = [[
    "Дата начала недели","Дата конца недели","Канал","Подписчики",
    "Средний просмотр","Доля пользователей с включёнными уведомлениями %","Медианный просмотр",
    "ER (просмотры)%","ER (активности)%",
    "Ср реакции","Ср комментарии","Ср репосты",
    "Посты","Просмотры сумма",
    "Engagement/post","Engagement/1000",
    "Виральность%","Viral Index",
    "Индекс качества",
    "Лучший пост (views)","Худший пост (views)",
    "Δ Подписчики","Δ% Подписчики",
    "Δ Средний просмотр","Δ% Средний просмотр",
    "Δ ER (просмотры)%","Δ% ER (просмотры)%",
    "Δ ER (активности)%","Δ% ER (активности)%",
    "Δ Индекс качества","Δ% Индекс качества",
    "Статус недели","Причина",
    "Главная рекомендация","Что масштабировать","Что снижать"
  ]];

  const rawHeader = [[
    "Дата начала недели","Дата конца недели","Канал",
    "Дата поста","ID поста","Текст поста",
    "Просмотры","Реакции","Комментарии","Репосты",
    "ER поста %","Виральность поста %"
  ]];

  const storiesHeader = [[
    "Дата начала недели","Дата конца недели","Канал",
    "Количество сторис","Средние просмотры сторис","ER сторис","Топ сторис"
  ]];

  const resWeekly = await s.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A1:A1"
  }).catch(() => ({ data: {} }));

  if (!resWeekly.data.values || resWeekly.data.values.length === 0) {
    await s.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "weekly_stats!A1",
      valueInputOption: "RAW",
      requestBody: { values: weeklyHeader }
    });
  }

  const resRaw = await s.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "posts_raw!A1:A1"
  }).catch(() => ({ data: {} }));

  if (!resRaw.data.values || resRaw.data.values.length === 0) {
    await s.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "posts_raw!A1",
      valueInputOption: "RAW",
      requestBody: { values: rawHeader }
    });
  }

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

async function getExistingRows(s, range) {
  const res = await s.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range
  }).catch(() => ({ data: {} }));
  return res.data.values || [];
}

function makeWeeklyKey(startStr, endStr, ch) {
  return `${startStr}|${endStr}|${ch}`;
}

function makeRawKey(row) {
  return `${row[0]}|${row[1]}|${row[2]}|${row[4]}`;
}

async function collectPosts(client, entity) {
  const posts = [];
  for await (const m of client.iterMessages(entity, {})) {
    const d = toDate(m);
    if (d && !m.action) posts.push(m);
  }
  return posts;
}

async function getStoriesStatsAll(client, entity) {
  try {
    const res = await client.invoke(
      new Api.stories.GetPeerStories({
        peer: entity
      })
    );

    const stories = res?.stories?.stories || [];
    return stories.map(story => {
      const rawDate = story?.date
        ? (typeof story.date === "number" ? new Date(story.date * 1000) : new Date(story.date))
        : null;

      const v = story?.views;
      const views = v?.viewsCount || v?.views_count || 0;
      const forwards = v?.forwardsCount || v?.forwards_count || 0;
      const rx = v?.reactions?.results || [];
      const reactions = rx.reduce((a, r) => a + (r.count || 0), 0);

      return {
        id: story?.id ?? "",
        date: rawDate,
        views,
        forwards,
        reactions
      };
    }).filter(x => x.date && !Number.isNaN(x.date.getTime()));
  } catch (e) {
    console.log("Stories error:", e.message);
    return [];
  }
}

function buildWeeklyRow(ch, week, metrics, prevMetrics, bestPost, worstPost) {
  const dSubs = delta(metrics.subs, prevMetrics?.subs);
  const dSubsPct = deltaPct(metrics.subs, prevMetrics?.subs);

  const dViews = delta(metrics.avgViews, prevMetrics?.avgViews);
  const dViewsPct = deltaPct(metrics.avgViews, prevMetrics?.avgViews);

  const dErV = delta(metrics.erV, prevMetrics?.erViews);
  const dErVPct = deltaPct(metrics.erV, prevMetrics?.erViews);

  const dErA = delta(metrics.erA, prevMetrics?.erAct);
  const dErAPct = deltaPct(metrics.erA, prevMetrics?.erAct);

  const dQ = delta(metrics.quality, prevMetrics?.quality);
  const dQPct = deltaPct(metrics.quality, prevMetrics?.quality);

  const reco = classifyRecommendation(metrics, prevMetrics, bestPost, worstPost);

  return [
    week.startStr, week.endStr, ch, metrics.subs,
    metrics.avgViews, "", metrics.medViews,
    metrics.erV, metrics.erA,
    metrics.avgR, metrics.avgC, metrics.avgF,
    metrics.count, metrics.tV,
    metrics.eng, metrics.eng1000,
    metrics.vir, metrics.vIndex,
    metrics.quality,
    metrics.best, metrics.worst,
    dSubs, dSubsPct,
    dViews, dViewsPct,
    dErV, dErVPct,
    dErA, dErAPct,
    dQ, dQPct,
    reco.status, reco.reason,
    reco.main, reco.scale, reco.reduce
  ];
}

function computePostMetrics(subsBase, posts) {
  const views = posts.map(m => m.views || 0);
  const reacts = posts.map(reactions);
  const comm = posts.map(comments);
  const rep = posts.map(m => m.forwards || 0);

  const avgViews = avg(views), medViews = median(views);
  const avgR = avg(reacts), avgC = avg(comm), avgF = avg(rep);
  const tV = sum(views), tR = sum(reacts), tC = sum(comm), tF = sum(rep);

  const erV = pct(avgViews, subsBase);
  const erA = avgViews ? Number((((avgR + avgC + avgF) / avgViews) * 100).toFixed(2)) : 0;
  const eng = posts.length ? Number(((tR + tC + tF) / posts.length).toFixed(2)) : 0;
  const eng1000 = tV ? Number((((tR + tC + tF) / tV) * 1000).toFixed(2)) : 0;
  const vir = pct(tF, tV);
  const vIndex = tV ? Number((((tF * 2) + (tC * 1.5) + tR) / tV * 100).toFixed(2)) : 0;
  const quality = Number((erV * 0.4 + erA * 0.3 + vir * 0.2 + eng1000 * 0.1).toFixed(2));

  let bestPost = null;
  let worstPost = null;
  if (posts.length) {
    bestPost = posts.reduce((max, p) => (p.views || 0) > (max.views || 0) ? p : max, posts[0]);
    worstPost = posts.reduce((min, p) => (p.views || 0) < (min.views || 0) ? p : min, posts[0]);
  }

  return {
    metrics: {
      subs: subsBase, avgViews, medViews, erV, erA, avgR, avgC, avgF,
      count: posts.length, tV, eng, eng1000, vir, vIndex, quality,
      best: Math.max(...views, 0), worst: views.length ? Math.min(...views) : 0
    },
    bestPost,
    worstPost
  };
}

function computeStoriesRow(ch, week, stories) {
  const count = stories.length;
  const storyViews = stories.map(s => s.views || 0);
  const storyForwards = stories.map(s => s.forwards || 0);
  const storyReactions = stories.map(s => s.reactions || 0);

  const avgViews = count ? Number((sum(storyViews) / count).toFixed(2)) : 0;
  const avgActions = count ? Number(((sum(storyReactions) + sum(storyForwards)) / count).toFixed(2)) : 0;
  const erStories = avgViews ? Number(((avgActions / avgViews) * 100).toFixed(2)) : 0;

  let topStory = "";
  if (stories.length) {
    const best = stories.reduce((max, cur) => cur.views > max.views ? cur : max, stories[0]);
    topStory = best.date && !Number.isNaN(best.date.getTime())
      ? `${best.date.toISOString()} | id:${best.id} | views:${best.views}`
      : `id:${best.id} | views:${best.views}`;
  }

  return [
    week.startStr,
    week.endStr,
    ch,
    count,
    avgViews,
    erStories,
    topStory
  ];
}

function buildRawRows(ch, week, posts) {
  return posts.map(m => {
    const v = m.views || 0;
    const r = reactions(m);
    const c = comments(m);
    const fwd = m.forwards || 0;
    const postEr = v ? Number((((r + c + fwd) / v) * 100).toFixed(2)) : 0;
    const postVirality = v ? Number(((fwd / v) * 100).toFixed(2)) : 0;

    return [
      week.startStr, week.endStr, ch,
      toDate(m)?.toISOString() || "",
      m.id || "",
      truncateText(m.message || m.media?.caption || ""),
      v, r, c, fwd,
      postEr, postVirality
    ];
  });
}

async function batchValueUpdates(s, updates) {
  if (!updates.length) return;
  await s.spreadsheets.values.batchUpdate({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: updates
    }
  });
}

async function appendRows(s, range, rows) {
  if (!rows.length) return;
  await s.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });
}

async function main() {
  console.log("FINAL BACKFILL + INCREMENTAL + STORIES LAST WEEK ONLY");

  const c = await tg();
  const s = await sheets();
  const chs = process.env.CHANNELS.split(",").map(x => x.trim()).filter(Boolean);

  await ensureHeaders(s);

  const existingWeeklyRows = await getExistingRows(s, "weekly_stats!A2:AJ");
  const existingRawRows = await getExistingRows(s, "posts_raw!A2:L");
  const existingStoriesRows = await getExistingRows(s, "stories_weekly!A2:G");

  const existingWeeklyMap = new Map();
  existingWeeklyRows.forEach((row, idx) => existingWeeklyMap.set(makeWeeklyKey(row[0], row[1], row[2]), { rowNumber: idx + 2, row }));
  const existingRawMap = new Map();
  existingRawRows.forEach((row, idx) => existingRawMap.set(makeRawKey(row), { rowNumber: idx + 2, row }));
  const existingStoriesMap = new Map();
  existingStoriesRows.forEach((row, idx) => existingStoriesMap.set(makeWeeklyKey(row[0], row[1], row[2]), { rowNumber: idx + 2, row }));

  const weeklyToAppend = [];
  const rawToAppend = [];
  const storiesToAppend = [];
  const weeklyUpdates = [];
  const rawUpdates = [];
  const storiesUpdates = [];

  for (const ch of chs) {
    console.log("CHANNEL:", ch);

    const entity = await c.getEntity(ch);
    const full = await c.invoke(new Api.channels.GetFullChannel({ channel: entity }));
    const subs = full?.fullChat?.participantsCount || 0;

    const allPosts = await collectPosts(c, entity);
    const allStories = await getStoriesStatsAll(c, entity);

    const earliestPostDate = allPosts.length ? toDate(allPosts[allPosts.length - 1]) : null;
    const earliestStoryDate = allStories.length
      ? allStories.reduce((min, cur) => cur.date < min ? cur.date : min, allStories[0].date)
      : null;

    let earliestDate = null;
    if (earliestPostDate && earliestStoryDate) earliestDate = earliestPostDate < earliestStoryDate ? earliestPostDate : earliestStoryDate;
    else earliestDate = earliestPostDate || earliestStoryDate;

    const weeks = buildWeekSeries(earliestDate);
    const postsByWeek = new Map();
    const storiesByWeek = new Map();

    for (const post of allPosts) {
      const d = toDate(post);
      if (!d) continue;
      const key = weekKeyFromDate(d);
      if (!postsByWeek.has(key)) postsByWeek.set(key, []);
      postsByWeek.get(key).push(post);
    }

    for (const story of allStories) {
      const key = weekKeyFromDate(story.date);
      if (!storiesByWeek.has(key)) storiesByWeek.set(key, []);
      storiesByWeek.get(key).push(story);
    }

    let prevMetrics = null;

    for (const week of weeks) {
      const weekPosts = postsByWeek.get(week.startStr) || [];
      const weekStories = storiesByWeek.get(week.startStr) || [];
      const weeklyKey = makeWeeklyKey(week.startStr, week.endStr, ch);
      const existingWeekly = existingWeeklyMap.get(weeklyKey);
      const subsBase = existingWeekly ? Number(existingWeekly.row[3] || subs) : subs;

      const { metrics, bestPost, worstPost } = computePostMetrics(subsBase, weekPosts);
      const weeklyRow = buildWeeklyRow(ch, week, metrics, prevMetrics, bestPost, worstPost);

      if (existingWeekly) {
        const existing = existingWeekly;
        const current = existing.row;

        const updateCols = [5, ...Array.from({ length: 25 }, (_, i) => i + 7)]; // E and G:AE
        for (const col of updateCols) {
          const currentVal = normalizeCell(current[col - 1]);
          const newVal = normalizeCell(weeklyRow[col - 1]);
          if (currentVal !== newVal) {
            weeklyUpdates.push({
              range: `weekly_stats!${colLetter(col)}${existing.rowNumber}`,
              values: [[weeklyRow[col - 1]]]
            });
          }
        }
      } else {
        weeklyToAppend.push(weeklyRow);
      }

      const weekRawRows = buildRawRows(ch, week, weekPosts);
      for (const rawRow of weekRawRows) {
        const rawKey = makeRawKey(rawRow);
        if (existingRawMap.has(rawKey)) {
          const existing = existingRawMap.get(rawKey);
          const current = existing.row;
          for (let col = 7; col <= 12; col++) {
            const currentVal = normalizeCell(current[col - 1]);
            const newVal = normalizeCell(rawRow[col - 1]);
            if (currentVal !== newVal) {
              rawUpdates.push({
                range: `posts_raw!${colLetter(col)}${existing.rowNumber}`,
                values: [[rawRow[col - 1]]]
              });
            }
          }
        } else {
          rawToAppend.push(rawRow);
        }
      }

      const storiesRow = computeStoriesRow(ch, week, weekStories);
      if (existingStoriesMap.has(weeklyKey)) {
        const existing = existingStoriesMap.get(weeklyKey);
        const current = existing.row;
        for (let col = 4; col <= 7; col++) {
          const currentVal = normalizeCell(current[col - 1]);
          const newVal = normalizeCell(storiesRow[col - 1]);
          if (currentVal !== newVal) {
            storiesUpdates.push({
              range: `stories_weekly!${colLetter(col)}${existing.rowNumber}`,
              values: [[storiesRow[col - 1]]]
            });
          }
        }
      } else {
        storiesToAppend.push(storiesRow);
      }

      prevMetrics = metrics;
    }

    console.log(`WEEKS: ${weeks.length}, POSTS: ${allPosts.length}, STORIES: ${allStories.length}`);
    const lastCompletedWeek = weekRange();
    const storiesKey = makeWeeklyKey(lastCompletedWeek.startStr, lastCompletedWeek.endStr, ch);

    if (!existingStoriesMap.has(storiesKey)) {
      const stories = await getStoriesStats(c, entity);
      console.log("STORIES FOUND:", stories.count);

      storiesToAppend.push([
        lastCompletedWeek.startStr,
        lastCompletedWeek.endStr,
        ch,
        stories.count,
        stories.avgViews,
        stories.erStories,
        stories.topStory
      ]);
    } else {
      console.log("STORIES SKIPPED: week already exists");
    }

    console.log(`SUBS NOW: ${subs}`);
  }

  await batchValueUpdates(s, weeklyUpdates);
  await batchValueUpdates(s, rawUpdates);
  await batchValueUpdates(s, storiesUpdates);

  await appendRows(s, "weekly_stats!A2", weeklyToAppend);
  await appendRows(s, "posts_raw!A2", rawToAppend);
  await appendStoriesWeekly(s, storiesToAppend);
  await appendRows(s, "stories_weekly!A2", storiesToAppend);

  await c.disconnect();
  console.log("FINAL BACKFILL + INCREMENTAL + STORIES LAST WEEK ONLY DONE");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
