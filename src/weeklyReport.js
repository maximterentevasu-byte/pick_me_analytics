require("dotenv").config();

const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { google } = require("googleapis");

function avg(arr) {
  return arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;
}

function sum(arr) {
  return arr.reduce((a,b)=>a+b,0);
}

function weekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;

  const end = new Date(now);
  end.setDate(now.getDate() - diffToMonday);
  end.setHours(0,0,0,0);

  const start = new Date(end);
  start.setDate(end.getDate() - 7);

  return {
    start,
    end,
    startStr: start.toISOString().slice(0,10),
    endStr: end.toISOString().slice(0,10)
  };
}

function reactionsCount(msg){
  return (msg?.reactions?.results || []).reduce((a,r)=>a+(r.count||0),0);
}

async function main(){

  console.log("START REPORT");

  const client = new TelegramClient(
    new StringSession(process.env.TG_STRING_SESSION),
    Number(process.env.TG_API_ID),
    process.env.TG_API_HASH,
    { connectionRetries: 5 }
  );

  await client.connect();

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,"\n"),
    scopes:["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({version:"v4",auth});

  const channels = process.env.CHANNELS.split(",");

  const range = weekRange();

  for(const ch of channels){

    console.log("CHANNEL:", ch);

    const entity = await client.getEntity(ch);

    const full = await client.invoke(
      new Api.channels.GetFullChannel({channel:entity})
    );

    const subs = full.fullChat.participantsCount || 0;

    let posts=[];

    for await (const msg of client.iterMessages(entity,{limit:1000})){

      if(!msg.date) continue;

      const dt = new Date(msg.date);

      if(dt >= range.start && dt <= range.end){
        posts.push(msg);
      }
    }

    console.log("POSTS FOUND:", posts.length);

    const views = posts.map(p=>p.views || 0);
    const reactions = posts.map(reactionsCount);
    const comments = posts.map(p=>p.replies?.replies || 0);
    const reposts = posts.map(p=>p.forwards || 0);

    const avgViews = avg(views);
    const avgReactions = avg(reactions);
    const avgComments = avg(comments);
    const avgReposts = avg(reposts);

    const totalViews = sum(views);
    const totalReactions = sum(reactions);
    const totalComments = sum(comments);
    const totalReposts = sum(reposts);

    const erViews = subs ? (avgViews/subs*100).toFixed(2) : 0;
    const erActivities = subs ? ((avgReactions+avgComments+avgReposts)/subs*100).toFixed(2) : 0;

    const row = [
      range.startStr,
      range.endStr,
      ch,
      subs,
      avgViews,
      avgViews,
      erViews,
      erActivities,
      avgReactions,
      avgComments,
      avgReposts,
      posts.length,
      0,0,0,0,0,0,
      totalViews,
      totalReactions,
      totalComments,
      totalReposts,
      posts.length ? Math.round((totalReactions+totalComments+totalReposts)/posts.length) : 0,
      totalViews ? Math.round(totalReactions/totalViews*1000) : 0,
      totalViews ? Math.round(totalReposts/totalViews*1000) : 0,
      totalViews ? Math.round(totalComments/totalViews*1000) : 0,
      totalViews ? (totalReposts/totalViews*100).toFixed(2) : 0,
      (erViews*0.6 + erActivities*0.4).toFixed(2)
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range:"weekly_stats!A2",
      valueInputOption:"RAW",
      requestBody:{values:[row]}
    });

  }

  await client.disconnect();

  console.log("END REPORT");
}

main().catch(console.error);
