
// FIXED FULL PRO WITH STORIES + HEADERS + POSTS_RAW

require("dotenv").config();
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { google } = require("googleapis");

const avg = (a)=>a.length? a.reduce((x,y)=>x+y,0)/a.length:0;
const sum = (a)=>a.reduce((x,y)=>x+y,0);
const pct = (a,b)=>b?(a/b)*100:0;

async function tg(){
  const c=new TelegramClient(
    new StringSession(process.env.TG_STRING_SESSION),
    Number(process.env.TG_API_ID),
    process.env.TG_API_HASH,
    {connectionRetries:5}
  );
  await c.connect();
  return c;
}

async function sheets(){
  const auth=new google.auth.JWT({
    email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key:process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,"\n"),
    scopes:["https://www.googleapis.com/auth/spreadsheets"]
  });
  await auth.authorize();
  return google.sheets({version:"v4",auth});
}

async function ensureHeaders(s){
  const weeklyHeader=[[
    "Дата","Канал","Подписчики","Ср просмотры",
    "ER просмотры %","ER активности %",
    "Ср реакции","Ср комментарии","Ср репосты","Посты",
    "Сторис кол-во","Сторис ср просмотры","Сторис ср активность","ER сторис просмотры","ER сторис активности"
  ]];

  const rawHeader=[[
    "Дата","Канал","ID","Текст","Просмотры","Реакции","Комментарии","Репосты"
  ]];

  try{
    const r=await s.spreadsheets.values.get({
      spreadsheetId:process.env.GOOGLE_SHEET_ID,
      range:"weekly_stats!A1"
    });
    if(!r.data.values){
      await s.spreadsheets.values.update({
        spreadsheetId:process.env.GOOGLE_SHEET_ID,
        range:"weekly_stats!A1",
        valueInputOption:"RAW",
        requestBody:{values:weeklyHeader}
      });
    }
  }catch{}

  try{
    const r2=await s.spreadsheets.values.get({
      spreadsheetId:process.env.GOOGLE_SHEET_ID,
      range:"posts_raw!A1"
    });
    if(!r2.data.values){
      await s.spreadsheets.values.update({
        spreadsheetId:process.env.GOOGLE_SHEET_ID,
        range:"posts_raw!A1",
        valueInputOption:"RAW",
        requestBody:{values:rawHeader}
      });
    }
  }catch{}
}

async function getStories(client, entity){
  try{
    const res=await client.invoke(new Api.stories.GetPeerStories({peer:entity}));
    const s=res.stories?.stories||[];

    const views=s.map(x=>x.views?.views_count||0);
    const reacts=s.map(x=>(x.views?.reactions?.results||[]).reduce((a,r)=>a+r.count,0));
    const fw=s.map(x=>x.views?.forwards_count||0);

    return {
      count:s.length,
      avgViews:Math.round(avg(views)),
      avgAct:Math.round(avg(reacts.map((r,i)=>r+fw[i]))),
      erViews:pct(avg(views),sum(views)).toFixed(2),
      erAct:pct(sum(reacts)+sum(fw),sum(views)).toFixed(2)
    };
  }catch(e){
    return {count:0,avgViews:0,avgAct:0,erViews:0,erAct:0};
  }
}

async function main(){
  console.log("FIX START");

  const client=await tg();
  const s=await sheets();

  await ensureHeaders(s);

  const chs=process.env.CHANNELS.split(",");

  for(const ch of chs){
    const entity=await client.getEntity(ch);

    const full=await client.invoke(new Api.channels.GetFullChannel({channel:entity}));
    const subs=full.fullChat.participantsCount||0;

    const msgs=await client.getMessages(entity,{limit:200});
    const posts=msgs.filter(m=>!m.action);

    const views=posts.map(m=>m.views||0);
    const reacts=posts.map(m=>(m.reactions?.results||[]).reduce((a,r)=>a+r.count,0));
    const comm=posts.map(m=>m.replies?.replies||0);
    const fw=posts.map(m=>m.forwards||0);

    const avgViews=Math.round(avg(views));
    const avgR=Math.round(avg(reacts));
    const avgC=Math.round(avg(comm));
    const avgF=Math.round(avg(fw));

    const erV=pct(avgViews,subs).toFixed(2);
    const erA=pct(avgR+avgC+avgF,avgViews).toFixed(2);

    const stories=await getStories(client,entity);

    // weekly
    await s.spreadsheets.values.append({
      spreadsheetId:process.env.GOOGLE_SHEET_ID,
      range:"weekly_stats!A2",
      valueInputOption:"RAW",
      requestBody:{values:[[
        new Date().toISOString().slice(0,10),
        ch,subs,avgViews,erV,erA,avgR,avgC,avgF,posts.length,
        stories.count,stories.avgViews,stories.avgAct,stories.erViews,stories.erAct
      ]]}
    });

    // posts_raw
    const raw=posts.map(m=>[
      new Date().toISOString().slice(0,10),
      ch,
      m.id,
      (m.message||"").slice(0,100),
      m.views||0,
      (m.reactions?.results||[]).reduce((a,r)=>a+r.count,0),
      m.replies?.replies||0,
      m.forwards||0
    ]);

    if(raw.length){
      await s.spreadsheets.values.append({
        spreadsheetId:process.env.GOOGLE_SHEET_ID,
        range:"posts_raw!A2",
        valueInputOption:"RAW",
        requestBody:{values:raw}
      });
    }

    console.log("OK:",ch,"POSTS:",posts.length);
  }

  await client.disconnect();
  console.log("FIX DONE");
}

main();
