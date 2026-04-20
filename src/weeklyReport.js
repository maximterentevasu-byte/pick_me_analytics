require("dotenv").config();
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { google } = require("googleapis");

const avg=a=>a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):0;
const sum=a=>a.reduce((x,y)=>x+y,0);
const pct=(a,b)=>b?+((a/b)*100).toFixed(2):0;
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:+((s[m-1]+s[m])/2).toFixed(2)};
const toDate=m=>!m?.date?null:(typeof m.date==="number"?new Date(m.date*1000):new Date(m.date));
const delta=(c,p)=>p===""||p==null?"":+(c-p).toFixed(2);
const deltaPct=(c,p)=>p===""||p==null||p==0?"":+(((c-p)/p)*100).toFixed(2);

function weekRange(){
 const now=new Date();const d=(now.getDay()+6)%7;
 const mon=new Date(now);mon.setDate(now.getDate()-d);mon.setHours(0,0,0,0);
 const start=new Date(mon);start.setDate(mon.getDate()-7);
 return {start,end:mon,startStr:start.toISOString().slice(0,10),endStr:new Date(mon-86400000).toISOString().slice(0,10)}
}

const reactions=m=>(m?.reactions?.results||[]).reduce((a,i)=>a+(i.count||0),0);
const comments=m=>m?.replies?.replies||0;

async function tg(){
 const c=new TelegramClient(new StringSession(process.env.TG_STRING_SESSION),+process.env.TG_API_ID,process.env.TG_API_HASH,{connectionRetries:5});
 await c.connect();return c;
}
async function sheets(){
 const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,"\n"),scopes:["https://www.googleapis.com/auth/spreadsheets"]});
 await auth.authorize();return google.sheets({version:"v4",auth});
}

async function prevRow(s,ch){
 const r=await s.spreadsheets.values.get({spreadsheetId:process.env.GOOGLE_SHEET_ID,range:"weekly_stats!A2:AF"}).catch(()=>({data:{}}));
 const rows=r.data.values||[];
 const f=rows.filter(x=>(x[2]||"")==ch);
 if(!f.length)return null;
 const l=f[f.length-1];
 return {subs:l[3],avgViews:l[4],erViews:l[6],erAct:l[7],quality:l[17]};
}

function status(m,prev){
 if(!prev) return ["Новая неделя","—"];
 let reasons=[];
 if(deltaPct(m.avgViews,prev.avgViews)<-20) reasons.push("Просадка просмотров");
 if(deltaPct(m.erAct,prev.erAct)>20) reasons.push("Рост вовлечения");
 if(deltaPct(m.quality,prev.quality)>15) reasons.push("Рост качества");
 if(!reasons.length) return ["Стабильно","—"];
 return ["Аномалия", reasons.join(", ")];
}

async function stats(client,ch,range){
 const e=await client.getEntity(ch);
 const f=await client.invoke(new Api.channels.GetFullChannel({channel:e}));
 const subs=f?.fullChat?.participantsCount||0;
 const raw=await client.getMessages(e,{limit:1000});
 const posts=raw.filter(m=>{const d=toDate(m);return d&&d>=range.start&&d<range.end&&!m.action});
 const views=posts.map(m=>m.views||0);
 const reacts=posts.map(reactions);
 const comm=posts.map(comments);
 const rep=posts.map(m=>m.forwards||0);

 const avgViews=avg(views), medViews=median(views);
 const avgR=avg(reacts), avgC=avg(comm), avgF=avg(rep);
 const tV=sum(views), tR=sum(reacts), tC=sum(comm), tF=sum(rep);

 const erV=pct(avgViews,subs);
 const erA=avgViews?+(((avgR+avgC+avgF)/avgViews)*100).toFixed(2):0;
 const eng=posts.length?+((tR+tC+tF)/posts.length).toFixed(2):0;
 const eng1000=tV?+(((tR+tC+tF)/tV)*1000).toFixed(2):0;
 const vir=pct(tF,tV);
 const vIndex=tV?+(((tF*2)+(tC*1.5)+tR)/tV*100).toFixed(2):0;
 const quality=+(erV*0.4+erA*0.3+vir*0.2+eng1000*0.1).toFixed(2);

 return {subs,avgViews,medViews,erV,erA,avgR,avgC,avgF,count:posts.length,tV,eng,eng1000,vir,vIndex,quality,
 best:Math.max(...views,0),worst:views.length?Math.min(...views):0};
}

async function main(){
 console.log("STEP4");
 const c=await tg(); const s=await sheets(); const range=weekRange();
 const chs=process.env.CHANNELS.split(",").map(x=>x.trim()).filter(Boolean);
 let rows=[];
 for(const ch of chs){
  const prev=await prevRow(s,ch);
  const m=await stats(c,ch,range);

  const dSubs=delta(m.subs,prev?.subs);
  const dSubsPct=deltaPct(m.subs,prev?.subs);

  const dViews=delta(m.avgViews,prev?.avgViews);
  const dViewsPct=deltaPct(m.avgViews,prev?.avgViews);

  const dErV=delta(m.erV,prev?.erViews);
  const dErVPct=deltaPct(m.erV,prev?.erViews);

  const dErA=delta(m.erA,prev?.erAct);
  const dErAPct=deltaPct(m.erA,prev?.erAct);

  const dQ=delta(m.quality,prev?.quality);
  const dQPct=deltaPct(m.quality,prev?.quality);

  const [st,reason]=status(m,prev);

  rows.push([
   range.startStr,range.endStr,ch,m.subs,
   m.avgViews,m.medViews,
   m.erV,m.erA,
   m.avgR,m.avgC,m.avgF,
   m.count,m.tV,
   m.eng,m.eng1000,
   m.vir,m.vIndex,
   m.quality,
   m.best,m.worst,
   dSubs,dSubsPct,
   dViews,dViewsPct,
   dErV,dErVPct,
   dErA,dErAPct,
   dQ,dQPct,
   st,reason
  ]);
 }

 await s.spreadsheets.values.append({
  spreadsheetId:process.env.GOOGLE_SHEET_ID,
  range:"weekly_stats!A2",
  valueInputOption:"RAW",
  requestBody:{values:rows}
 });

 await c.disconnect();
 console.log("DONE");
}

main().catch(e=>{console.error(e);process.exit(1)});