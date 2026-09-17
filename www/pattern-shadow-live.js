(()=>{
  'use strict';

  const VERSION='V7.8.7.3_PATTERN_INTEGRITY';
  const CENSUS_KEY='mlb_v60_rank_census';
  const LEDGER_KEY='mlb_v7872_pattern_shadow'; // keep key to migrate/preserve V7.8.7.2 evidence
  const CENSUS_MIRROR_KEY='patternShadowV7873';
  const CUTOVER_DATE='2026-09-17';
  const REFRESH_MS=10000;

  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const num=(v,d=null)=>finite(v)?Number(v):d;
  const pct=v=>finite(v)?`${(Number(v)*100).toFixed(1)}%`:'—';
  const nowIso=()=>new Date().toISOString();

  function storeGet(key){
    try{
      if(typeof STORE!=='undefined'&&STORE?.getItem)return STORE.getItem(key);
    }catch{}
    try{return localStorage.getItem(key);}catch{return null;}
  }

  function storeSet(key,value){
    const text=typeof value==='string'?value:JSON.stringify(value);
    try{
      if(typeof STORE!=='undefined'&&STORE?.setItem){STORE.setItem(key,text);return true;}
    }catch{}
    try{localStorage.setItem(key,text);return true;}catch{return false;}
  }

  function readJSON(key,fallback){
    try{
      const raw=storeGet(key);
      if(!raw)return fallback;
      return JSON.parse(raw)??fallback;
    }catch{return fallback;}
  }

  function censusObject(){
    try{
      if(typeof rankCensus==='function')return rankCensus();
    }catch{}
    return readJSON(CENSUS_KEY,{days:{}})||{days:{}};
  }

  function censusRows(){
    const c=censusObject();
    const days=c&&typeof c==='object'&&c.days&&typeof c.days==='object'?c.days:{};
    const out=[];
    for(const [date,day] of Object.entries(days)){
      for(const r of Array.isArray(day?.rows)?day.rows:[]){
        if(!r||typeof r!=='object')continue;
        if(r.market&&String(r.market).toUpperCase()!=='TOTAL')continue;
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
    for(const k of ['lastProbability','p','decisionProbability'])if(finite(r?.[k]))return Number(r[k]);
    return null;
  }

  function latestEdge(r){
    for(const k of ['lastEdge','edge'])if(finite(r?.[k]))return Number(r[k]);
    return null;
  }

  function rawProbability(r){return num(r?.rawProbability);}

  function modelValues(r){
    const m=r?.modelProbabilities;
    if(!m||typeof m!=='object')return null;
    const vals=['struct','nb','pln','com'].map(k=>num(m[k]));
    return vals.every(Number.isFinite)?vals:null;
  }

  function strictStable(r){
    const drift=num(r?.probabilityDrift);
    const sf=num(r?.signalFlipCount),ssf=num(r?.sideFlipCount),lf=num(r?.lineChangeCount);
    return Number.isFinite(drift)&&Number.isFinite(sf)&&Number.isFinite(ssf)&&Number.isFinite(lf)&&
      sf===0&&ssf===0&&lf===0&&Math.abs(drift)<.01;
  }

  function statusOf(r){return String(r?.status||'').toUpperCase().replace(/\s+/g,'_');}
  function isTerminalStatus(s){return ['FINAL','PUSH','WIN','LOSS','GAME_OVER','COMPLETED'].includes(String(s||'').toUpperCase());}
  function isFinal(r){return isTerminalStatus(statusOf(r));}

  function runtimeGame(gamePk){
    try{
      if(typeof S==='undefined'||!Array.isArray(S?.games))return null;
      return S.games.find(g=>String(g?.gamePk)===String(gamePk))||null;
    }catch{return null;}
  }

  function runtimeState(r){
    const gamePk=r?.gamePk||r?.gameId;
    const g=runtimeGame(gamePk);
    if(!g)return{known:false,live:false,final:false,actual:null};
    try{
      const meta=typeof gameMeta==='function'?gameMeta(g):null;
      const away=num(g?.teams?.away?.score),home=num(g?.teams?.home?.score);
      return{
        known:true,
        live:!!meta?.live,
        final:!!meta?.final,
        actual:Number.isFinite(away)&&Number.isFinite(home)?away+home:null
      };
    }catch{return{known:true,live:false,final:false,actual:null};}
  }

  function scheduledStart(r){
    const t=Date.parse(String(r?.gameDate||r?.startTime||''));
    return Number.isFinite(t)?t:null;
  }

  function isPregame(r){
    if(isFinal(r))return false;
    const s=statusOf(r);
    if(['LIVE','IN_PROGRESS','GAME_IN_PROGRESS'].includes(s))return false;
    const rt=runtimeState(r);
    if(rt.known)return !rt.live&&!rt.final;
    const start=scheduledStart(r);
    if(!Number.isFinite(start))return false; // integrity-first: unknown start is not prospective evidence
    return Date.now()<start;
  }

  function features(r){
    const side=String(r?.side||'').toUpperCase();
    const p=latestProbability(r),edge=latestEdge(r),raw=rawProbability(r),d=num(r?.dispersion);
    const models=modelValues(r),minModel=models?Math.min(...models):null;
    const all4=!!models&&models.every(v=>v>.50);
    const stable=strictStable(r);
    return{side,p,edge,raw,d,models,minModel,all4,stable};
  }

  function labelsFor(r){
    const f=features(r),labels=[];
    if(f.side!=='OVER'||!Number.isFinite(f.p))return labels;
    const strongBase=Number.isFinite(f.edge)&&f.edge>=.085&&Number.isFinite(f.raw)&&f.raw>f.p&&
      f.all4&&Number.isFinite(f.minModel)&&f.minModel>=.53&&f.stable&&f.p>=.58;
    if(strongBase&&Number.isFinite(f.d)&&f.d>.14&&f.d<=.16)labels.push('A');
    if(strongBase&&Number.isFinite(f.d)&&f.d>=.08&&f.d<=.12)labels.push('A2');
    if(f.all4&&Number.isFinite(f.raw)&&f.raw>f.p&&f.stable)labels.push('B');
    if(f.p>=.50&&((Number.isFinite(f.raw)&&f.raw<.50)||(f.models&&!f.all4)))labels.push('C');
    return [...new Set(labels)];
  }

  function primaryLabel(labels=[]){
    if(labels.includes('A'))return 'PATTERN A · .14–.16';
    if(labels.includes('A2'))return 'PATTERN A2 · SIBLING';
    if(labels.includes('B'))return '4/4 UNANIMOUS OVER';
    if(labels.includes('C'))return 'MIXED / CALIBRATION';
    return '';
  }

  function rowIdentity(r){return{away:String(r?.awayAbbr||r?.away||r?.awayTeam||'').trim(),home:String(r?.homeAbbr||r?.home||r?.homeTeam||'').trim()};}
  function gameKey(r){return [String(r?.date||''),String(r?.gamePk||r?.gameId||'')].join('|');}

  function snapshotSignature(s){
    if(!s)return '';
    return JSON.stringify({gameDate:s.gameDate,side:s.side,line:s.line,patterns:s.patterns,p:s.p,edge:s.edge,
      dispersion:s.dispersion,raw:s.raw,modelMin:s.modelMin,models:s.models,probabilityDrift:s.probabilityDrift,
      signalFlipCount:s.signalFlipCount,sideFlipCount:s.sideFlipCount,lineChangeCount:s.lineChangeCount,stable:s.stable});
  }

  function metricSnapshot(r,patterns=labelsFor(r)){
    const f=features(r),id=rowIdentity(r);
    return{
      at:nowIso(),date:String(r?.date||''),gamePk:Number(r?.gamePk||r?.gameId)||0,gameDate:String(r?.gameDate||''),
      away:id.away,home:id.home,side:f.side,line:num(r?.line),patterns:[...patterns],p:f.p,edge:f.edge,
      dispersion:f.d,raw:f.raw,modelMin:f.minModel,
      models:f.models?{struct:f.models[0],nb:f.models[1],pln:f.models[2],com:f.models[3]}:null,
      probabilityDrift:num(r?.probabilityDrift),signalFlipCount:num(r?.signalFlipCount),
      sideFlipCount:num(r?.sideFlipCount),lineChangeCount:num(r?.lineChangeCount),stable:f.stable
    };
  }

  function migrateRow(x){
    if(!x||typeof x!=='object')return null;
    const first=x.first||{
      at:x.capturedAt||nowIso(),date:String(x.date||''),gamePk:Number(x.gamePk)||0,gameDate:String(x.gameDate||''),
      away:String(x.away||''),home:String(x.home||''),side:String(x.side||''),line:num(x.line),patterns:[...(x.patterns||[])],
      p:num(x.p),edge:num(x.edge),dispersion:num(x.dispersion),raw:num(x.raw),modelMin:num(x.modelMin),models:x.models||null,
      probabilityDrift:num(x.probabilityDrift),signalFlipCount:num(x.signalFlipCount),sideFlipCount:num(x.sideFlipCount),
      lineChangeCount:num(x.lineChangeCount),stable:null
    };
    const close=x.close||{...first,at:x.lastPregameAt||first.at,patterns:[...(x.closePatterns||x.patterns||[])]};
    return{
      key:[String(x.date||first.date||''),String(x.gamePk||first.gamePk||'')].join('|'),
      date:String(x.date||first.date||''),gamePk:Number(x.gamePk||first.gamePk)||0,
      away:String(x.away||first.away||''),home:String(x.home||first.home||''),
      first,close,firstPatterns:[...(x.firstPatterns||x.patterns||first.patterns||[])],
      closePatterns:[...(x.closePatterns||close.patterns||x.patterns||[])],
      firstCapturedAt:x.firstCapturedAt||x.capturedAt||first.at,
      lastPregameAt:x.lastPregameAt||close.at,
      closeLockedAt:x.closeLockedAt||null,
      status:String(x.status||'PENDING').toUpperCase(),outcome:x.outcome||null,actual:num(x.actual),
      settledAt:x.settledAt||null,schema:Number(x.schema)||3,migratedFrom:x.schema?null:'V7.8.7.2'
    };
  }

  function normalizeState(raw){
    const rows=(Array.isArray(raw?.rows)?raw.rows:[]).map(migrateRow).filter(Boolean);
    const map=new Map();
    for(const x of rows){
      const prev=map.get(x.key);
      if(!prev){map.set(x.key,x);continue;}
      const prevRank=isTerminalStatus(prev.status)?2:1,rank=isTerminalStatus(x.status)?2:1;
      const pt=Date.parse(prev.settledAt||prev.lastPregameAt||prev.firstCapturedAt||'')||0;
      const xt=Date.parse(x.settledAt||x.lastPregameAt||x.firstCapturedAt||'')||0;
      if(rank>prevRank||(rank===prevRank&&xt>=pt))map.set(x.key,{...prev,...x,first:prev.first||x.first,firstPatterns:prev.firstPatterns?.length?prev.firstPatterns:x.firstPatterns});
    }
    return{version:VERSION,schema:3,cutoverDate:CUTOVER_DATE,updatedAt:raw?.updatedAt||null,rows:[...map.values()]};
  }

  function ledger(){
    const local=readJSON(LEDGER_KEY,null);
    let mirror=null;
    try{mirror=censusObject()?.[CENSUS_MIRROR_KEY]||null;}catch{}
    const candidates=[local,mirror].filter(Boolean).map(normalizeState);
    if(!candidates.length)return normalizeState({rows:[]});
    candidates.sort((a,b)=>(Date.parse(b.updatedAt||'')||0)-(Date.parse(a.updatedAt||'')||0));
    const merged=normalizeState({rows:candidates.flatMap(x=>x.rows)});
    merged.updatedAt=candidates[0]?.updatedAt||null;
    return merged;
  }

  function persist(state){
    state.version=VERSION;state.schema=3;state.updatedAt=nowIso();
    storeSet(LEDGER_KEY,state);
    try{
      if(typeof rankCensus==='function'&&typeof saveRankCensus==='function'){
        const c=rankCensus();
        c[CENSUS_MIRROR_KEY]=state;
        saveRankCensus(c); // mirror enters SQLite snapshot, Censo JSON and Rolling Backup payloads
      }
    }catch(e){console.warn('Pattern mirror',e);}
  }

  function outcomeByLine(side,line,actual){
    if(!Number.isFinite(line)||!Number.isFinite(actual))return null;
    if(actual===line)return 'PUSH';
    if(side==='OVER')return actual>line?'WIN':'LOSS';
    if(side==='UNDER')return actual<line?'WIN':'LOSS';
    return null;
  }

  function settlementFromRow(r,x){
    const s=statusOf(r),close=x?.close||x?.first||{};
    if(s==='PUSH')return{outcome:'PUSH',actual:num(r?.actual)};
    const actual=num(r?.actual);
    const out=outcomeByLine(String(close.side||r?.side||'').toUpperCase(),num(close.line,num(r?.line)),actual);
    if(out)return{outcome:out,actual};
    if(['FINAL','WIN','LOSS','GAME_OVER','COMPLETED'].includes(s)&&finite(r?.y))return{outcome:Number(r.y)===1?'WIN':'LOSS',actual};
    return null;
  }

  function settlementFromRuntime(x){
    const rt=runtimeState({gamePk:x.gamePk});
    if(!rt.final)return null;
    const close=x?.close||x?.first||{};
    const out=outcomeByLine(String(close.side||'').toUpperCase(),num(close.line),num(rt.actual));
    return out?{outcome:out,actual:num(rt.actual)}:null;
  }

  function updateLedger(rows){
    const state=ledger();
    let changed=false;
    const byKey=new Map(state.rows.map(x=>[x.key,x]));

    for(const r of rows){
      const date=String(r?.date||'');
      if(!date||date<CUTOVER_DATE)continue;
      const key=gameKey(r),patterns=labelsFor(r),pregame=isPregame(r),existing=byKey.get(key);

      if(pregame&&patterns.length&&!existing){
        const snap=metricSnapshot(r,patterns);
        const x={key,date,gamePk:snap.gamePk,away:snap.away,home:snap.home,first:snap,close:{...snap},
          firstPatterns:[...patterns],closePatterns:[...patterns],firstCapturedAt:snap.at,lastPregameAt:snap.at,
          closeLockedAt:null,status:'PENDING',outcome:null,actual:null,settledAt:null,schema:3,migratedFrom:null};
        state.rows.push(x);byKey.set(key,x);changed=true;
      }else if(pregame&&existing&&existing.status!=='FINAL'){
        const snap=metricSnapshot(r,patterns); // update CLOSE even when patterns become empty
        if(snapshotSignature(existing.close)!==snapshotSignature(snap)){
          existing.close=snap;existing.closePatterns=[...patterns];existing.lastPregameAt=snap.at;
          existing.away=snap.away||existing.away;existing.home=snap.home||existing.home;
          changed=true;
        }
      }
    }

    for(const x of state.rows){
      if(x.status==='FINAL')continue;
      const r=rows.find(q=>gameKey(q)===x.key)||null;
      if(!x.closeLockedAt&&r&&!isPregame(r)){x.closeLockedAt=nowIso();changed=true;}

      let settled=r?settlementFromRow(r,x):null;
      if(!settled)settled=settlementFromRuntime(x);
      if(!settled)continue;
      x.status='FINAL';x.outcome=settled.outcome;x.actual=settled.actual;x.settledAt=nowIso();
      if(!x.closeLockedAt)x.closeLockedAt=x.settledAt;
      changed=true;
    }

    if(changed)persist(state);
    return state;
  }

  function effectivePatterns(x){return Array.isArray(x?.closePatterns)?x.closePatterns:(x?.patterns||[]);}
  function statsFor(state,pattern){
    const eligible=state.rows.filter(x=>effectivePatterns(x).includes(pattern));
    const rows=eligible.filter(x=>x.status==='FINAL');
    return{n:rows.length,w:rows.filter(x=>x.outcome==='WIN').length,l:rows.filter(x=>x.outcome==='LOSS').length,
      p:rows.filter(x=>x.outcome==='PUSH').length,pending:eligible.filter(x=>x.status!=='FINAL').length};
  }

  function integrityReport(){
    const tests=[];const test=(name,ok)=>tests.push({name,ok:!!ok});
    test('null no se convierte en 0',num(null)===null&&num('')===null);
    test('PUSH es terminal',isTerminalStatus('PUSH'));
    const a2={side:'OVER',p:.59,lastProbability:.59,edge:.09,lastEdge:.09,rawProbability:.61,dispersion:.10,
      modelProbabilities:{struct:.55,nb:.56,pln:.62,com:.65},probabilityDrift:0,signalFlipCount:0,sideFlipCount:0,lineChangeCount:0};
    test('A2 rule congelada',labelsFor(a2).includes('A2'));
    const mixed={...a2,p:.53,lastProbability:.53,edge:.04,lastEdge:.04,rawProbability:.52,modelProbabilities:{struct:.49,nb:.52,pln:.55,com:.56}};
    test('Mixed detecta motor <=50%',labelsFor(mixed).includes('C'));
    const passed=tests.filter(x=>x.ok).length;
    return{ok:passed===tests.length,passed,total:tests.length,tests,ranAt:nowIso()};
  }

  function currentRows(allRows){
    const date=selectedDate();
    return allRows.filter(r=>String(r.date||'')===date&&isPregame(r)&&labelsFor(r).length).sort((a,b)=>{
      const la=labelsFor(a),lb=labelsFor(b),priority=x=>x.includes('A')?0:x.includes('A2')?1:x.includes('B')?2:3;
      const pa=priority(la),pb=priority(lb);return pa!==pb?pa-pb:(latestProbability(b)||0)-(latestProbability(a)||0);
    });
  }

  function candidateHtml(r){
    const id=rowIdentity(r),f=features(r),labels=labelsFor(r),label=primaryLabel(labels);
    return `<div class="ps-row ps-${esc(labels[0]||'C').toLowerCase()}"><div class="ps-main"><b>${esc(id.away||'—')} @ ${esc(id.home||'—')} · ${esc(f.side)} ${esc(r?.line??'—')}</b><div class="ps-note">${esc(label)} · P ${pct(f.p)} · edge ${pct(f.edge)} · disp ${pct(f.d)} · RAW ${pct(f.raw)} · min modelo ${pct(f.minModel)}</div></div><span class="ps-pill">${esc(label)}</span></div>`;
  }

  function statChip(label,s){return `<span><b>${label}</b> ${s.w}-${s.l}-${s.p}${s.pending?` · ${s.pending} pend.`:''}</span>`;}

  function renderSection(allRows,state,integrity){
    const body=$('#csv1-body');if(!body)return;
    let section=$('#pattern-shadow-section');
    if(!section){section=document.createElement('section');section.id='pattern-shadow-section';const d16=$('#d16-current-section');if(d16?.parentElement===body)d16.insertAdjacentElement('afterend',section);else body.prepend(section);}
    const rows=currentRows(allRows),A=statsFor(state,'A'),A2=statsFor(state,'A2'),B=statsFor(state,'B'),C=statsFor(state,'C');
    const dropped=state.rows.filter(x=>x.firstPatterns?.length&&!effectivePatterns(x).length).length;
    section.innerHTML=`<h3>Pattern Auditor · prospectivo</h3>
      <div class="ps-baseline"><b>Baseline congelado:</b> A .14–.16 = 4-0 · A2 Sibling = 1-0 (SEA–LAA). Desde ${esc(CUTOVER_DATE)} no se reajustan reglas por resultados.</div>
      <div class="ps-integrity ${integrity.ok?'ok':'bad'}"><b>Pattern Integrity ${integrity.ok?'PASS':'FAIL'} ${integrity.passed}/${integrity.total}</b> · CLOSE snapshot activo · bloqueo al iniciar · PUSH terminal · espejo Censo/Data Vault.</div>
      <div class="ps-stats">${statChip('A',A)}${statChip('A2',A2)}${statChip('B',B)}${statChip('C',C)}</div>
      ${dropped?`<div class="ps-audit-note">${dropped} candidato(s) aparecieron durante el día pero ya no cumplían al CLOSE; no cuentan en W-L-P.</div>`:''}
      ${rows.length?`<div class="ps-list">${rows.map(candidateHtml).join('')}</div>`:`<div class="ps-empty">No hay coincidencias Pattern Shadow pregame para ${esc(selectedDate()||'la fecha seleccionada')}.</div>`}
      <div class="ps-rules"><b>Reglas congeladas:</b> A = OVER, P≥58%, edge≥8.5%, disp &gt;14% y ≤16%, 4/4 motores &gt;50%, min≥53%, RAW&gt;P y estabilidad estricta. A2 = igual, pero disp 8–12%. B = OVER + 4/4 &gt;50% + RAW&gt;P + estabilidad estricta. C = OVER con P≥50% pero RAW&lt;50% o al menos un motor ≤50%. <b>B es familia amplia e incluye A/A2.</b> El récord usa exclusivamente la última fotografía pregame (CLOSE). <b>No altera Core, ranking, gates ni picks.</b></div>`;
  }

  function normText(v){return String(v??'').toUpperCase().replace(/\s+/g,' ').trim();}
  function findRowForElement(el,rows){
    const direct=el?.dataset?.open;
    if(direct){const hit=rows.find(r=>String(r?.gamePk||r?.gameId)===String(direct));if(hit)return hit;}
    const text=normText(el.textContent),matches=rows.filter(r=>{const {away,home}=rowIdentity(r);return away&&home&&text.includes(normText(away))&&text.includes(normText(home));});
    if(matches.length<=1)return matches[0]||null;
    const lineMatches=matches.filter(r=>text.includes(normText(String(r?.line??''))));
    return lineMatches.length===1?lineMatches[0]:null;
  }

  function upsertBadge(host,r,kind){
    let badge=host.querySelector(`.ps-${kind}-badge`);if(!r){badge?.remove();return;}
    const label=primaryLabel(labelsFor(r));if(!label){badge?.remove();return;}
    if(!badge){badge=document.createElement('div');badge.className=`ps-${kind}-badge`;if(kind==='rank')(host.querySelector('.meta')?.parentElement||host).appendChild(badge);else{const target=host.querySelector('.sc-analysis')||host.querySelector('.sc-schedule')||host.querySelector('.sc-live-row')||host.querySelector('.sc-pitchers')||host.querySelector('.sc-teams');if(target&&target!==host)target.insertAdjacentElement('afterend',badge);else host.appendChild(badge);}}
    badge.textContent=label;const f=features(r);badge.title=`${label} · P ${pct(f.p)} · edge ${pct(f.edge)} · disp ${pct(f.d)} · RAW ${pct(f.raw)} · min ${pct(f.minModel)}`;
  }

  function annotate(allRows){
    const rows=currentRows(allRows);
    document.querySelectorAll('.rankrow').forEach(el=>upsertBadge(el,findRowForElement(el,rows),'rank'));
    document.querySelectorAll('.game.scorecard').forEach(el=>upsertBadge(el,findRowForElement(el,rows),'game'));
  }

  function styles(){
    if($('#pattern-shadow-style'))return;
    const s=document.createElement('style');s.id='pattern-shadow-style';s.textContent=`
      #pattern-shadow-section{margin:18px 0}.ps-baseline,.ps-rules,.ps-empty,.ps-integrity,.ps-audit-note{padding:12px 14px;border-left:4px solid #22c55e;background:rgba(34,197,94,.08);border-radius:12px;margin:9px 0;line-height:1.5}
      .ps-rules{border-left-color:#38bdf8;background:rgba(56,189,248,.08);font-size:12px}.ps-integrity{border-left-color:#22c55e;font-size:12px}.ps-integrity.bad{border-left-color:#ef4444;background:rgba(239,68,68,.08)}.ps-audit-note{border-left-color:#f59e0b;background:rgba(245,158,11,.08);font-size:12px}
      .ps-stats{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.ps-stats span{border:1px solid rgba(148,163,184,.35);border-radius:999px;padding:7px 10px;background:rgba(15,23,42,.55);font-size:12px}
      .ps-list{display:grid;gap:10px}.ps-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;border:1px solid rgba(34,197,94,.45);border-radius:15px;background:rgba(34,197,94,.07)}
      .ps-a{border-color:rgba(168,85,247,.65);background:rgba(88,28,135,.14)}.ps-a2{border-color:rgba(34,197,94,.65);background:rgba(20,83,45,.16)}.ps-b{border-color:rgba(56,189,248,.55);background:rgba(12,74,110,.14)}.ps-c{border-color:rgba(251,191,36,.55);background:rgba(120,53,15,.12)}
      .ps-main{min-width:0}.ps-main b{display:block}.ps-note{opacity:.78;font-size:12px;line-height:1.4;margin-top:4px}.ps-pill,.ps-rank-badge,.ps-game-badge{display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(56,189,248,.55);background:rgba(12,74,110,.32);color:#dbeafe;border-radius:999px;font-weight:900;font-size:10px;line-height:1.2;padding:6px 9px}.ps-rank-badge{margin-top:5px;width:max-content}.ps-game-badge{margin:7px 12px 9px;width:max-content;max-width:calc(100% - 24px)}
      @media(max-width:650px){.ps-row{align-items:flex-start;flex-direction:column}.ps-pill{align-self:flex-start}}`;
    document.head.appendChild(s);
  }

  function refresh(){
    try{
      styles();const allRows=censusRows(),state=updateLedger(allRows),integrity=integrityReport();
      renderSection(allRows,state,integrity);annotate(allRows);
      window.__MLB_PATTERN_SHADOW__={version:VERSION,cutoverDate:CUTOVER_DATE,state};
      window.__MLB_PATTERN_INTEGRITY__=integrity;
    }catch(e){console.warn('Pattern Integrity refresh',e);}
  }

  let timer=null;
  function schedule(delay=150){clearTimeout(timer);timer=setTimeout(refresh,delay);}
  function mount(){
    refresh();setInterval(refresh,REFRESH_MS);
    document.addEventListener('change',e=>{if(e.target?.id==='date')schedule();});
    document.addEventListener('click',()=>schedule(250));
    window.addEventListener('focus',()=>schedule(100));
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
