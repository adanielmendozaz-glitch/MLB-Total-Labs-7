(()=>{
  'use strict';

  const VERSION='V7.8.6_CALIBRATION_SHADOW_1_1';
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
    window.MLBCalibrationShadowV1={version:VERSION,analyze,render,open:()=>{render();modal.classList.add('open');}};
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0),{once:true});
  else setTimeout(mount,0);
})();
