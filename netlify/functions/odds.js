'use strict';

const SITE='https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const CDN='https://cdn.espn.com/core/mlb/scoreboard';
const HEADER='https://site.api.espn.com/apis/v2/scoreboard/header?lang=en';

function cleanDate(v){
  const s=String(v||'').replace(/[^0-9]/g,'');
  return /^20\d{6}$/.test(s)?s:null;
}
function american(v){
  const s=String(v??'').trim().toUpperCase();
  if(['EVEN','EV','PK'].includes(s))return 100;
  const x=Number(s.replace(/[^+\-0-9.]/g,''));
  return Number.isFinite(x)&&x!==0?x:NaN;
}
function snap(o){
  if(!o)return null;
  if(Array.isArray(o)){for(const q of o){const x=snap(q);if(x)return x}return null}
  const total=o.total||{};
  const choose=z=>z?.current||z?.close||z?.open||{};
  const ov=choose(total.over),un=choose(total.under);
  const raw=ov.line||un.line||o.overUnder||o.totalLine;
  const line=Number(String(raw??'').replace(/[^0-9.]/g,''));
  const overAmerican=american(ov.odds??o.overOdds),underAmerican=american(un.odds??o.underOdds);
  if(!Number.isFinite(line)||line<4||line>16||!Number.isFinite(overAmerican)||!Number.isFinite(underAmerican))return null;
  return {line,overAmerican,underAmerican,book:o.provider?.displayName||o.provider?.name||'DraftKings'};
}
function teamName(c){
  return c?.team?.displayName||c?.team?.name||c?.displayName||c?.name||c?.team?.abbreviation||c?.abbreviation||'';
}
function collect(root){
  const out=[],seen=new Set();
  const walk=(x,d=0)=>{
    if(!x||d>14)return;
    if(Array.isArray(x)){for(const v of x)walk(v,d+1);return}
    if(typeof x!=='object')return;
    if(Array.isArray(x.competitors)&&x.odds){
      const away=x.competitors.find(c=>c?.homeAway==='away'),home=x.competitors.find(c=>c?.homeAway==='home');
      const q=snap(x.odds);
      if(away&&home&&q){
        const key=`${teamName(away)}|${teamName(home)}|${q.line}`;
        if(!seen.has(key)){seen.add(key);out.push({away:teamName(away),home:teamName(home),...q,eventId:x.id||x.competitionId||''})}
      }
    }
    for(const [k,v] of Object.entries(x)){
      if(['links','athletes','leaders','statistics','notes','headlines','news'].includes(k))continue;
      walk(v,d+1);
    }
  };
  walk(root);
  return out;
}
async function getJson(url,ms=15000){
  const c=new AbortController();
  const t=setTimeout(()=>c.abort(),ms);
  try{
    const r=await fetch(url,{signal:c.signal,headers:{'accept':'application/json','user-agent':'Mozilla/5.0 MLB-Totals-Lab/7.0'}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function trySource(name,url){
  try{const body=await getJson(url);const games=collect(body);return {name,games,error:''}}
  catch(e){return {name,games:[],error:e?.message||String(e)}}
}
exports.handler=async function(event){
  const date=cleanDate(event.queryStringParameters?.date);
  if(!date)return {statusCode:400,headers:{'content-type':'application/json','access-control-allow-origin':'*'},body:JSON.stringify({ok:false,error:'Fecha inválida. Usa YYYY-MM-DD.'})};
  const sources=[];
  sources.push(await trySource('ESPN site',`${SITE}?dates=${date}&limit=1000`));
  if(!sources[0].games.length)sources.push(await trySource('ESPN CDN',`${CDN}?xhr=1&dates=${date}`));
  const today=new Date().toISOString().slice(0,10).replace(/-/g,'');
  if(!sources.some(s=>s.games.length)&&date===today)sources.push(await trySource('ESPN header',HEADER));
  const map=new Map();
  for(const src of sources)for(const g of src.games){const k=`${g.away}|${g.home}`;if(!map.has(k))map.set(k,{...g,source:src.name,updated:new Date().toISOString(),url:SITE})}
  const games=[...map.values()];
  return {
    statusCode:games.length?200:502,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'},
    body:JSON.stringify({ok:games.length>0,date,games,diagnostics:sources.map(s=>({source:s.name,count:s.games.length,error:s.error}))})
  };
};
