(()=>{
  'use strict';

  const VERSION='V7.8.6_CALIBRATION_SHADOW_1_2_1';
  const NOTICE='EXPERIMENTAL · READ ONLY · No modifica motores, pesos, probabilidades ni picks oficiales.';
  const KEYS={
    census:'mlb_v60_rank_census',
    shadow:'mlb_v786_team_shadow_lab',
    bets:'mlb_v5_bets',
    lab:'mlb_v5_lab'
  };

  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const n=(v,d=0)=>Number.isFinite(+v)?+v:d;
  const pct=v=>Number.isFinite(+v)?`${(+v*100).toFixed(1)}%`:'—';
  const roi=v=>Number.isFinite(+v)?`${(+v*100).toFixed(1)}%`:'—';
  const f2=v=>Number.isFinite(+v)?(+v).toFixed(3):'—';

  function readJSON(key,fallback){
    try{
      const raw=localStorage.getItem(key);
      if(!raw) return fallback;
      const x=JSON.parse(raw);
      return x??fallback;
    }catch{return fallback;}
  }

  function censusRows(){
    const c=readJSON(KEYS.census,{days:{}});
    const days=c&&typeof c==='object'&&c.days&&typeof c.days==='object'?c.days:{};
    const out=[];
    for(const [date,day] of Object.entries(days)){
      for(const r of Array.isArray(day?.rows)?day.rows:[]){
        if(!r||typeof r!=='object') continue;
        if(r.market && String(r.market).toUpperCase()!=='TOTAL') continue;
        out.push({...r,date:r.date||date});
      }
    }
    return out;
  }

  function settled(r){
    return String(r?.status||'').toUpperCase()==='FINAL' &&
      Number.isFinite(+r?.actual) && Number.isFinite(+r?.line) &&
      ['OVER','UNDER'].includes(String(r?.side||'').toUpperCase());
  }

  function outcome(r){
    if(!settled(r)) return null;
    const a=+r.actual,l=+r.line,s=String(r.side).toUpperCase();
    if(a===l) return 'P';
    return (s==='OVER' ? a>l : a<l) ? 'W' : 'L';
  }

  function unitProfit(r){
    const o=outcome(r);
    if(o==='P') return 0;
    if(o==='L') return -1;
    if(o==='W'){
      const odds=+r.odds;
      return Number.isFinite(odds)&&odds>1 ? odds-1 : 1;
    }
    return null;
  }

  function finalSignal(r){return String(r?.lastSignal||r?.signal||'').toUpperCase();}
  function hasTrace(r){return typeof r?.firstSignal==='string' && r.firstSignal.length>0;}
  function activeRank(r){
    for(const k of ['lastPregameActiveRank','lastActiveRank','activeRank','rank']){
      const v=+r?.[k];
      if(Number.isFinite(v)&&v>0) return v;
    }
    return null;
  }


  function selectedDate(){
    const value=$('#date')?.value;
    if(value) return String(value);
    const dates=[...new Set(censusRows().map(r=>String(r.date||'')).filter(Boolean))].sort();
    return dates[dates.length-1]||'';
  }

  function isCurrentPlayable(r){
    return finalSignal(r)==='JUGABLE' && r?.pass!==true;
  }

  function stabilityClass(r){
    if(!isCurrentPlayable(r)) return null;

    const first=String(r?.firstSignal||'').toUpperCase();
    const signalFlips=n(r?.signalFlipCount,0);
    const sideFlips=n(r?.sideFlipCount,0);

    if(!hasTrace(r)){
      return {
        key:'unknown',
        label:'JUGABLE · SIN TRAZA',
        short:'SIN TRAZA',
        note:'Todavía no hay Decision Trace suficiente para clasificar estabilidad.'
      };
    }

    if(
      first==='JUGABLE' &&
      signalFlips===0 &&
      sideFlips===0
    ){
      return {
        key:'stable',
        label:'JUGABLE ESTABLE',
        short:'ESTABLE',
        note:'Nació JUGABLE y no tuvo flips de señal ni de lado.'
      };
    }

    if(
      sideFlips>0 ||
      (first==='JUGABLE' && signalFlips>0) ||
      signalFlips>1
    ){
      return {
        key:'unstable',
        label:'JUGABLE · FLIP / INESTABLE',
        short:'FLIP',
        note:`Primera señal ${first||'—'} · señal flips ${signalFlips} · lado flips ${sideFlips}.`
      };
    }

    return {
      key:'promoted',
      label:'PROMOVIDO A JUGABLE',
      short:'PROMOVIDO',
      note:`Nació ${first||'PASS/LEAN/LAB'} y después subió a JUGABLE sin flip de lado.`
    };
  }

  function rowIdentity(r){
    const away=String(r?.awayAbbr||r?.away||r?.awayTeam||'').trim();
    const home=String(r?.homeAbbr||r?.home||r?.homeTeam||'').trim();
    return {away,home};
  }

  function currentPlayableRows(){
    const date=selectedDate();
    return censusRows()
      .filter(r=>String(r.date||'')===date && isCurrentPlayable(r))
      .sort((a,b)=>{
        const ra=activeRank(a),rb=activeRank(b);
        if(ra!==null && rb!==null) return ra-rb;
        if(ra!==null) return -1;
        if(rb!==null) return 1;
        return String(a.startTime||a.gameDate||'').localeCompare(String(b.startTime||b.gameDate||''));
      });
  }

  function liveRowHtml(r){
    const cls=stabilityClass(r);
    const id=rowIdentity(r);
    const first=String(r?.firstSignal||'—').toUpperCase();
    const current=finalSignal(r)||'—';
    const side=String(r?.side||'—').toUpperCase();
    const line=Number.isFinite(+r?.line)?+r.line:'—';
    const rank=activeRank(r);

    return `<div class="csv1-live-row ${esc(cls?.key||'unknown')}">
      <div class="csv1-live-main">
        <b>${esc(id.away||'—')} @ ${esc(id.home||'—')} · ${esc(side)} ${esc(line)}</b>
        <div class="csv1-note">Rank ${rank??'—'} · primera ${esc(first)} · actual ${esc(current)} · señal flips ${n(r?.signalFlipCount,0)} · lado flips ${n(r?.sideFlipCount,0)}</div>
      </div>
      <span class="csv1-live-badge ${esc(cls?.key||'unknown')}">${esc(cls?.label||'JUGABLE')}</span>
    </div>`;
  }

  function renderLiveJugables(){
    const rows=currentPlayableRows();
    const date=selectedDate();

    if(!rows.length){
      return `<div class="csv1-callout"><b>${esc(date||'Fecha actual')}:</b> no hay JUGABLES oficiales guardados en el Censo para clasificar ahora mismo.</div>`;
    }

    const counts={stable:0,promoted:0,unstable:0,unknown:0};
    for(const r of rows){
      const k=stabilityClass(r)?.key||'unknown';
      counts[k]=(counts[k]||0)+1;
    }

    return `
      <div class="csv1-live-summary">
        <span><b>${rows.length}</b> JUGABLES</span>
        <span class="stable"><b>${counts.stable}</b> estables</span>
        <span class="promoted"><b>${counts.promoted}</b> promovidos</span>
        <span class="unstable"><b>${counts.unstable}</b> flip/inestables</span>
        ${counts.unknown?`<span><b>${counts.unknown}</b> sin traza</span>`:''}
      </div>
      <div class="csv1-live-list">${rows.map(liveRowHtml).join('')}</div>
      <div class="csv1-callout"><b>Lectura rápida:</b> verde = nació JUGABLE y sigue limpio; amarillo = fue promovido; rojo = tuvo ida/vuelta de señal o cambio de lado. Todo continúa siendo observacional.</div>
    `;
  }

  function normText(v){
    return String(v??'').toUpperCase().replace(/\s+/g,' ').trim();
  }

  function findRowForRanking(el,rows){
    const rankText=el.querySelector('.num')?.textContent?.trim();
    const rank=Number(rankText);
    if(Number.isFinite(rank)){
      const exact=rows.filter(r=>activeRank(r)===rank);
      if(exact.length===1) return exact[0];
    }

    const text=normText(el.textContent);
    const matches=rows.filter(r=>{
      const {away,home}=rowIdentity(r);
      return away && home && text.includes(normText(away)) && text.includes(normText(home));
    });
    return matches.length===1?matches[0]:null;
  }

  function findRowForCard(el,rows){
    const abbr=[...el.querySelectorAll('.sc-abbr')]
      .map(x=>normText(x.textContent))
      .filter(Boolean);

    let matches=[];
    if(abbr.length>=2){
      matches=rows.filter(r=>{
        const {away,home}=rowIdentity(r);
        return abbr.includes(normText(away)) && abbr.includes(normText(home));
      });
    }else{
      const text=normText(el.textContent);
      matches=rows.filter(r=>{
        const {away,home}=rowIdentity(r);
        return away && home && text.includes(normText(away)) && text.includes(normText(home));
      });
    }

    return matches.length===1?matches[0]:null;
  }

  function upsertVisualBadge(host,r,kind){
    const cls=stabilityClass(r);
    let badge=host.querySelector(`.csv1-${kind}-stability`);

    if(!cls){
      badge?.remove();
      return;
    }

    if(!badge){
      badge=document.createElement('div');
      badge.className=`csv1-${kind}-stability`;

      if(kind==='rank'){
        const target=host.querySelector('.meta')?.parentElement || host.children?.[1];
        (target || host).appendChild(badge);
      }else{
        /*
         * HOTFIX 1.2.1
         * Nunca insertar AFTEREND del propio scorecard.
         * En vivo no siempre existe .sc-analysis/.sc-schedule;
         * el fallback anterior usaba host + afterend y dejaba la
         * etiqueta como hermana del juego. Cada refresco creaba otra.
         */
        const target=
          host.querySelector('.sc-analysis') ||
          host.querySelector('.sc-schedule') ||
          host.querySelector('.sc-live-row') ||
          host.querySelector('.sc-pitchers') ||
          host.querySelector('.sc-teams');

        if(target && target!==host){
          target.insertAdjacentElement('afterend',badge);
        }else{
          host.appendChild(badge);
        }
      }
    }

    const wantedClass=`csv1-${kind}-stability ${cls.key}`;
    const wantedText=cls.short;
    const wantedTitle=cls.note;
    const wantedPk=String(r?.gamePk??'');

    /*
     * Idempotente: no reescribe textContent si nada cambió.
     * Evita que nuestro propio badge dispare ciclos de MutationObserver.
     */
    if(badge.className!==wantedClass) badge.className=wantedClass;
    if(badge.textContent!==wantedText) badge.textContent=wantedText;
    if(badge.title!==wantedTitle) badge.title=wantedTitle;
    if(badge.dataset.csv1GamePk!==wantedPk) badge.dataset.csv1GamePk=wantedPk;
  }

  function cleanupLeakedBadges(){
    document.querySelectorAll('.csv1-game-stability').forEach(b=>{
      if(!b.closest('.game.scorecard')) b.remove();
    });

    document.querySelectorAll('.csv1-rank-stability').forEach(b=>{
      if(!b.closest('.rankrow')) b.remove();
    });
  }

  function annotateVisibleJugables(){
    cleanupLeakedBadges();
    const rows=currentPlayableRows();

    document.querySelectorAll('.rankrow').forEach(el=>{
      const r=findRowForRanking(el,rows);
      if(r) upsertVisualBadge(el,r,'rank');
      else el.querySelector('.csv1-rank-stability')?.remove();
    });

    document.querySelectorAll('.game.scorecard').forEach(el=>{
      const r=findRowForCard(el,rows);
      if(r) upsertVisualBadge(el,r,'game');
      else el.querySelector('.csv1-game-stability')?.remove();
    });
  }

  let annotateTimer=null;
  function scheduleAnnotate(){
    clearTimeout(annotateTimer);
    annotateTimer=setTimeout(()=>{
      try{annotateVisibleJugables();}catch{}
    },90);
  }

  function metric(rows){
    const x=rows.filter(r=>outcome(r));
    let w=0,l=0,p=0,profit=0,brierSum=0,brierN=0;
    const ordered=[...x].sort((a,b)=>String(a.startTime||a.gameDate||a.created||a.date).localeCompare(String(b.startTime||b.gameDate||b.created||b.date)));
    let eq=0,peak=0,maxDD=0;
    for(const r of ordered){
      const o=outcome(r); if(o==='W')w++; else if(o==='L')l++; else p++;
      const up=unitProfit(r); if(Number.isFinite(up)){profit+=up;eq+=up;peak=Math.max(peak,eq);maxDD=Math.max(maxDD,peak-eq);}
      const b=+r.brier;if(Number.isFinite(b)){brierSum+=b;brierN++;}
    }
    const decisions=w+l;
    return {n:x.length,w,l,p,hit:decisions?w/decisions:null,roi:x.length?profit/x.length:null,profit,brier:brierN?brierSum/brierN:null,maxDD};
  }

  function isOfficialPlayable(r){
    return settled(r) && finalSignal(r)==='JUGABLE' && r.pass!==true;
  }

  function isStablePlayable(r){
    if(!isOfficialPlayable(r)||!hasTrace(r)) return false;
    return String(r.firstSignal).toUpperCase()==='JUGABLE' &&
      n(r.signalFlipCount,0)===0 && n(r.sideFlipCount,0)===0;
  }

  function isPromotedPlayable(r){
    if(!isOfficialPlayable(r)||!hasTrace(r)) return false;
    return String(r.firstSignal).toUpperCase()!=='JUGABLE';
  }

  function policyRow(name,rows,note,status='SHADOW'){
    return {name,stats:metric(rows),note,status};
  }

  function teamShadowAudit(){
    const s=readJSON(KEYS.shadow,{rows:[]});
    const rows=Array.isArray(s?.rows)?s.rows:[];
    const done=rows.filter(r=>['FINAL','PUSH'].includes(String(r?.status||'').toUpperCase()) && r.actual!==null && r.actual!==undefined);
    const changed=done.filter(r=>r.gatingChanged===true);
    const count=k=>changed.filter(r=>r[k]===true).length;
    return {
      total:rows.length,settled:done.length,changed:changed.length,
      blocks:count('gatingBlocked'),promotes:count('gatingPromoted'),downgrades:count('gatingDowngraded'),
      lossesAvoided:changed.reduce((a,r)=>a+n(r.lossesAvoided,0),0),
      winnersBlocked:changed.reduce((a,r)=>a+n(r.winnersBlocked,0),0),
      promotedWins:changed.reduce((a,r)=>a+n(r.leanPromotedWin,0),0),
      promotedLosses:changed.reduce((a,r)=>a+n(r.leanPromotedLoss,0),0),
      promotedPushes:changed.reduce((a,r)=>a+n(r.leanPromotedPush,0),0)
    };
  }

  function bucket(rows,field,bounds){
    const out=[];
    for(let i=0;i<bounds.length-1;i++){
      const lo=bounds[i],hi=bounds[i+1];
      const selected=rows.filter(r=>Number.isFinite(+r[field]) && +r[field]>=lo && +r[field]<hi);
      out.push({label:`${Math.round(lo*100)}–${hi>=1?'100+':Math.round(hi*100)}%`,stats:metric(selected)});
    }
    return out;
  }

  function analyze(){
    const all=censusRows();
    const finals=all.filter(settled);
    const playable=finals.filter(isOfficialPlayable);
    const traced=finals.filter(hasTrace);
    const tracedPlayable=playable.filter(hasTrace);
    const stable=tracedPlayable.filter(isStablePlayable);
    const promoted=tracedPlayable.filter(isPromotedPlayable);
    const sideFlip=tracedPlayable.filter(r=>n(r.sideFlipCount,0)>0);
    const sigFlip=tracedPlayable.filter(r=>n(r.signalFlipCount,0)>0);

    const policies=[
      policyRow('Baseline oficial',playable,'Reglas actuales del LAB.','MANTENER'),
      policyRow('Stability Guard',stable,'Exige que nazca JUGABLE y llegue sin flips.','SHADOW FUERTE'),
      policyRow('Promoted-to-JUGABLE',promoted,'Nació PASS/LEAN/LAB y luego subió a JUGABLE.','ALERTA'),
      policyRow('Edge ≥ 5%',playable.filter(r=>n(r.edge,-99)>=.05),'Filtro observacional; no cambia señal oficial.','SHADOW'),
      policyRow('Edge ≥ 6%',playable.filter(r=>n(r.edge,-99)>=.06),'Filtro observacional; no cambia señal oficial.','SHADOW'),
      policyRow('Edge ≥ 8%',playable.filter(r=>n(r.edge,-99)>=.08),'Prueba de umbral alto.','SHADOW'),
      policyRow('Rank activo ≤ 5',playable.filter(r=>{const x=activeRank(r);return x!==null&&x<=5;}),'Prioriza la parte alta del ranking.','SHADOW'),
      policyRow('Stable + Rank≤5 + Edge≥5%',playable.filter(r=>isStablePlayable(r)&&activeRank(r)!==null&&activeRank(r)<=5&&n(r.edge,-99)>=.05),'Candidato combinado; exige muestra mayor antes de promover.','SHADOW')
    ];

    const sides=['OVER','UNDER'].map(side=>({side,stats:metric(playable.filter(r=>String(r.side).toUpperCase()===side))}));
    const probBuckets=bucket(playable,'p',[.50,.56,.58,.60,.62,.65,.70,1.01]);
    const shadow=teamShadowAudit();

    const traceStable=metric(stable),tracePromoted=metric(promoted),baseline=metric(playable);
    let stabilityVerdict='OBSERVAR';
    if(traceStable.n>=12 && tracePromoted.n>=8 && Number.isFinite(traceStable.hit) && Number.isFinite(tracePromoted.hit)){
      stabilityVerdict=(traceStable.hit-tracePromoted.hit)>=.20?'SEÑAL FUERTE':'OBSERVAR';
    }

    return {
      version:VERSION,notice:NOTICE,
      counts:{census:all.length,finals:finals.length,trace:traced.length,playable:playable.length,tracedPlayable:tracedPlayable.length},
      baseline,stable:traceStable,promoted:tracePromoted,sideFlip:metric(sideFlip),sigFlip:metric(sigFlip),
      stabilityVerdict,policies,sides,probBuckets,shadow,
      generatedAt:new Date().toISOString()
    };
  }

  function statCard(title,s,accent=''){
    return `<div class="csv1-card ${accent}"><small>${esc(title)}</small><b>${s.n||0} casos</b><div>${s.w||0}-${s.l||0}-${s.p||0} · hit ${pct(s.hit)}</div><div>ROI 1u ${roi(s.roi)} · Brier ${f2(s.brier)}</div><div>DD ${Number.isFinite(s.maxDD)?s.maxDD.toFixed(2):'—'}u</div></div>`;
  }

  function tableRows(policies){
    return policies.map(p=>`<tr><td><b>${esc(p.name)}</b><div class="csv1-note">${esc(p.note)}</div></td><td><span class="csv1-pill ${p.status.includes('ALERTA')?'bad':p.status.includes('FUERTE')?'good':''}">${esc(p.status)}</span></td><td>${p.stats.n}</td><td>${p.stats.w}-${p.stats.l}-${p.stats.p}</td><td>${pct(p.stats.hit)}</td><td>${roi(p.stats.roi)}</td><td>${f2(p.stats.brier)}</td><td>${Number.isFinite(p.stats.maxDD)?p.stats.maxDD.toFixed(2):'—'}u</td></tr>`).join('');
  }

  function render(){
    const a=analyze();
    const root=$('#csv1-body'); if(!root)return;
    const sh=a.shadow;
    root.innerHTML=`
      <div class="csv1-warning"><b>${esc(a.notice)}</b><br>Usa el Censo persistente y Team Shadow como laboratorio retrospectivo. No escribe sobre el modelo oficial.</div>
      <div class="csv1-grid4">
        <div class="csv1-card"><small>Censo</small><b>${a.counts.census}</b><div>${a.counts.finals} finalizados</div></div>
        <div class="csv1-card"><small>JUGABLE oficial</small><b>${a.counts.playable}</b><div>${a.baseline.w}-${a.baseline.l}-${a.baseline.p}</div></div>
        <div class="csv1-card"><small>Decision Trace</small><b>${a.counts.trace}</b><div>${a.counts.tracedPlayable} JUGABLE trazables</div></div>
        <div class="csv1-card"><small>Stability verdict</small><b>${esc(a.stabilityVerdict)}</b><div>Solo observación</div></div>
      </div>

      <h3>JUGABLES actuales · identificación automática</h3>
      ${renderLiveJugables()}

      <h3>Patrón prioritario: estabilidad de señal</h3>
      <div class="csv1-grid3">
        ${statCard('JUGABLE estable',a.stable,'good')}
        ${statCard('Promovido a JUGABLE',a.promoted,'bad')}
        ${statCard('Baseline oficial',a.baseline,'')}
      </div>
      <div class="csv1-callout"><b>Regla de laboratorio:</b> Stability Guard queda en Shadow. No bloquea apuestas todavía. Para promoverlo debe sostener ventaja fuera de muestra con más decisiones nuevas.</div>

      <h3>Políticas candidatas</h3>
      <div class="csv1-tablewrap"><table><thead><tr><th>Política</th><th>Estado</th><th>N</th><th>W-L-P</th><th>Hit</th><th>ROI 1u</th><th>Brier</th><th>DD</th></tr></thead><tbody>${tableRows(a.policies)}</tbody></table></div>

      <h3>Probabilidad oficial por bandas</h3>
      <div class="csv1-tablewrap"><table><thead><tr><th>Banda</th><th>N</th><th>W-L-P</th><th>Hit</th><th>ROI 1u</th><th>Brier</th></tr></thead><tbody>${a.probBuckets.map(b=>`<tr><td>${esc(b.label)}</td><td>${b.stats.n}</td><td>${b.stats.w}-${b.stats.l}-${b.stats.p}</td><td>${pct(b.stats.hit)}</td><td>${roi(b.stats.roi)}</td><td>${f2(b.stats.brier)}</td></tr>`).join('')}</tbody></table></div>

      <h3>Dirección</h3>
      <div class="csv1-grid2">${a.sides.map(x=>statCard(x.side,x.stats)).join('')}</div>

      <h3>Team Shadow · auditoría separada</h3>
      <div class="csv1-grid4">
        <div class="csv1-card"><small>Casos Shadow</small><b>${sh.total}</b><div>${sh.settled} liquidados</div></div>
        <div class="csv1-card"><small>Gating cambió</small><b>${sh.changed}</b><div>${sh.blocks} block · ${sh.downgrades} downgrade · ${sh.promotes} promote</div></div>
        <div class="csv1-card"><small>Bloqueos</small><b>${sh.lossesAvoided} L evitadas</b><div>${sh.winnersBlocked} W bloqueadas</div></div>
        <div class="csv1-card"><small>Promociones LEAN</small><b>${sh.promotedWins}-${sh.promotedLosses}-${sh.promotedPushes}</b><div>W-L-P hipotético</div></div>
      </div>
      <div class="csv1-callout"><b>Decisión:</b> Team Shadow sigue READ ONLY. No se usa como gate real hasta que aumente mucho la muestra de cambios y demuestre mejora neta repetible.</div>

      <h3>Diagnóstico de persistencia de esta APK</h3>
      <div id="csv1-vault"><div class="csv1-note">Leyendo SQLite…</div></div>

      <div class="csv1-foot">${esc(a.version)} · recalculado ${new Date(a.generatedAt).toLocaleString('es-MX')} · Basado únicamente en datos persistidos del LAB.</div>
    `;
    setTimeout(()=>renderVaultDiagnostic().catch(()=>{}),0);
  }

  function coreLocalRaw(){
    const map=[
      ['bets','mlb_v5_bets','bets_v1'],
      ['lab','mlb_v5_lab','lab_v1'],
      ['census','mlb_v60_rank_census','rank_census_v1'],
      ['bank','mlb_v71_bank','bank_v1'],
      ['shadow','mlb_v786_team_shadow_lab','team_shadow_v1']
    ];
    return map.map(([name,localKey,sqlKey])=>({
      name,localKey,sqlKey,raw:localStorage.getItem(localKey)
    }));
  }

  async function vaultDiagnostic(){
    const db=window.MLBDB;
    const rows=coreLocalRaw();
    const out={available:!!db,ready:db?.ready===true,rows:[],integrity:null,health:null};

    for(const x of rows){
      let nativeRaw=null;
      try{
        nativeRaw=(db&&typeof db.getKV==='function')?await db.getKV(x.sqlKey):null;
      }catch{}
      out.rows.push({
        name:x.name,
        local:x.raw===null?0:x.raw.length,
        native:nativeRaw===null?0:String(nativeRaw).length,
        equal:(x.raw===null&&nativeRaw===null)||String(x.raw??'')===String(nativeRaw??'')
      });
    }

    try{
      if(db&&typeof db.vaultIntegrityCheck==='function') out.integrity=await db.vaultIntegrityCheck();
    }catch(e){out.integrity={ok:false,error:String(e?.message||e)};}

    try{
      if(db&&typeof db.vaultHealth==='function') out.health=await db.vaultHealth();
    }catch(e){out.health={ok:false,error:String(e?.message||e)};}

    return out;
  }

  async function repairTestVault(){
    const db=window.MLBDB;
    if(!db||db.ready!==true||typeof db.setKV!=='function'){
      throw new Error('SQLite todavía no está listo.');
    }

    let written=0;
    for(const x of coreLocalRaw()){
      if(x.raw===null) continue;
      await db.setKV(x.sqlKey,x.raw);
      written++;
    }

    const diag=await vaultDiagnostic();

    try{
      if(diag.integrity) db.lastVaultIntegrity=diag.integrity;
      if(diag.health?.ok===true && diag.integrity?.ok===true && typeof db.showStatus==='function'){
        db.showStatus('SQLite OK · Data Vault protegido',true);
      }
    }catch{}

    return {written,diag};
  }

  async function renderVaultDiagnostic(){
    const box=$('#csv1-vault');
    if(!box)return;

    box.innerHTML='<div class="csv1-note">Leyendo SQLite…</div>';
    const d=await vaultDiagnostic();
    const mismatch=d.rows.filter(x=>!x.equal);
    const integrityOk=d.integrity?.ok===true;
    const healthOk=d.health?.ok===true;

    box.innerHTML=`
      <div class="csv1-grid3">
        <div class="csv1-card ${d.ready?'good':'bad'}"><small>SQLite</small><b>${d.ready?'READY':'NO READY'}</b><div>Diagnóstico sin tocar picks</div></div>
        <div class="csv1-card ${integrityOk?'good':'bad'}"><small>Fingerprint</small><b>${integrityOk?'OK':'DESYNC'}</b><div>${mismatch.length} store(s) distintos</div></div>
        <div class="csv1-card ${healthOk?'good':'bad'}"><small>Vault Health</small><b>${healthOk?'OK':'REVISAR'}</b><div>Local ↔ SQLite</div></div>
      </div>

      <div class="csv1-tablewrap">
        <table>
          <thead><tr><th>Store</th><th>Local</th><th>SQLite</th><th>Igual</th></tr></thead>
          <tbody>${d.rows.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${x.local}</td><td>${x.native}</td><td>${x.equal?'✓':'✕'}</td></tr>`).join('')}</tbody>
        </table>
      </div>

      ${mismatch.length
        ? `<div class="csv1-callout" style="margin-top:10px"><b>Solo esta APK de prueba:</b> el import dejó LocalStorage y SQLite fuera de sincronía. El botón vuelve a escribir en SQLite exactamente los stores ya importados aquí. No cambia motores, probabilidades ni picks.</div>
           <button type="button" class="btn small" id="csv1-repair-vault">Sincronizar Vault de esta app de prueba</button>`
        : `<div class="csv1-callout" style="margin-top:10px"><b>Vault alineado.</b> No hace falta reparar nada.</div>`}
    `;

    const b=$('#csv1-repair-vault');
    if(b)b.onclick=async()=>{
      b.disabled=true;
      b.textContent='Sincronizando…';
      try{
        const r=await repairTestVault();
        await renderVaultDiagnostic();
        alert(`Sincronía terminada. Stores escritos: ${r.written}`);
      }catch(e){
        alert('No se pudo sincronizar: '+String(e?.message||e));
        b.disabled=false;
        b.textContent='Sincronizar Vault de esta app de prueba';
      }
    };
  }

  function styles(){
    if($('#csv1-style'))return;
    const s=document.createElement('style');s.id='csv1-style';s.textContent=`
      #csv1-modal{position:fixed;inset:0;z-index:999980;background:#02070def;display:none;overflow:auto;padding:10px;color:#eef7ff;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      #csv1-modal.open{display:block}.csv1-shell{max-width:1180px;margin:0 auto 80px;background:#071522;border:1px solid #315372;border-radius:22px;box-shadow:0 30px 100px #000d;overflow:hidden}.csv1-head{position:sticky;top:0;z-index:3;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;background:#0d2136f5;border-bottom:1px solid #243f5d;backdrop-filter:blur(14px)}.csv1-head h2{margin:0;font-size:1.1rem}.csv1-close{border:0;background:#1d354d;color:#fff;width:40px;height:40px;border-radius:50%;font-size:1.1rem}.csv1-content{padding:13px}.csv1-content h3{margin:18px 0 9px}.csv1-warning,.csv1-callout{padding:11px 13px;border-radius:13px;border-left:4px solid #ffd06a;background:#33270e88;color:#ffe6ad;font-size:.76rem;line-height:1.5;margin-bottom:12px}.csv1-callout{border-left-color:#60b5ff;background:#0b2842;color:#cae6ff}.csv1-grid4,.csv1-grid3,.csv1-grid2{display:grid;gap:9px;margin-bottom:10px}.csv1-grid4{grid-template-columns:repeat(4,1fr)}.csv1-grid3{grid-template-columns:repeat(3,1fr)}.csv1-grid2{grid-template-columns:repeat(2,1fr)}.csv1-card{border:1px solid #1d3955;background:#091928;border-radius:14px;padding:11px;line-height:1.45}.csv1-card.good{border-color:#2b7759}.csv1-card.bad{border-color:#753b46}.csv1-card small{display:block;color:#91a8bf;font-size:.62rem;text-transform:uppercase;font-weight:900}.csv1-card b{display:block;font-size:1.05rem;margin:4px 0}.csv1-tablewrap{overflow:auto;border:1px solid #1d3955;border-radius:14px}.csv1-tablewrap table{width:100%;border-collapse:collapse;font-size:.72rem}.csv1-tablewrap th,.csv1-tablewrap td{padding:9px 7px;border-bottom:1px solid #1c354f;text-align:right;white-space:nowrap}.csv1-tablewrap th:first-child,.csv1-tablewrap td:first-child{text-align:left;white-space:normal;min-width:190px}.csv1-tablewrap th{color:#a8bed3;font-size:.62rem;text-transform:uppercase}.csv1-note{font-size:.62rem;color:#91a8bf;margin-top:3px;line-height:1.35}.csv1-pill{display:inline-flex;padding:4px 7px;border-radius:999px;border:1px solid #315372;color:#b9d7ef;font-size:.58rem;font-weight:900}.csv1-pill.good{color:#9ff2c9;border-color:#2b7759}.csv1-pill.bad{color:#ffc4cb;border-color:#753b46}.csv1-foot{margin-top:16px;color:#7f98b0;font-size:.65rem;line-height:1.5}.csv1-launch{position:relative;white-space:nowrap}.csv1-launch:after{content:'S';display:inline-grid;place-items:center;width:14px;height:14px;margin-left:6px;border-radius:50%;background:#6b55e5;color:#fff;font-size:8px;font-weight:1000;vertical-align:middle}

      .csv1-live-summary{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 9px}.csv1-live-summary span{border:1px solid #315372;background:#091928;border-radius:999px;padding:6px 9px;font-size:.66rem;color:#bfd2e4}.csv1-live-summary .stable{border-color:#2b7759;color:#9ff2c9}.csv1-live-summary .promoted{border-color:#876f30;color:#ffe19a}.csv1-live-summary .unstable{border-color:#753b46;color:#ffc4cb}
      .csv1-live-list{display:grid;gap:8px;margin-bottom:10px}.csv1-live-row{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #25445f;background:#071522;border-radius:13px;padding:10px}.csv1-live-row.stable{border-color:#2b7759}.csv1-live-row.promoted{border-color:#876f30}.csv1-live-row.unstable{border-color:#753b46}.csv1-live-main{min-width:0}.csv1-live-main b{font-size:.8rem}.csv1-live-badge,.csv1-rank-stability,.csv1-game-stability{display:inline-flex;align-items:center;justify-content:center;border:1px solid #466780;background:#10283d;color:#d7e6f2;border-radius:999px;padding:5px 8px;font-size:.58rem;font-weight:1000;letter-spacing:.03em;white-space:nowrap}.csv1-live-badge.stable,.csv1-rank-stability.stable,.csv1-game-stability.stable{border-color:#2b7759;background:#103326;color:#9ff2c9}.csv1-live-badge.promoted,.csv1-rank-stability.promoted,.csv1-game-stability.promoted{border-color:#876f30;background:#30270f;color:#ffe19a}.csv1-live-badge.unstable,.csv1-rank-stability.unstable,.csv1-game-stability.unstable{border-color:#753b46;background:#35151d;color:#ffc4cb}.csv1-live-badge.unknown,.csv1-rank-stability.unknown,.csv1-game-stability.unknown{border-color:#466780;color:#c7d8e7}.csv1-rank-stability{margin-top:6px}.csv1-game-stability{margin:0 8px 8px;width:max-content;max-width:calc(100% - 16px)}

      @media(max-width:760px){.csv1-grid4,.csv1-grid3{grid-template-columns:1fr 1fr}.csv1-content{padding:9px}.csv1-tablewrap th,.csv1-tablewrap td{padding:8px 6px}}
      @media(max-width:430px){.csv1-grid4,.csv1-grid3,.csv1-grid2{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }

  function mount(){
    if($('#csv1-modal'))return;
    styles();
    const modal=document.createElement('div');modal.id='csv1-modal';modal.innerHTML=`<div class="csv1-shell"><div class="csv1-head"><div><h2>Calibration Shadow V1</h2><div style="font-size:.65rem;color:#91a8bf">Auditoría dinámica · sin tocar motores</div></div><button class="csv1-close" aria-label="Cerrar">✕</button></div><div class="csv1-content" id="csv1-body"></div></div>`;document.body.appendChild(modal);
    $('.csv1-close',modal).onclick=()=>modal.classList.remove('open');
    modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open');});

    let btn=document.createElement('button');btn.type='button';btn.id='csv1-open';btn.className='btn small csv1-launch';btn.textContent='Calibración Shadow';
    const toolbar=$('.toolbar');
    if(toolbar){toolbar.appendChild(btn);}else{btn.style.cssText='position:fixed;right:12px;top:72px;z-index:999970;padding:9px 11px;border-radius:12px;background:#193b60;color:#fff;border:1px solid #4f8ec9;font-weight:900';document.body.appendChild(btn);}
    btn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();render();modal.classList.add('open');},true);
    window.MLBCalibrationShadowV1={
      version:VERSION,
      analyze,
      render,
      classify:stabilityClass,
      currentPlayableRows,
      annotate:annotateVisibleJugables,
      open:()=>{render();modal.classList.add('open');}
    };

    scheduleAnnotate();

    /*
     * HOTFIX 1.2.1
     * Quitamos el observer global: los scorecards en vivo cambian DOM
     * constantemente y el observer terminaba reaccionando también a
     * nuestras propias etiquetas. El intervalo + eventos del usuario
     * son suficientes y mucho más seguros.
     */
    document.addEventListener('change',e=>{
      if(e.target?.id==='date') scheduleAnnotate();
    },true);

    document.addEventListener('click',()=>scheduleAnnotate(),true);
    setInterval(scheduleAnnotate,3000);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0),{once:true});
  else setTimeout(mount,0);
})();
