(()=>{
  'use strict';

  const VERSION='V7.8.7.1_DISPERSION_LIVE_SHADOW';
  const CENSUS_KEY='mlb_v60_rank_census';

  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const n=(v,d=0)=>Number.isFinite(+v)?+v:d;
  const pct=v=>Number.isFinite(+v)?`${(+v*100).toFixed(1)}%`:'—';

  function readJSON(key,fallback){
    try{
      const raw=localStorage.getItem(key);
      if(!raw)return fallback;
      return JSON.parse(raw)??fallback;
    }catch{return fallback;}
  }

  function censusRows(){
    const c=readJSON(CENSUS_KEY,{days:{}});
    const days=c&&typeof c==='object'&&c.days&&typeof c.days==='object'?c.days:{};
    const out=[];
    for(const [date,day] of Object.entries(days)){
      for(const r of Array.isArray(day?.rows)?day.rows:[]){
        if(!r||typeof r!=='object')continue;
        if(r.market && String(r.market).toUpperCase()!=='TOTAL')continue;
        out.push({...r,date:r.date||date});
      }
    }
    return out;
  }

  function selectedDate(){
    const v=$('#date')?.value;
    if(v)return String(v);
    const dates=[...new Set(censusRows().map(r=>String(r.date||'')).filter(Boolean))].sort();
    return dates.at(-1)||'';
  }

  function latestProbability(r){
    for(const k of ['lastProbability','p','decisionProbability','rawProbability']){
      const v=+r?.[k];
      if(Number.isFinite(v))return v;
    }
    return null;
  }

  function latestEdge(r){
    for(const k of ['lastEdge','edge']){
      const v=+r?.[k];
      if(Number.isFinite(v))return v;
    }
    return null;
  }

  function finalSignal(r){
    return String(r?.lastSignal||r?.signal||'').toUpperCase();
  }

  function rowIdentity(r){
    return {
      away:String(r?.awayAbbr||r?.away||r?.awayTeam||'').trim(),
      home:String(r?.homeAbbr||r?.home||r?.homeTeam||'').trim()
    };
  }

  function isPregame(r){
    const s=String(r?.status||'').toUpperCase();
    return !['FINAL','LIVE','IN_PROGRESS','IN PROGRESS','GAME_OVER','COMPLETED'].includes(s);
  }

  function isDispersion16Candidate(r){
    const d=+r?.dispersion;
    const p=latestProbability(r);
    const e=latestEdge(r);
    const gate=String(r?.gateFailed||'').toUpperCase();
    return Number.isFinite(d) && d>.14 && d<=.16 &&
      Number.isFinite(p) && p>=.56 &&
      Number.isFinite(e) && e>=.035 &&
      gate==='DISPERSION';
  }

  function currentCandidates(){
    const date=selectedDate();
    return censusRows()
      .filter(r=>String(r.date||'')===date && isPregame(r) && isDispersion16Candidate(r))
      .sort((a,b)=>{
        const da=n(a?.dispersion,99),db=n(b?.dispersion,99);
        if(da!==db)return da-db;
        const pa=latestProbability(a)??-1,pb=latestProbability(b)??-1;
        return pb-pa;
      });
  }

  function candidateHtml(r){
    const id=rowIdentity(r);
    const side=String(r?.side||'—').toUpperCase();
    const line=Number.isFinite(+r?.line)?+r.line:'—';
    const p=latestProbability(r),e=latestEdge(r),d=+r?.dispersion;
    const sig=finalSignal(r)||'PASS';
    return `<div class="d16-row">
      <div class="d16-main">
        <b>${esc(id.away||'—')} @ ${esc(id.home||'—')} · ${esc(side)} ${esc(line)}</b>
        <div class="d16-note">${esc(sig)} oficial · prob ${pct(p)} · edge ${pct(e)} · dispersión ${pct(d)} · único gate: DISPERSION</div>
      </div>
      <span class="d16-pill">DISP .14→.16 · SHADOW</span>
    </div>`;
  }

  function renderSection(){
    const body=$('#csv1-body');
    if(!body)return;

    let section=$('#d16-current-section');
    if(!section){
      section=document.createElement('section');
      section.id='d16-current-section';
      const marker=[...body.querySelectorAll('h3')].find(h=>String(h.textContent||'').includes('Patrón prioritario'));
      if(marker)body.insertBefore(section,marker);
      else body.prepend(section);
    }

    const rows=currentCandidates();
    const date=selectedDate();
    section.innerHTML=`
      <h3>CANDIDATOS DISPERSIÓN .14→.16 · actuales</h3>
      ${rows.length
        ? `<div class="d16-summary"><b>${rows.length}</b> candidato${rows.length===1?'':'s'} Shadow</div>
           <div class="d16-list">${rows.map(candidateHtml).join('')}</div>`
        : `<div class="d16-callout"><b>${esc(date||'Fecha actual')}:</b> no hay candidatos .14→.16 activos ahora mismo.</div>`}
      <div class="d16-callout"><b>Regla:</b> sólo aparece si prob ≥56%, edge ≥3.5%, dispersión &gt;14% y ≤16%, y el único gate fallido es DISPERSION. Producción sigue intacta en .14.</div>
    `;
  }

  function normText(v){
    return String(v??'').toUpperCase().replace(/\s+/g,' ').trim();
  }

  function findRowForElement(el,rows){
    const text=normText(el.textContent);
    const matches=rows.filter(r=>{
      const {away,home}=rowIdentity(r);
      return away && home && text.includes(normText(away)) && text.includes(normText(home));
    });
    return matches.length===1?matches[0]:null;
  }

  function upsertBadge(host,r,kind){
    let badge=host.querySelector(`.d16-${kind}-badge`);
    if(!r){
      badge?.remove();
      return;
    }
    if(!badge){
      badge=document.createElement('div');
      badge.className=`d16-${kind}-badge`;
      if(kind==='rank'){
        (host.querySelector('.meta')?.parentElement || host).appendChild(badge);
      }else{
        const target=
          host.querySelector('.sc-analysis') ||
          host.querySelector('.sc-schedule') ||
          host.querySelector('.sc-live-row') ||
          host.querySelector('.sc-pitchers') ||
          host.querySelector('.sc-teams');
        if(target && target!==host)target.insertAdjacentElement('afterend',badge);
        else host.appendChild(badge);
      }
    }
    const d=+r?.dispersion;
    const p=latestProbability(r);
    const e=latestEdge(r);
    const text=`DISP .14→.16 · SHADOW`;
    const title=`Candidato Shadow · prob ${pct(p)} · edge ${pct(e)} · dispersión ${pct(d)} · único gate DISPERSION`;
    if(badge.textContent!==text)badge.textContent=text;
    if(badge.title!==title)badge.title=title;
  }

  function annotate(){
    const rows=currentCandidates();

    document.querySelectorAll('.rankrow').forEach(el=>{
      const r=findRowForElement(el,rows);
      upsertBadge(el,r,'rank');
    });

    document.querySelectorAll('.game.scorecard').forEach(el=>{
      const r=findRowForElement(el,rows);
      upsertBadge(el,r,'game');
    });

    document.querySelectorAll('.d16-rank-badge').forEach(b=>{
      if(!b.closest('.rankrow'))b.remove();
    });
    document.querySelectorAll('.d16-game-badge').forEach(b=>{
      if(!b.closest('.game.scorecard'))b.remove();
    });
  }

  function styles(){
    if($('#d16-live-style'))return;
    const s=document.createElement('style');
    s.id='d16-live-style';
    s.textContent=`
      #d16-current-section{margin:22px 0}
      .d16-list{display:grid;gap:12px;margin:10px 0}
      .d16-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;border:1px solid rgba(168,85,247,.55);border-radius:16px;background:rgba(88,28,135,.12)}
      .d16-main{min-width:0}.d16-main b{display:block;font-size:15px}.d16-note{opacity:.78;font-size:12px;line-height:1.45;margin-top:5px}
      .d16-pill,.d16-rank-badge,.d16-game-badge{display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(192,132,252,.65);background:rgba(88,28,135,.34);color:#e9d5ff;border-radius:999px;font-weight:900;font-size:11px;line-height:1.2;padding:7px 10px}
      .d16-summary{display:inline-flex;border:1px solid rgba(192,132,252,.45);border-radius:999px;padding:7px 11px;margin:4px 0 8px;background:rgba(88,28,135,.12)}
      .d16-callout{padding:13px 15px;border-left:4px solid #a855f7;background:rgba(88,28,135,.12);border-radius:12px;margin:10px 0;line-height:1.5}
      .d16-rank-badge{margin-top:6px;width:max-content}
      .d16-game-badge{margin:8px 12px 10px;width:max-content;max-width:calc(100% - 24px)}
      @media(max-width:650px){.d16-row{align-items:flex-start;flex-direction:column}.d16-pill{align-self:flex-start}}
    `;
    document.head.appendChild(s);
  }

  function refresh(){
    try{
      styles();
      renderSection();
      annotate();
    }catch{}
  }

  let timer=null;
  function schedule(){
    clearTimeout(timer);
    timer=setTimeout(refresh,120);
  }

  function mount(){
    styles();
    refresh();
    setInterval(refresh,1800);
    document.addEventListener('change',e=>{
      if(e.target?.id==='date')schedule();
    });
    document.addEventListener('click',()=>setTimeout(refresh,220));
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
