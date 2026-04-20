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

  if (bestPost) {
    scale = safeTextMetricPost(bestPost) || scale;
  }
  if (worstPost) {
    reduce = safeTextMetricPost(worstPost) || reduce;
  }

  const status = !prev
    ? "Новая неделя"
    : reasons.length
      ? "Аномалия"
      : "Стабильно";

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
    "Средний просмотр","Медианный просмотр",
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
}

async function prevRow(s, ch) {
  const r = await s.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A2:AI"
  }).catch(() => ({ data: {} }));

  const rows = r.data.values || [];
  const f = rows.filter(x => (x[2] || "") === ch);
  if (!f.length) return null;

  const l = f[f.length - 1];
  return { subs: l[3], avgViews: l[4], erViews: l[6], erAct: l[7], quality: l[17] };
}

async function stats(client, ch, range) {
  const e = await client.getEntity(ch);
  const f = await client.invoke(new Api.channels.GetFullChannel({ channel: e }));
  const subs = f?.fullChat?.participantsCount || 0;

  const raw = await client.getMessages(e, { limit: 1000 });
  const posts = raw.filter(m => {
    const d = toDate(m);
    return d && d >= range.start && d < range.end && !m.action;
  });

  const views = posts.map(m => m.views || 0);
  const reacts = posts.map(reactions);
  const comm = posts.map(comments);
  const rep = posts.map(m => m.forwards || 0);

  const avgViews = avg(views), medViews = median(views);
  const avgR = avg(reacts), avgC = avg(comm), avgF = avg(rep);
  const tV = sum(views), tR = sum(reacts), tC = sum(comm), tF = sum(rep);

  const erV = pct(avgViews, subs);
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

  const rawRows = posts.map(m => {
    const v = m.views || 0;
    const r = reactions(m);
    const c = comments(m);
    const fwd = m.forwards || 0;
    const postEr = v ? Number((((r + c + fwd) / v) * 100).toFixed(2)) : 0;
    const postVirality = v ? Number(((fwd / v) * 100).toFixed(2)) : 0;

    return [
      range.startStr, range.endStr, ch,
      toDate(m)?.toISOString() || "",
      m.id || "",
      truncateText(m.message || m.media?.caption || ""),
      v, r, c, fwd,
      postEr, postVirality
    ];
  });

  return {
    subs, avgViews, medViews, erV, erA, avgR, avgC, avgF,
    count: posts.length, tV, eng, eng1000, vir, vIndex, quality,
    best: Math.max(...views, 0), worst: views.length ? Math.min(...views) : 0,
    bestPost, worstPost, rawRows
  };
}

async function appendWeekly(s, rows) {
  await s.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "weekly_stats!A2",
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });
}

async function appendRaw(s, rows) {
  if (!rows.length) return;
  await s.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "posts_raw!A2",
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });
}

async function main() {
  console.log("FINAL PRO + RECO");

  const c = await tg();
  const s = await sheets();
  const range = weekRange();
  const chs = process.env.CHANNELS.split(",").map(x => x.trim()).filter(Boolean);

  await ensureHeaders(s);

  let weeklyRows = [];
  let rawRows = [];

  for (const ch of chs) {
    console.log("CHANNEL:", ch);

    const prev = await prevRow(s, ch);
    const m = await stats(c, ch, range);

    console.log("POSTS FOUND:", m.count);

    const dSubs = delta(m.subs, prev?.subs);
    const dSubsPct = deltaPct(m.subs, prev?.subs);

    const dViews = delta(m.avgViews, prev?.avgViews);
    const dViewsPct = deltaPct(m.avgViews, prev?.avgViews);

    const dErV = delta(m.erV, prev?.erViews);
    const dErVPct = deltaPct(m.erV, prev?.erViews);

    const dErA = delta(m.erA, prev?.erAct);
    const dErAPct = deltaPct(m.erA, prev?.erAct);

    const dQ = delta(m.quality, prev?.quality);
    const dQPct = deltaPct(m.quality, prev?.quality);

    const reco = classifyRecommendation(m, prev, m.bestPost, m.worstPost);

    weeklyRows.push([
      range.startStr, range.endStr, ch, m.subs,
      m.avgViews, m.medViews,
      m.erV, m.erA,
      m.avgR, m.avgC, m.avgF,
      m.count, m.tV,
      m.eng, m.eng1000,
      m.vir, m.vIndex,
      m.quality,
      m.best, m.worst,
      dSubs, dSubsPct,
      dViews, dViewsPct,
      dErV, dErVPct,
      dErA, dErAPct,
      dQ, dQPct,
      reco.status, reco.reason,
      reco.main, reco.scale, reco.reduce
    ]);

    rawRows.push(...m.rawRows);
  }

  await appendWeekly(s, weeklyRows);
  await appendRaw(s, rawRows);

  await c.disconnect();
  console.log("FINAL PRO + RECO DONE");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});