
// FULL PRO VERSION WITH STORIES (READY FOR GITHUB)

require("dotenv").config();

const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { google } = require("googleapis");

// ===== HELPERS =====
const avg = (a) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const sum = (a) => a.reduce((x,y)=>x+y,0);
const pct = (a,b) => b ? (a/b)*100 : 0;

const toDate = (m) => {
  if (!m?.date) return null;
  return typeof m.date === "number" ? new Date(m.date * 1000) : new Date(m.date);
};

// ===== STORIES =====
async function getStoriesStats(client, channel) {
  try {
    const res = await client.invoke(
      new Api.stories.GetPeerStories({ peer: channel })
    );

    const stories = res.stories?.stories || [];

    const views = stories.map(s => s.views?.views_count || 0);
    const reactions = stories.map(s =>
      (s.views?.reactions?.results || []).reduce((a,r)=>a+r.count,0)
    );
    const forwards = stories.map(s => s.views?.forwards_count || 0);

    const totalViews = sum(views);
    const totalActions = sum(reactions) + sum(forwards);

    return {
      count: stories.length,
      avgViews: Math.round(avg(views)),
      avgActions: Math.round(avg(reactions.map((r,i)=>r+forwards[i]))),
      erViews: pct(avg(views), totalViews).toFixed(2),
      erActions: pct(totalActions, totalViews).toFixed(2)
    };

  } catch(e) {
    console.log("Stories error:", e.message);
    return { count:0, avgViews:0, avgActions:0, erViews:0, erActions:0 };
  }
}

// ===== MAIN =====
async function main() {
  console.log("PRO + STORIES START");

  const client = new TelegramClient(
    new StringSession(process.env.TG_STRING_SESSION),
    Number(process.env.TG_API_ID),
    process.env.TG_API_HASH,
    { connectionRetries: 5 }
  );

  await client.connect();

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  await auth.authorize();

  const sheets = google.sheets({ version: "v4", auth });

  const channels = process.env.CHANNELS.split(",");

  for (const ch of channels) {
    console.log("CHANNEL:", ch);

    const entity = await client.getEntity(ch);

    const full = await client.invoke(
      new Api.channels.GetFullChannel({ channel: entity })
    );

    const subs = full.fullChat.participantsCount || 0;

    const msgs = await client.getMessages(entity, { limit: 200 });

    const posts = msgs.filter(m => !m.action);

    console.log("POSTS:", posts.length);

    const views = posts.map(m=>m.views||0);
    const reactions = posts.map(m=>
      (m.reactions?.results||[]).reduce((a,r)=>a+r.count,0)
    );
    const comments = posts.map(m=>m.replies?.replies||0);
    const forwards = posts.map(m=>m.forwards||0);

    const avgViews = Math.round(avg(views));
    const avgReact = Math.round(avg(reactions));
    const avgComm = Math.round(avg(comments));
    const avgForw = Math.round(avg(forwards));

    const erViews = pct(avgViews, subs).toFixed(2);
    const erActions = pct(avgReact+avgComm+avgForw, avgViews).toFixed(2);

    // ===== STORIES =====
    const stories = await getStoriesStats(client, entity);

    const row = [[
      new Date().toISOString().slice(0,10),
      ch,
      subs,
      avgViews,
      erViews,
      erActions,
      avgReact,
      avgComm,
      avgForw,
      posts.length,

      // STORIES
      stories.count,
      stories.avgViews,
      stories.avgActions,
      stories.erViews,
      stories.erActions
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "weekly_stats!A1",
      valueInputOption: "RAW",
      requestBody: { values: row }
    });

    console.log("DONE:", ch);
  }

  await client.disconnect();
  console.log("PRO + STORIES DONE");
}

main();
