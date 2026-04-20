
require("dotenv").config();

const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { google } = require("googleapis");

function avg(arr,d=2){return arr.length?Number((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(d)):0}
function sum(arr){return arr.reduce((a,b)=>a+b,0)}
function pct(a,b,d=2){return b?Number(((a/b)*100).toFixed(d)):0}

function median(arr){
  if(!arr.length) return 0;
  const s=[...arr].sort((a,b)=>a-b);
  const mid=Math.floor(s.length/2);
  return s.length%2?s[mid]:(s[mid-1]+s[mid])/2;
}

function toDate(m){
  if(!m?.date) return null;
  if(typeof m.date==="number") return new Date(m.date*1000);
  if(m.date instanceof Date) return m.date;
  return new Date(m.date);
}

function weekRange(){
  const now=new Date();
  const day=(now.getDay()+6)%7;
  const monday=new Date(now);
  monday.setDate(now.getDate()-day);
  monday.setHours(0,0,0,0);

  const start=new Date(monday);
  start.setDate(monday.getDate()-7);

  return {
    start,
    end:monday,
    startStr:start.toISOString().slice(0,10),
    endStr:new Date(monday-86400000).toISOString().slice(0,10)
  };
}

function reactionsCount(m){
  return (m?.reactions?.results||[]).reduce((a,i)=>a+(i.count||0),0);
}

function commentsCount(m){
  return m?.replies?.replies||0;
}

async function initTelegram(){
  const client=new TelegramClient(
    new StringSession(process.env.TG_STRING_SESSION),
    Number(process.env.TG_API_ID),
    process.env.TG_API_HASH,
    {connectionRetries:5}
  );
  await client.connect();
  return client;
}

async function initSheets(){
  const auth=new google.auth.JWT({
    email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key:process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,"\n"),
    scopes:["https://www.googleapis.com/auth/spreadsheets"]
  });
  await auth.authorize();
  return google.sheets({version:"v4",auth});
}

async function ensureHeader(sheets){
  const header=[[
    "Дата начала недели","Дата конца недели","Канал","Подписчики",
    "Средний просмотр","Медианный просмотр",
    "ER (просмотры)%","ER (активности)%",
    "Ср реакции","Ср комментарии","Ср репосты",
    "Посты","Просмотры сумма",
    "Engagement/post","Engagement/1000",
    "Виральность%","Viral Index",
    "Индекс качества",
    "Лучший пост (views)","Худший пост (views)"
  ]];

  const res=await sheets.spreadsheets.values.get({
    spreadsheetId:process.env.GOOGLE_SHEET_ID,
    range:"weekly_stats!A1:A1"
  });

  if(!res.data.values){
    await sheets.spreadsheets.values.update({
      spreadsheetId:process.env.GOOGLE_SHEET_ID,
      range:"weekly_stats!A1",
      valueInputOption:"RAW",
      requestBody:{values:header}
    });
  }
}

async function append(sheets,rows){
  await sheets.spreadsheets.values.append({
    spreadsheetId:process.env.GOOGLE_SHEET_ID,
    range:"weekly_stats!A2",
    valueInputOption:"RAW",
    requestBody:{values:rows}
  });
}

async function getStats(client,channel,range){
  const entity=await client.getEntity(channel);
  const full=await client.invoke(new Api.channels.GetFullChannel({channel:entity}));
  const subs=full.fullChat.participantsCount||0;

  const raw=await client.getMessages(entity,{limit:1000});

  const posts=raw.filter(m=>{
    const d=toDate(m);
    return d && d>=range.start && d<range.end && !m.action;
  });

  const views=posts.map(m=>m.views||0);
  const reacts=posts.map(reactionsCount);
  const comm=posts.map(commentsCount);
  const repost=posts.map(m=>m.forwards||0);

  const avgViews=avg(views);
  const medViews=median(views);

  const avgReact=avg(reacts);
  const avgComm=avg(comm);
  const avgRepost=avg(repost);

  const totalViews=sum(views);
  const totalReact=sum(reacts);
  const totalComm=sum(comm);
  const totalRepost=sum(repost);

  const erViews=pct(avgViews,subs);
  const erAct=avgViews?Number(((avgReact+avgComm+avgRepost)/avgViews*100).toFixed(2)):0;

  const engagement=posts.length?Number(((totalReact+totalComm+totalRepost)/posts.length).toFixed(2)):0;
  const engagement1000=totalViews?Number(((totalReact+totalComm+totalRepost)/totalViews*1000).toFixed(2)):0;

  const virality=pct(totalRepost,totalViews);
  const viralIndex=totalViews?Number(((totalRepost*2+totalComm*1.5+totalReact)/totalViews*100).toFixed(2)):0;

  const quality=Number((erViews*0.4+erAct*0.3+virality*0.2+engagement1000*0.1).toFixed(2));

  const best=Math.max(...views,0);
  const worst=views.length?Math.min(...views):0;

  return [
    range.startStr,range.endStr,channel,subs,
    avgViews,medViews,
    erViews,erAct,
    avgReact,avgComm,avgRepost,
    posts.length,totalViews,
    engagement,engagement1000,
    virality,viralIndex,
    quality,
    best,worst
  ];
}

async function main(){
  console.log("PRO ANALYTICS RUN");

  const client=await initTelegram();
  const sheets=await initSheets();
  const range=weekRange();

  const channels=process.env.CHANNELS.split(",");

  await ensureHeader(sheets);

  const rows=[];
  for(const ch of channels){
    rows.push(await getStats(client,ch.trim(),range));
  }

  await append(sheets,rows);
  await client.disconnect();
}

main();
