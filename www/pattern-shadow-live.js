(()=>{
  'use strict';

  const VERSION='V7.8.7.2_PATTERN_SHADOW';
  const CENSUS_KEY='mlb_v60_rank_census';
  const LEDGER_KEY='mlb_v7872_pattern_shadow';
  const CUTOVER_DATE='2026-09-17';

  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const pct=v=>Number.isFinite(+v)?`${(+v*100).toFixed(1)}%`:'—';
  const n=(v,d=null)=>Number.isFinite(+v)?+v:d;

  function readJSON(key,fallback){
    try{
      const raw=localStorage.getItem(key);
      if(!raw)return fallback;
      return JSON.parse(raw)??fallback;
    }catch{return fallback;}
  }

  function writeJSON(key,value){
    try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}
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
    for(const k of ['lastProbability','p','decisionProbability']){
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

  function rawProbability(r){
    const v=+r?.rawProbability;
    return Number.isFinite(v)?v:null;
  }

  function modelValues(r){
    const m=r?.modelProbabilities;
    if(!m||typeof m!=='object')return null;
    const vals=['struct','nb','pln','com'].map(k=>+m[k]);
    return vals.every(Number.isFinite)?vals:null;
  }

  function strictStable(r){
    const drift=+r?.probabilityDrift;
    return Number(r?.signalFlipCount||0)===0 &&
      Number(r?.sideFlipCount||0)===0 &&
      Number(r?.lineChangeCount||0)===0 &&
      Number.isFinite(drift) && Math.abs(drift)<.01;
  }

  function isPregame(r){
    const s=String(r?.status||'').toUpperCase();
    return !['FINAL','LIVE','IN_PROGRESS','IN PROGRESS','GAME_OVER','COMPLETED'].includes(s);
  }

  function isFinal(r){
    return ['FINAL','GAME_OVER','COMPLETED'].includes(String(r?.status||'').toUpperCase());
  }

  function features(r){
    const side=String(r?.side||'').toUpperCase();
    const p=latestProbability(r);
    const edge=latestEdge(r);
    const raw=rawProbability(r);
    const d=n(r?.dispersion);
    const models=modelValues(r);
    const minModel=models?Math.min(...models):null;
    const all4=!!models && models.every(v=>v>.50);
    const stable=strictStable(r);
    return{side,p,edge,raw,d,models,minModel,all4,stable};
  }

  function labelsFor(r){
    const f=features(r);
    const labels=[];
    if(f.side!=='OVER' || !Number.isFinite(f.p))return labels;

    const strongBase=Number.isFinite(f.edge)&&f.edge>=.085 &&
      Number.isFinite(f.raw)&&f.raw>f.p &&
      f.all4 && Number.isFinite(f.minModel)&&f.minModel>=.53 &&
      f.stable && f.p>=.58;

    if(strongBase && Number.isFinite(f.d) && f.d>.14 && f.d<=.16){
      labels.push('A');
    }
    if(strongBase && Number.isFinite(f.d) && f.d>=.08 && f.d<=.12){
      labels.push('A2');
    }
    if(f.all4 && Number.isFinite(f.raw)&&f.raw>f.p && f.stable){
      labels.push('B');
    }
    if(f.p>=.50 && (Number.isFinite(f.raw)&&f.raw<.50 || (f.models && !f.all4))){
      labels.push('C');
    }
    return [...new Set(labels)];
  }

  function primaryLabel(labels=[]){
    if(labels.includes('A'))return 'PATTERN A · .14–.16';
    if(labels.includes('A2'))return 'PATTERN A2 · SIBLING';
    if(labels.includes('B'))return '4/4 UNANIMOUS OVER';
    if(labels.includes('C'))return 'MIXED / CALIBRATION';
    return '';
  }

  function rowIdentity(r){
    return{
      away:String(r?.awayAbbr||r?.away||r?.awayTeam||'').trim(),
      home:String(r?.homeAbbr||r?.home||r?.homeTeam||'').trim()
    };
  }

  function outcomeOf(r){
    if(!isFinal(r))return null;
    const side=String(r?.side||'').toUpperCase();
    const line=+r?.line;
    const actual=+r?.actual;
    if(!Number.isFinite(line)||!Number.isFinite(actual))return null;
    if(actual===line)return 'PUSH';
    if(side==='OVER')return actual>line?'WIN':'LOSS';
    if(side==='UNDER')return actual<line?'WIN':'LOSS';
    return null;
  }

  function ledger(){
    const x=readJSON(LEDGER_KEY,{version:VERSION,cutoverDate:CUTOVER_DATE,rows:[]});
    return{
      version:VERSION,
      cutoverDate:CUTOVER_DATE,
      rows:Array.isArray(x?.rows)?x.rows:[]
    };
  }

  function ledgerKey(r){
    return [String(r?.date||''),String(r?.gamePk||r?.gameId||''),String(r?.side||''),String(r?.line??'')].join('|');
  }

  function snapshot(r,patterns){
    const f=features(r);
    const id=rowIdentity(r);
    return{
      key:ledgerKey(r),
      date:String(r?.date||''),
      gamePk:Number(r?.gamePk||r?.gameId)||0,
      away:id.away,
      home:id.home,
      side:f.side,
      line:n(r?.line),
      patterns:[...patterns],
      p:f.p,
      edge:f.edge,
      dispersion:f.d,
      raw:f.raw,
      modelMin:f.minModel,
      models:f.models?{struct:f.models[0],nb:f.models[1],pln:f.models[2],com:f.models[3]}:null,
      probabilityDrift:n(r?.probabilityDrift),
      signalFlipCount:Number(r?.signalFlipCount||0),
      sideFlipCount:Number(r?.sideFlipCount||0),
      lineChangeCount:Number(r?.lineChangeCount||0),
      capturedAt:new Date().toISOString(),
      status:'PENDING',
      outcome:null,
      actual:null,
      settledAt:null
    };
  }

  function updateLedger(rows){
    const state=ledger();
    let changed=false;
    const byKey=new Map(state.rows.map(x=>[x.key,x]));

    for(const r of rows){
      const date=String(r?.date||'');
      if(!date || date<CUTOVER_DATE)continue;
      const key=ledgerKey(r);
      const patterns=labelsFor(r);
      if(isPregame(r) && patterns.length && !byKey.has(key)){
        const s=snapshot(r,patterns);
        state.rows.push(s);
        byKey.set(key,s);
        changed=true;
      }
    }

    for(const r of rows){
      const key=ledgerKey(r);
      const x=byKey.get(key);
      if(!x || x.status==='FINAL' || !isFinal(r))continue;
      const out=outcomeOf(r);
      if(!out)continue;
      x.status='FINAL';
      x.outcome=out;
      x.actual=n(r?.actual);
      x.settledAt=new Date().toISOString();
      changed=true;
    }

    if(changed)writeJSON(LEDGER_KEY,state);
    return state;
  }

  function statsFor(state,pattern){
    const rows=state.rows.filter(x=>x.patterns?.includes(pattern) && x.status==='FINAL');
    return{
      n:rows.length,
      w:rows.filter(x=>x.outcome==='WIN').length,
      l:rows.filter(x=>x.outcome==='LOSS').length,
      p:rows.filter(x=>x.outcome==='PUSH').length
    };
  }

  function currentRows(allRows){
    const date=selectedDate();
    return allRows
      .filter(r=>String(r.date||'')===date && isPregame(r) && labelsFor(r).length)
      .sort((a,b)=>{
        const la=labelsFor(a),lb=labelsFor(b);
        const priority=x=>x.includes('A')?0:x.includes('A2')?1:x.includes('B')?2:3;
        const pa=priority(la),pb=priority(lb);
        if(pa!==pb)return pa-pb;
        return (latestProbability(b)||0)-(latestProbability(a)||0);
      });
  }

  function candidateHtml(r){
    const id=rowIdentity(r);
    const f=features(r);
    const labels=labelsFor(r);
    const label=primaryLabel(labels);
    return `<div class="ps-row ps-${esc(labels[0]||'C').toLowerCase()}">
      <div class="ps-main">
        <b>${esc(id.away||'—')} @ ${esc(id.home||'—')} · ${esc(f.side)} ${esc(r?.line??'—')}</b>
        <div class="ps-note">${esc(label)} · P ${pct(f.p)} · edge ${pct(f.edge)} · disp ${pct(f.d)} · RAW ${pct(f.raw)} · min modelo ${pct(f.minModel)}</div>
      </div>
      <span class="ps-pill">${esc(label)}</span>
    </div>`;
  }

  function renderSection(allRows,state){
    const body=$('#csv1-body');
    if(!body)return;
    let section=$('#pattern-shadow-section');
    if(!section){
      section=document.createElement('section');
      section.id='pattern-shadow-section';
      const d16=$('#d16-current-section');
      if(d16?.parentElement===body)d16.insertAdjacentElement('afterend',section);
      else body.prepend(section);
    }

    const rows=currentRows(allRows);
    const A=statsFor(state,'A'),A2=statsFor(state,'A2'),B=statsFor(state,'B'),C=statsFor(state,'C');
    section.innerHTML=`
      <h3>Pattern Auditor · prospectivo</h3>
      <div class="ps-baseline"><b>Baseline congelado:</b> A .14–.16 = 4-0 · A2 Sibling = 1-0 (SEA–LAA). Desde ${esc(CUTOVER_DATE)} no se reajustan reglas por resultados.</div>
      <div class="ps-stats">
        <span><b>A</b> ${A.w}-${A.l}-${A.p}</span>
        <span><b>A2</b> ${A2.w}-${A2.l}-${A2.p}</span>
        <span><b>B</b> ${B.w}-${B.l}-${B.p}</span>
        <span><b>C</b> ${C.w}-${C.l}-${C.p}</span>
      </div>
      ${rows.length?`<div class="ps-list">${rows.map(candidateHtml).join('')}</div>`:`<div class="ps-empty">No hay coincidencias Pattern Shadow pregame para ${esc(selectedDate()||'la fecha seleccionada')}.</div>`}
      <div class="ps-rules"><b>Reglas congeladas:</b> A = OVER, P≥58%, edge≥8.5%, disp &gt;14% y ≤16%, 4/4 motores &gt;50%, min≥53%, RAW&gt;P y estabilidad estricta. A2 = igual, pero disp 8–12%. B = OVER + 4/4 &gt;50% + RAW&gt;P + estabilidad estricta. C = OVER con P≥50% pero RAW&lt;50% o al menos un motor ≤50%. <b>No altera Core, ranking, gates ni picks.</b></div>
    `;
  }

  function normText(v){return String(v??'').toUpperCase().replace(/\s+/g,' ').trim();}

  function findRowForElement(el,rows){
    const text=normText(el.textContent);
    const matches=rows.filter(r=>{
      const {away,home}=rowIdentity(r);
      return away && home && text.includes(normText(away)) && text.includes(normText(home));
    });
    return matches.length===1?matches[0]:null;
  }

  function upsertBadge(host,r,kind){
    let badge=host.querySelector(`.ps-${kind}-badge`);
    if(!r){badge?.remove();return;}
    const label=primaryLabel(labelsFor(r));
    if(!label){badge?.remove();return;}
    if(!badge){
      badge=document.createElement('div');
      badge.className=`ps-${kind}-badge`;
      if(kind==='rank'){
        (host.querySelector('.meta')?.parentElement||host).appendChild(badge);
      }else{
        const target=host.querySelector('.sc-analysis')||host.querySelector('.sc-schedule')||host.querySelector('.sc-live-row')||host.querySelector('.sc-pitchers')||host.querySelector('.sc-teams');
        if(target&&target!==host)target.insertAdjacentElement('afterend',badge); else host.appendChild(badge);
      }
    }
    badge.textContent=label;
    const f=features(r);
    badge.title=`${label} · P ${pct(f.p)} · edge ${pct(f.edge)} · disp ${pct(f.d)} · RAW ${pct(f.raw)} · min ${pct(f.minModel)}`;
  }

  function annotate(allRows){
    const rows=currentRows(allRows);
    document.querySelectorAll('.rankrow').forEach(el=>upsertBadge(el,findRowForElement(el,rows),'rank'));
    document.querySelectorAll('.game.scorecard').forEach(el=>upsertBadge(el,findRowForElement(el,rows),'game'));
  }

  function styles(){
    if($('#pattern-shadow-style'))return;
    const s=document.createElement('style');
    s.id='pattern-shadow-style';
    s.textContent=`
      #pattern-shadow-section{margin:18px 0}
      .ps-baseline,.ps-rules,.ps-empty{padding:12px 14px;border-left:4px solid #22c55e;background:rgba(34,197,94,.08);border-radius:12px;margin:9px 0;line-height:1.5}
      .ps-rules{border-left-color:#38bdf8;background:rgba(56,189,248,.08);font-size:12px}
      .ps-stats{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.ps-stats span{border:1px solid rgba(148,163,184,.35);border-radius:999px;padding:7px 10px;background:rgba(15,23,42,.55);font-size:12px}
      .ps-list{display:grid;gap:10px}.ps-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;border:1px solid rgba(34,197,94,.45);border-radius:15px;background:rgba(34,197,94,.07)}
      .ps-a{border-color:rgba(168,85,247,.65);background:rgba(88,28,135,.14)}.ps-a2{border-color:rgba(34,197,94,.65);background:rgba(20,83,45,.16)}.ps-b{border-color:rgba(56,189,248,.55);background:rgba(12,74,110,.14)}.ps-c{border-color:rgba(251,191,36,.55);background:rgba(120,53,15,.12)}
      .ps-main{min-width:0}.ps-main b{display:block}.ps-note{opacity:.78;font-size:12px;line-height:1.4;margin-top:4px}
      .ps-pill,.ps-rank-badge,.ps-game-badge{display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(56,189,248,.55);background:rgba(12,74,110,.32);color:#dbeafe;border-radius:999px;font-weight:900;font-size:10px;line-height:1.2;padding:6px 9px}
      .ps-rank-badge{margin-top:5px;width:max-content}.ps-game-badge{margin:7px 12px 9px;width:max-content;max-width:calc(100% - 24px)}
      @media(max-width:650px){.ps-row{align-items:flex-start;flex-direction:column}.ps-pill{align-self:flex-start}}
    `;
    document.head.appendChild(s);
  }

  function refresh(){
    try{
      styles();
      const allRows=censusRows();
      const state=updateLedger(allRows);
      renderSection(allRows,state);
      annotate(allRows);
      window.__MLB_PATTERN_SHADOW__={version:VERSION,cutoverDate:CUTOVER_DATE,state};
    }catch(e){console.warn('Pattern Shadow refresh',e);}
  }

  let timer=null;
  function schedule(){clearTimeout(timer);timer=setTimeout(refresh,120);}

  function mount(){
    refresh();
    setInterval(refresh,1800);
    document.addEventListener('change',e=>{if(e.target?.id==='date')schedule();});
    document.addEventListener('click',()=>setTimeout(refresh,220));
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();

