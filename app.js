"use strict";
import {CARRIERS, CHASE, DATE_PROPOSAL_FIELDS, DISC_TYPES, FIRM, HOLIDAYS, LETTERS, PEOPLE, RULES, RULES_LAST_REVIEWED, SCRUB, STANDING, TRACK_DAYS, VENUES} from './config.js';
import {add, diff, fmt, fmtLong, holidayCoverageNote, iso, pd, returnDate, roll, rollBack} from './dates.js';
import {$, $$, esc, isLive, toast, tone} from './util.js';
import {APIKEY, DB, K_KEY, K_WHO, Store, SyncFS, TODAY, WHO, fillMatterSelect, loadDB, loadSettings, mById, mergeDB, mergeKey, refreshTodayIfStale, resetDB, save, setApiKey, setWho, tomb, touch, uid} from './store.js';
import {GCal, matterCalItems} from './gcal.js';
import {acceptDateChange, acceptDeadlineSupersede, buildLetter, closeLinkedObligation, closeLinkedTask, closeMootModal, computeRuleDue, confirmFilingModal, dateHistoryBlock, deadlineAction, deadlineInternalDate, deadlineOwner, deadlineStatusPill, dismissDeadlineSupersede, draftDeadlineNotice, filingBadge, hipaaForm, isDeadlineDone, keepCurrentDate, letterhead, logDiscoveryItem, maybeLogOJForTrial, newDeadline, nextFilingStage, openWhatHappened, pendingChangeCard, pendingSupersedeCard, resolveFilingRequirementModal, reviewPendingDate} from './workflows.js';
import {extractProvidersChart, handleFiles, reviewProvidersExtract} from './intake.js';

/* ══════════ DERIVATIONS ══════════ */
export function derive(m){
  const o=pd(m.originalDED), c=pd(m.currentDED), ded=c||o;
  const ret=returnDate(ded), file=ret?rollBack(add(ret,-16)):null;
  return {ded,ret,file,
    dDED: ded?diff(TODAY,ded):null,
    dFile: file?diff(TODAY,file):null,
    locked: !!(pd(m.arbitration)||pd(m.trial))};
}

/* ══════════ DASHBOARD ══════════ */
export function renderDash(){
  const live=DB.matters.filter(isLive);
  const items=[];
  live.forEach(m=>{
    const d=derive(m);
    if(d.file) items.push({m,what:'File motion to extend discovery',date:d.file,days:d.dFile,owner:m.owner,kind:'ext'});
    if(d.ded)  items.push({m,what:'Discovery end date',date:d.ded,days:d.dDED,owner:m.owner,kind:'ded'});
    const a=pd(m.arbitration); if(a) items.push({m,what:'Arbitration',date:a,days:diff(TODAY,a),owner:m.owner,kind:'arb'});
    const t=pd(m.trial); if(t) items.push({m,what:'Trial',date:t,days:diff(TODAY,t),owner:m.owner,kind:'trial'});
    const s=pd(m.sol); if(s) items.push({m,what:'Statute of limitations',date:s,days:diff(TODAY,s),owner:m.owner,kind:'sol'});
  });
  DB.records.filter(r=>r.status!=='Received').forEach(r=>{
    const n=pd(r.nextFollowUp); const m=mById(r.matterId);
    if(n&&m) items.push({m,what:'Records follow-up — '+r.provider,date:n,days:diff(TODAY,n),owner:m.owner,kind:'rec'});
  });
  DB.discovery.filter(d=>d.status!=='Served'&&d.status!=='Complete').forEach(x=>{
    const n=pd(x.dueDate); const m=mById(x.matterId);
    if(n&&m) items.push({m,what:x.item+' due',date:n,days:diff(TODAY,n),owner:m.owner,kind:'disc'});
  });
  DB.deadlines.filter(d=>!isDeadlineDone(d)).forEach(d=>{
    const n=pd(d.due); const m=mById(d.matterId);
    if(n&&m) items.push({m,what:(d.filing===true?'FILE WITH COURT: ':'')+d.title,date:n,days:diff(TODAY,n),owner:deadlineOwner(d),kind:'dl'});
  });
  /* Tasks auto-created for a filing deadline (see logDeadline) are skipped
     here — the deadline entry just above already represents that same
     obligation, with its filing status and owner; showing both would just
     be the same thing twice on the one screen meant to say what's next. */
  DB.tasks.filter(t=>!t.done&&t.due&&!t.linkedDeadlineId).forEach(t=>{
    const m=mById(t.matterId);
    items.push({m:m||{name:t.title,docket:'',file:''},what:'Task — '+t.title,date:pd(t.due),days:diff(TODAY,pd(t.due)),owner:t.owner,kind:'task'});
  });
  items.sort((a,b)=>a.days-b.days);

  const overdue=items.filter(i=>i.days<0), soon=items.filter(i=>i.days>=0&&i.days<=14);
  const stale=live.filter(m=>{const l=pd(m.lastActivity);return l&&diff(l,TODAY)>45;});
  const recs=DB.records.filter(r=>r.status!=='Received').length;

  $('#dashSub').textContent=`${live.length} live matters · ${DB.matters.length} on the books · ${fmtLong(TODAY)}`;
  $('#tiles').innerHTML=[
    ['red',overdue.length,'Overdue'],['amber',soon.length,'Next 14 days'],
    ['',live.filter(m=>m.side==='defense').length,'Defense'],['',live.filter(m=>m.side==='plaintiff').length,'Plaintiff'],
    ['amber',recs,'Records open'],['red',stale.length,'Stale files'],
    ['green',DB.tasks.filter(t=>!t.done).length,'Open tasks'],
    ['amber',DB.letters.filter(l=>l.status==='Pending').length,'Letters pending']
  ].map(([c,n,l])=>`<div class="tile ${c}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');

  const show=items.filter(i=>i.days<=30).slice(0,40);
  $('#dashRows').innerHTML= show.length? show.map(i=>`<tr>
    <td><div class="cn">${esc(i.m.name)}</div><div class="meta mono">${esc(i.m.docket||'no docket')}${i.m.file?' · '+esc(i.m.file):''}</div></td>
    <td>${esc(i.what)}</td><td class="mono">${fmt(i.date)}</td>
    <td><span class="num c-${tone(i.days)}">${i.days}</span></td>
    <td><span class="pill p-grey">${esc(i.owner||'—')}</span></td></tr>`).join('')
    : `<tr><td colspan="5" class="empty">Nothing due in the next 30 days.</td></tr>`;

  const gaps=[];
  DB.matters.filter(isLive).forEach(m=>{
    if(m.notes&&/CONFLICT/i.test(m.notes)) gaps.push([m.name,'Conflicting dates recorded','red']);
    if(m.pendingDateChanges&&m.pendingDateChanges.length) gaps.push([m.name,`${m.pendingDateChanges.length} date change${m.pendingDateChanges.length>1?'s':''} proposed by intake — open the matter to resolve`,'red']);
    if(!m.docket&&m.status!=='Pre-suit') gaps.push([m.name,'No docket number','amber']);
    if(m.side==='defense'&&!m.originalDED&&!m.currentDED&&m.status==='Active') gaps.push([m.name,'No DED recorded','amber']);
    if(m.side==='plaintiff'&&!m.sol&&!m.docket) gaps.push([m.name,'No limitations date and no docket','amber']);
    if(m.side==='defense'&&!m.carrier&&m.status==='Active') gaps.push([m.name,'No carrier recorded','grey']);
  });
  $('#dashGaps').innerHTML= gaps.length? gaps.slice(0,14).map(([n,g,c])=>
    `<div style="display:flex;gap:9px;padding:6px 0;border-bottom:1px solid var(--rule2);font-size:12.5px">
      <span class="pill p-${c}">${c==='red'?'Fix':'Gap'}</span>
      <span style="flex:1"><strong>${esc(n)}</strong><br><span class="note">${esc(g)}</span></span></div>`).join('')
    : '<p class="note">Nothing flagged.</p>';

  $('#dashStale').innerHTML= stale.length? stale.map(m=>
    `<div style="padding:6px 0;border-bottom:1px solid var(--rule2);font-size:12.5px">
      <strong>${esc(m.name)}</strong><span class="note"> — last touched ${fmt(pd(m.lastActivity))}</span></div>`).join('')
    : '<p class="note">Everything touched inside 45 days.</p>';
}

/* ══════════ MATTERS ══════════ */
export function filtered(){
  const side=$('#fSide').value, st=$('#fStatus').value, ow=$('#fOwner').value,
        q=$('#fSearch').value.trim().toLowerCase();
  return DB.matters.filter(m=>{
    if(side&&m.side!==side) return false;
    if(st==='active'&&!isLive(m)) return false;
    if(st&&st!=='active'&&m.status!==st) return false;
    if(ow&&m.owner!==ow) return false;
    if(q&&!(`${m.name} ${m.docket} ${m.file} ${m.carrier} ${m.notes}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>{
    const A=derive(a).file,B=derive(b).file;
    if(A&&B) return A-B; if(A) return -1; if(B) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function ladder(d){
  if(!d.ded||!d.file) return '';
  const span=Math.max(diff(d.file,d.ded),1);
  const rp=Math.min(100,Math.max(0,diff(d.file,d.ret)/span*100));
  const fill=Math.min(100,Math.max(0,diff(d.file,TODAY)/span*100));
  return `<div class="ladder"><div class="tr"><div class="fl" style="width:${fill}%"></div>
    <div class="tk" style="left:0"></div><div class="tk r" style="left:${rp}%"></div>
    <div class="tk d" style="left:calc(100% - 2px)"></div></div>
    <div class="lb"><span><b>${fmt(d.file)}</b>file</span><span><b>${fmt(d.ret)}</b>return</span><span><b>${fmt(d.ded)}</b>DED</span></div></div>`;
}

export function renderMatters(){
  const rows=filtered();
  $('#matterEmpty').style.display=rows.length?'none':'block';
  $('#matterRows').innerHTML=rows.map(m=>{
    const d=derive(m);
    const sp={Active:'p-green','Trial listed':'p-amber','Pre-suit':'p-blue',Settled:'p-grey',Dismissed:'p-grey'}[m.status]||'p-grey';
    return `<tr>
      <td><div class="cn">${esc(m.name)}${m.pendingDateChanges&&m.pendingDateChanges.length?` <span class="pill p-red">${m.pendingDateChanges.length} date change${m.pendingDateChanges.length>1?'s':''} pending</span>`:''}</div>
        <div class="meta mono">${esc(m.docket||'no docket')}${m.venue?' · '+esc(m.venue):''} · ${esc(m.file)}</div>
        ${ladder(d)}
        ${m.notes?`<div class="meta" style="max-width:330px;margin-top:4px">${esc(m.notes.slice(0,150))}${m.notes.length>150?'…':''}</div>`:''}</td>
      <td><span class="pill ${sp}">${esc(m.status)}</span>${m.side==='plaintiff'?'<div class="meta">plaintiff</div>':''}</td>
      <td class="mono">${esc(m.track||'—')}</td>
      <td>${esc(m.carrier||'—')}${m.adjuster?`<div class="meta">${esc(m.adjuster)}</div>`:''}</td>
      <td class="mono">${fmt(pd(m.originalDED))}</td>
      <td class="mono">${fmt(pd(m.currentDED))}</td>
      <td><span class="num c-${tone(d.dDED)}">${d.dDED===null?'—':d.dDED}</span></td>
      <td class="mono"><strong class="c-${tone(d.dFile)}">${fmt(d.file)}</strong>
        ${d.ret?`<div class="meta">ret ${fmt(d.ret)}</div>`:''}
        ${d.locked?'<div class="meta c-amber">exceptional circs</div>':''}</td>
      <td class="mono">${fmt(pd(m.arbitration))}</td>
      <td class="mono">${fmt(pd(m.trial))}</td>
      <td><button class="sm" data-edit="${m.id}">Open</button></td></tr>`;
  }).join('');
  $$('[data-edit]').forEach(b=>b.onclick=()=>openMatter(mById(b.dataset.edit)));
}

/* ══════════ MATTER EDITOR ══════════ */
export function openMatter(m){
  const isNew=!m;
  if(isNew) m={id:uid(),side:'defense',name:'',docket:'',venue:'',file:'',status:'Active',owner:WHO,
    carrier:'',claim:'',adjuster:'',judge:'',track:'II',originalDED:'',currentDED:'',sol:'',
    consent:'',motion:'',records:'',depo:'',ime:'',arbitration:'',trial:'',notes:'',lastActivity:iso(TODAY)};
  const sel=(v,opts)=>opts.map(o=>`<option${o===v?' selected':''}>${o}</option>`).join('');
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal">
    <div class="mh"><h3>${isNew?'New matter':esc(m.name)}</h3>
      <div class="s">${isNew?'Defense files take a JMG410 suffix; plaintiff files end in CJG.':esc(m.file)+' · '+esc(m.docket||'no docket')}</div></div>
    <div class="mb">
      ${!isNew&&m.pendingDateChanges&&m.pendingDateChanges.length?m.pendingDateChanges.map(pendingChangeCard).join(''):''}
      <div class="grid2">
        <div class="full"><label>Caption</label><input class="t" id="e_name" value="${esc(m.name)}"></div>
        <div><label>Docket</label><input id="e_docket" value="${esc(m.docket)}"></div>
        <div><label>Venue</label><input id="e_venue" value="${esc(m.venue)}"></div>
        <div><label>Our file number</label><input id="e_file" value="${esc(m.file)}"></div>
        <div><label>Side</label><select class="t" id="e_side">${sel(m.side,['defense','plaintiff'])}</select></div>
        <div><label>Status</label><select class="t" id="e_status">${sel(m.status,['Active','Trial listed','Pre-suit','Settled','Dismissed'])}</select></div>
        <div><label>Handling timekeeper</label><select class="t" id="e_owner">${PEOPLE.map(p=>`<option${p.i===m.owner?' selected':''}>${p.i}</option>`).join('')}</select></div>
        <div><label>Track</label><select class="t" id="e_track">${sel(m.track,['I','II','III','IV'])}</select></div>
        <div><label>Judge</label><input class="t" id="e_judge" value="${esc(m.judge)}"></div>
        <div><label>Carrier</label><input class="t" id="e_carrier" value="${esc(m.carrier)}" list="carrierList"></div>
        <div><label>Claim number</label><input id="e_claim" value="${esc(m.claim)}"></div>
        <div><label>Adjuster</label><input class="t" id="e_adjuster" value="${esc(m.adjuster)}"></div>
        <div><label>Original DED</label><input type="date" id="e_oded" value="${m.originalDED}"></div>
        <div><label>Current DED</label><input type="date" id="e_cded" value="${m.currentDED}"></div>
        <div><label>Arbitration</label><input type="date" id="e_arb" value="${m.arbitration}"></div>
        <div><label>Trial</label><input type="date" id="e_trial" value="${m.trial}"></div>
        <div><label>Limitations date (plaintiff)</label><input type="date" id="e_sol" value="${m.sol||''}"></div>
        <div><label>60-day consent</label><select class="t" id="e_consent">${sel(m.consent,['','Not used','Y','Requested','Refused','N/A'])}</select></div>
        <div><label>Motion to extend</label><select class="t" id="e_motion">${sel(m.motion,['','Not filed','Ours — filed/pending','Co-def motion pending','Granted','Denied','N/A'])}</select></div>
        <div><label>Medical records</label><select class="t" id="e_records">${sel(m.records,['','Outstanding','Partial','Complete','Authorizations sent','N/A'])}</select></div>
        <div><label>Plaintiff deposition</label><input class="t" id="e_depo" value="${esc(m.depo)}" placeholder="date or Taken"></div>
        <div><label>IME</label><input class="t" id="e_ime" value="${esc(m.ime)}" placeholder="date or scheduled"></div>
        <div class="full"><label>Notes</label><textarea class="t" id="e_notes" rows="3">${esc(m.notes)}</textarea></div>
      </div>
      <div class="derived"><h4>Computed</h4><div id="e_calc"></div></div>
      ${!isNew?dateHistoryBlock(m):''}
    </div>
    <div class="mf">
      ${isNew?'':'<button class="danger" id="e_del">Delete</button>'}
      <span class="sp"></span><button id="e_cancel">Cancel</button>
      <button class="primary" id="e_save">${isNew?'Add matter':'Save'}</button>
    </div></div></div>
    <datalist id="carrierList">${CARRIERS.map(c=>`<option value="${c.n}">`).join('')}</datalist>`;

  const rc=()=>{
    const t={originalDED:$('#e_oded').value,currentDED:$('#e_cded').value,
             arbitration:$('#e_arb').value,trial:$('#e_trial').value};
    const d=derive(t); const R=(a,b)=>`<div class="r"><span>${a}</span><span class="mono">${b}</span></div>`;
    let h='';
    if(d.ded){
      h+=R('Operative DED',fmt(d.ded)+' · '+d.dDED+' days');
      h+=R('Motion return date',fmt(d.ret)+' — last Friday before the DED');
      h+=R('File and serve by','<strong>'+fmt(d.file)+'</strong> · '+d.dFile+' days');
      if(d.dFile<0) h+=R('<span class="c-red">Window closed</span>','<span class="c-red">Consent stipulation or ex parte order shortening time</span>');
      if(d.locked) h+=R('<span class="c-amber">Exceptional circumstances</span>','<span class="c-amber">R. 4:24-1(c) — a date is already fixed</span>');
      const cons=$('#e_consent').value;
      if(cons!=='Y') h+=R('60-day consent available','Stipulate to '+fmt(add(d.ded,60))+' — no 16-day lead required');
    } else h+=R('Operative DED','Enter a DED to compute the filing deadline');
    const s=pd($('#e_sol').value); if(s) h+=R('Limitations date',fmt(s)+' · '+diff(TODAY,s)+' days');
    $('#e_calc').innerHTML=h;
  };
  ['e_oded','e_cded','e_arb','e_trial','e_sol','e_consent'].forEach(i=>$('#'+i).addEventListener('input',rc));
  rc();

  $('#e_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  if(!isNew){
    $$('[data-pdc-keep]').forEach(b=>b.onclick=()=>keepCurrentDate(m,b.dataset.pdcKeep));
    $$('[data-pdc-accept]').forEach(b=>b.onclick=()=>acceptDateChange(m,b.dataset.pdcAccept));
    $$('[data-pdc-review]').forEach(b=>b.onclick=reviewPendingDate);
  }
  if(!isNew) $('#e_del').onclick=async()=>{
    if(!confirm('Delete '+m.name+'? This cannot be undone.')) return;
    tomb('matters',m.id);
    if(GCal.status.state==='connected'&&m.gcal) Object.keys(m.gcal).forEach(k=>GCal.deleteEvent(m,k));
    DB.matters=DB.matters.filter(x=>x.id!==m.id); await save(); SyncFS.scheduleSync(); renderAll(); $('#modalHost').innerHTML='';toast('Deleted');
  };
  $('#e_save').onclick=async()=>{
    const g=i=>$('#e_'+i).value;
    /* Manual edits get the same change-history protection as an intake
       accept — overwriting a date you'd already recorded, by hand or by
       typo, shouldn't erase what it used to say. Logs any actual change
       to a previously-set value, INCLUDING clearing it back to blank
       (corrected 10/1/2026 — the old `from&&to&&...` condition silently
       skipped logging a clear, since a blank `to` made it falsy). Filling
       a blank field for the first time still isn't logged — that's not a
       loss of information, just `from` being falsy already excludes it. */
    if(!isNew) DATE_PROPOSAL_FIELDS.forEach(c=>{
      const from=m[c.field]||'', to=g(c.field==='currentDED'?'cded':c.field==='arbitration'?'arb':'trial');
      if(from&&from!==to){ m.dateHistory=m.dateHistory||[];
        m.dateHistory.push({field:c.field,label:c.label,from,to,at:new Date().toISOString(),by:WHO,source:'Manual edit'}); }
      if(from!==to){
        // Field-level timestamp for the shared-folder merge (see
        // mergeMatterRecord in store.js) — recorded for every real change
        // to this field, not just the ones that get a history row above.
        m.fieldUpdatedAt=m.fieldUpdatedAt||{};
        m.fieldUpdatedAt[c.field]=new Date().toISOString();
      }
      // A manual edit to this field supersedes any pending proposal on it — drop it rather than leave a stale card.
      if(to!==from&&m.pendingDateChanges&&m.pendingDateChanges.length)
        m.pendingDateChanges=m.pendingDateChanges.filter(p=>p.field!==c.field);
    });
    Object.assign(m,{name:g('name').trim()||'Untitled',docket:g('docket').trim(),venue:g('venue').trim().toUpperCase(),
      file:g('file').trim(),side:g('side'),status:g('status'),owner:g('owner'),track:g('track'),judge:g('judge').trim(),
      carrier:g('carrier').trim(),claim:g('claim').trim(),adjuster:g('adjuster').trim(),
      originalDED:g('oded'),currentDED:g('cded'),arbitration:g('arb'),trial:g('trial'),sol:g('sol'),
      consent:g('consent'),motion:g('motion'),records:g('records'),depo:g('depo').trim(),ime:g('ime').trim(),
      notes:g('notes').trim(),lastActivity:iso(TODAY)});
    touch(m);
    if(isNew) DB.matters.push(m);
    /* Typing a trial date straight into this editor and hitting Save is a
       normal, common path — not just accepting an intake proposal — so it
       needs the same Offer of Judgment reconciliation. Called unconditionally
       (not just `if(m.trial)`) because CLEARING a previously-set trial date
       is exactly the case that needs to flag an existing OJ deadline for
       review too — maybeLogOJForTrial() itself now compares against any
       existing open OJ deadline's trigger and flags a mismatch rather than
       silently creating, ignoring, or overwriting one. Runs before
       renderAll() so a newly-logged or newly-flagged deadline isn't invisible
       until some unrelated later action re-renders the Deadlines tab. */
    await maybeLogOJForTrial(m.id,m.trial);
    await save(); SyncFS.scheduleSync(); renderAll(); $('#modalHost').innerHTML=''; toast(isNew?'Matter added':'Saved');
    if(GCal.status.state==='connected') GCal.syncMatter(m);
  };
}

/* ══════════ DEADLINE CALCULATOR ══════════ */
export function ruleInterval(r){
  if(r.special==='years') return r.n+' year'+(r.n>1?'s':'')+' after';
  if(r.special==='months') return r.n+' month'+(r.n>1?'s':'')+' after';
  if(r.d===null) return r.track?'by track':'special';
  return r.d<0?Math.abs(r.d)+' days before':r.d+' days after';
}

export function vBadge(v){
  if(v==='pub') return {c:'v-yes',t:'checked — official text'};
  if(v==='sec') return {c:'v-mid',t:'checked — secondary source'};
  return {c:'v-no',t:'unverified'};
}

export function renderDeadlines(){
  $('#calcRule').innerHTML=RULES.map(r=>`<option value="${r.k}">${r.t} — ${r.a}</option>`).join('');
  $('#ruleRows').innerHTML=RULES.map(r=>{const b=vBadge(r.v),fb=filingBadge(r.filing);return `<tr>
    <td><strong>${esc(r.t)}</strong>${r.note?`<div class="meta">${esc(r.note)}</div>`:''}</td>
    <td class="mono">${esc(r.a)}</td>
    <td class="mono">${ruleInterval(r)}
      <div class="meta">${esc(r.from)}</div></td>
    <td><span class="pill ${fb.c}">${fb.t}</span></td>
    <td><span class="vflag ${b.c}">${b.t}</span></td></tr>`;}).join('');
  const pub=RULES.filter(r=>r.v==='pub').length, sec=RULES.filter(r=>r.v==='sec').length, unv=RULES.filter(r=>r.v==='unv').length;
  $('#ruleVerifyNote').textContent=`Every line carries a verification flag. As of ${RULES_LAST_REVIEWED}: ${pub} checked directly against the official Rules text, `
    +`${sec} checked against secondary legal-research sources (not the official text, and not a citator), ${unv} not checked at all. `
    +`None of this has been run through Westlaw or Lexis. Confirm anything outcome-determinative before filing.`;
  $('#holidayList').innerHTML=Object.entries(HOLIDAYS).map(([d,n])=>
    `${fmt(pd(d))} &nbsp; <span style="color:var(--muted)">${esc(n)}</span>`).join('<br>');
  runCalc();
}

export function runCalc(){
  const r=RULES.find(x=>x.k===$('#calcRule').value)||RULES[0];
  const from=pd($('#calcFrom').value), track=$('#calcTrack').value;
  const R=(a,b)=>`<div class="r"><span>${a}</span><span class="mono">${b}</span></div>`;
  if(!from){ $('#calcOut').innerHTML=R('Result','Pick a trigger date'); return; }
  let h=R('Authority',esc(r.a))+R('Trigger',fmt(from)+' — '+esc(r.from));
  /* The actual rolled/computed date in every branch below comes from
     computeRuleDue() — the same function the Deadlines ledger logs against
     — so the Calculator and a logged deadline can never silently disagree
     on what a rule computes to. Only purely-local display extras (the raw
     pre-roll date, the return date shown alongside it) stay inline. */
  if(r.special==='ext'){
    const ret=returnDate(from), file=computeRuleDue(r,from,track);
    h+=R('Return date',fmt(ret)+' — last Friday before the DED')
     + R('File and serve by','<strong>'+fmt(file)+'</strong>')
     + R('Days from today',diff(TODAY,file)+'')
     + R('Consent alternative','Stipulate to '+fmt(add(from,60))+' under R. 4:24-1(c)');
  } else if(r.track){
    if(!track){ h+=R('Result','Choose a track'); }
    else { const raw=add(from,TRACK_DAYS[track]), rolled=computeRuleDue(r,from,track);
      h+=R('Track '+track,TRACK_DAYS[track]+' days')+R('Raw date',fmt(raw))
       +R('After R. 1:3-1 rolling','<strong>'+fmt(rolled)+'</strong>')
       +R('Motion to extend by',fmt(rollBack(add(returnDate(rolled),-16)))); }
  } else if(r.special==='years'||r.special==='months'){
    const raw=computeRuleDue(r,from,track);
    h+=R('Computed by calendar '+(r.special==='years'?'year':'month')+', not a fixed day count','<strong>'+fmt(raw)+'</strong>')
     +R('Days from today',diff(TODAY,raw)+'')
     +R('Rolling','Not applied — this calculator only rolls court-rule deadlines under R. 1:3-1, not substantive statutory periods. Do not rely on a weekend or holiday to buy an extra day; confirm the computation method independently.');
  } else if(Math.abs(r.d)<7){
    const rolled=computeRuleDue(r,from,track);
    h+=R('R. 1:3-1 — under 7 days',Math.abs(r.d)+' business days, excluding intervening weekends/holidays from the count itself')
     +R(r.d<0?'Computed backward':'Computed forward','<strong>'+fmt(rolled)+'</strong>')
     +R('Days from today',diff(TODAY,rolled)+'');
    if(r.d<0) h+=R('Direction','Backward-computed — the date moves earlier, never later');
  } else {
    const raw=add(from,r.d);
    const rolled=computeRuleDue(r,from,track);
    h+=R('Raw date',fmt(raw))+R(r.d<0?'Rolled back to a court day':'After R. 1:3-1 rolling','<strong>'+fmt(rolled)+'</strong>')
     +R('Days from today',diff(TODAY,rolled)+'');
    if(r.d<0) h+=R('Direction','Backward-computed — the date moves earlier, never later');
  }
  const vb=vBadge(r.v);
  h+=R('Verification',vb.t==='checked — official text'?'Checked directly against the official Rules text — no citator run':
      vb.t==='checked — secondary source'?`Checked against secondary legal-research sources as of ${RULES_LAST_REVIEWED} — not the official text or a citator`:
      'Unverified — confirm on Westlaw or Lexis');
  if(r.note) h+=R('Note',esc(r.note));
  if(r.special!=='years'&&r.special!=='months'){
    const covNote=holidayCoverageNote(computeRuleDue(r,from,track));
    if(covNote) h+=R('⚠ Holiday coverage',esc(covNote));
  }
  $('#calcOut').innerHTML=h;
}

export function renderDeadlineLedger(){
  fillMatterSelect('#dlMatter',true);
  const rows=DB.deadlines.slice().sort((a,b)=>{
    if(isDeadlineDone(a)!==isDeadlineDone(b)) return isDeadlineDone(a)?1:-1;
    return (pd(a.due)||9e15)-(pd(b.due)||9e15);
  });
  $('#dlSupersede').innerHTML=rows.filter(d=>d.supersedeProposal).map(pendingSupersedeCard).join('');
  $$('[data-psc-accept]').forEach(b=>b.onclick=()=>acceptDeadlineSupersede(b.dataset.pscAccept));
  $$('[data-psc-keep]').forEach(b=>b.onclick=()=>dismissDeadlineSupersede(b.dataset.pscKeep));
  $('#dlEmpty').style.display=rows.length?'none':'block';
  $('#dlRows').innerHTML=rows.map(d=>{
    const m=mById(d.matterId)||{name:'(matter removed)'};
    const due=pd(d.due), dd=due?diff(TODAY,due):null, fb=filingBadge(d.filing), done=isDeadlineDone(d);
    const internal=pd(deadlineInternalDate(d));
    const internalLine = (d.filing===true && internal && deadlineInternalDate(d)!==d.due)
      ? `<div class="meta">internal target ${fmt(internal)}</div>` : '';
    const filingServiceLine = (d.filing===true && !done && (d.filingConfirmation||d.serviceConfirmation))
      ? `<div class="meta">${d.filingConfirmation?'filing confirmed':'⚠ filing not yet confirmed'} · ${d.serviceConfirmation?'service confirmed':'⚠ service not yet confirmed'}</div>` : '';
    let actionBtn='', mootBtn='';
    if(!done){
      if(d.filing===true){
        actionBtn = d.status==='Filed'||d.filingConfirmation||d.serviceConfirmation
          ? `<button class="sm primary" data-dconfirm="${d.id}">Confirm filing${d.filingConfirmation||d.serviceConfirmation?' & service':''}</button>`
          : `<button class="sm" data-dadvance="${d.id}">→ ${esc(nextFilingStage(d.status))}</button>`;
        mootBtn = `<button class="sm" data-dmoot="${d.id}" title="Use this when the filing is no longer needed — withdrawn, mooted, settled — not for an actual filing. That goes through Confirm filing.">Close — not filed</button> `;
      } else if(d.filing==='confirm'){
        actionBtn = `<button class="sm" data-dresolve="${d.id}">Resolve filing requirement</button>`;
      } else {
        actionBtn = `<button class="sm" data-ddone="${d.id}">Done</button>`;
      }
    }
    return `<tr${done?' style="opacity:.55"':''}><td><strong>${esc(m.name)}</strong><div class="meta mono">${esc(m.docket||'')}</div></td>
      <td>${esc(d.title)}<div class="meta mono">${esc(d.authority)} · ${esc(deadlineAction(d))}</div>${filingServiceLine}${d.notes?`<div class="meta">${esc(d.notes)}</div>`:''}${d.status==='Moot'&&d.mootReason?`<div class="meta">Closed without filing: ${esc(d.mootReason.reason)}</div>`:''}${d.status==='Superseded'?`<div class="meta">Superseded by a replacement deadline after the trial date changed</div>`:''}${!d.supersedeProposal&&d.supersedeHistory&&d.supersedeHistory.some(h=>h.action==='rejected')?`<div class="meta">Reviewed and kept as is after a trial date change — see history</div>`:''}</td>
      <td><span class="pill p-grey">${esc(deadlineOwner(d))}</span></td>
      <td class="mono">${fmt(due)}${internalLine}</td>
      <td><span class="num c-${done?'grey':tone(dd)}">${dd===null?'—':dd}</span></td>
      <td><span class="pill ${fb.c}">${fb.t}</span></td>
      <td><span class="pill ${deadlineStatusPill(d.status)}">${esc(d.status)}</span></td>
      <td>${actionBtn} ${mootBtn}${d.ruleKey?`<button class="sm" data-dnotice="${d.id}">Draft notice</button> `:''}<button class="sm" data-dlx="${d.id}">×</button></td></tr>`;
  }).join('');
  $$('[data-dadvance]').forEach(b=>b.onclick=async()=>{
    const d=DB.deadlines.find(i=>i.id===b.dataset.dadvance); if(!d) return;
    d.status=nextFilingStage(d.status); touch(d);
    await save();SyncFS.scheduleSync();renderAll();toast(`Moved to ${d.status}`);
  });
  $$('[data-dconfirm]').forEach(b=>b.onclick=()=>confirmFilingModal(b.dataset.dconfirm));
  $$('[data-dresolve]').forEach(b=>b.onclick=()=>resolveFilingRequirementModal(b.dataset.dresolve));
  $$('[data-dmoot]').forEach(b=>b.onclick=()=>closeMootModal(b.dataset.dmoot));
  $$('[data-ddone]').forEach(b=>b.onclick=async()=>{
    const d=DB.deadlines.find(i=>i.id===b.dataset.ddone); d.status='Done'; touch(d);
    if(GCal.status.state==='connected') await GCal.deleteEventOn(d);
    closeLinkedTask(d.id); closeLinkedObligation(d.id);
    await save();SyncFS.scheduleSync();renderAll();toast('Marked done');});
  $$('[data-dnotice]').forEach(b=>b.onclick=()=>draftDeadlineNotice(b.dataset.dnotice));
  $$('[data-dlx]').forEach(b=>b.onclick=async()=>{
    const d=DB.deadlines.find(i=>i.id===b.dataset.dlx);
    if(GCal.status.state==='connected'&&d) await GCal.deleteEventOn(d);
    closeLinkedTask(b.dataset.dlx); closeLinkedObligation(b.dataset.dlx);
    tomb('deadlines',b.dataset.dlx);DB.deadlines=DB.deadlines.filter(i=>i.id!==b.dataset.dlx);
    await save();SyncFS.scheduleSync();renderAll();});
}

export function renderDiscovery(){
  fillMatterSelect('#discMatter',true);
  const rows=DB.discovery.slice().sort((a,b)=>(pd(a.dueDate)||9e15)-(pd(b.dueDate)||9e15));
  $('#discEmpty').style.display=rows.length?'none':'block';
  $('#discRows').innerHTML=rows.map(x=>{
    const m=mById(x.matterId)||{name:'(matter removed)',docket:''};
    const due=pd(x.dueDate), dd=due?diff(TODAY,due):null;
    return `<tr><td><strong>${esc(m.name)}</strong><div class="meta mono">${esc(m.docket||'')}</div></td>
      <td>${esc(x.item)}<div class="meta mono">${esc(x.authority||'')}</div></td>
      <td><span class="pill ${x.direction==='Served on adversary'?'p-blue':'p-amber'}">${esc(x.direction)}</span></td>
      <td class="mono">${fmt(pd(x.served))}</td><td class="mono">${fmt(due)}</td>
      <td><span class="num c-${tone(dd)}">${dd===null?'—':dd}</span></td>
      <td><span class="pill ${x.status==='Complete'?'p-green':x.status==='Overdue'?'p-red':'p-grey'}">${esc(x.status)}</span></td>
      <td><button class="sm" data-dd="${x.id}">Done</button> <button class="sm" data-dx="${x.id}">×</button></td></tr>`;
  }).join('');
  $$('[data-dd]').forEach(b=>b.onclick=async()=>{const x=DB.discovery.find(i=>i.id===b.dataset.dd);x.status='Complete';touch(x);
    if(GCal.status.state==='connected') await GCal.deleteEventOn(x);
    closeLinkedObligation(x.id);
    await save();SyncFS.scheduleSync();renderAll();});
  $$('[data-dx]').forEach(b=>b.onclick=async()=>{tomb('discovery',b.dataset.dx);DB.discovery=DB.discovery.filter(i=>i.id!==b.dataset.dx);closeLinkedObligation(b.dataset.dx);await save();SyncFS.scheduleSync();renderAll();});
}

export function newDiscovery(){
  const mid=$('#discMatter').value; if(!mid) return toast('Pick a matter first');
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:560px">
    <div class="mh"><h3>Log discovery</h3><div class="s">${esc((mById(mid)||{}).name||'')}</div></div>
    <div class="mb"><div class="grid2">
      <div class="full"><label>Item</label><select class="t" id="d_item">${DISC_TYPES.map(t=>`<option value="${t.t}">${t.t} — ${t.manual?'no fixed period':t.d+' days'} · ${t.a}</option>`).join('')}</select></div>
      <div><label>Direction</label><select class="t" id="d_dir"><option>Served on adversary</option><option>Received from adversary</option></select></div>
      <div><label>Date served</label><input type="date" id="d_served" value="${iso(TODAY)}"></div>
      <div class="full" id="d_floorWrap" style="display:none"></div>
      <div class="full"><div class="derived"><h4>Response due</h4><div id="d_calc"></div></div></div>
    </div></div>
    <div class="mf"><button id="d_cancel">Cancel</button><button class="primary" id="d_save">Log it</button></div>
  </div></div>`;
  const rc=()=>{
    const t=DISC_TYPES.find(x=>x.t===$('#d_item').value), s=pd($('#d_served').value);
    $('#d_floorWrap').style.display=t.floorDays?'':'none';
    if(t.floorDays && !$('#d_floor')){
      $('#d_floorWrap').innerHTML=`<label>${esc(t.floorLabel)}</label><input type="date" id="d_floor">`;
      $('#d_floor').addEventListener('input',rc);
    }
    if(t.manual){
      $('#d_calc').innerHTML=`<div class="r"><span>${esc(t.a)}</span><span class="mono">No fixed statewide response period</span></div>
        <div class="r"><span>Due date</span><span class="mono"><input type="date" id="d_manual" class="t"></span></div>
        <p class="note" style="margin-top:6px">Enter the date printed on the document itself, or the date demanded/agreed. This item is not auto-computed because no NJ Court Rule sets a fixed response period for it (see Deadlines → Rule reference).</p>`;
      return;
    }
    if(!s){$('#d_calc').innerHTML='<div class="r"><span>Pick a service date</span></div>';return;}
    const raw=add(s,t.d), rolled=roll(raw);
    let rows=`<div class="r"><span>${t.d} days per ${t.a}</span><span class="mono">${fmt(raw)}</span></div>
      <div class="r"><span>After R. 1:3-1 rolling</span><span class="mono">${fmt(rolled)}</span></div>`;
    let due=rolled;
    if(t.floorDays){
      const fs=pd($('#d_floor')?.value);
      if(fs){
        const floorRolled=roll(add(fs,t.floorDays));
        rows+=`<div class="r"><span>${t.floorDays}-day floor per ${t.floorAuthority}</span><span class="mono">${fmt(floorRolled)}</span></div>`;
        if(floorRolled>rolled) due=floorRolled;
      }
    }
    rows+=`<div class="r"><span>Controlling due date</span><span class="mono"><strong>${fmt(due)}</strong></span></div>
      <div class="r"><span>Days from today</span><span class="mono">${diff(TODAY,due)}</span></div>`;
    $('#d_calc').innerHTML=rows;
  };
  ['d_item','d_served'].forEach(i=>$('#'+i).addEventListener('input',rc)); rc();
  $('#d_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  $('#d_save').onclick=async()=>{
    const t=DISC_TYPES.find(x=>x.t===$('#d_item').value);
    if(!pd($('#d_served').value)) return toast('Pick a valid service date');
    const manualDue=t.manual?($('#d_manual')?$('#d_manual').value:''):'';
    if(t.manual && !pd(manualDue)) return toast('Enter the due date shown on the document');
    const floorServed=t.floorDays?$('#d_floor')?.value:'';
    const x=await logDiscoveryItem(mid,t,$('#d_served').value,$('#d_dir').value,manualDue,floorServed);
    if(!x) return toast('Could not log that item — check the date(s) entered');
    renderAll();$('#modalHost').innerHTML='';toast('Logged');
  };
}

/* ══════════ RECORDS CHASE ══════════ */
export function renderRecords(){
  fillMatterSelect('#recMatter',true);
  const rows=DB.records.slice().sort((a,b)=>(pd(a.nextFollowUp)||9e15)-(pd(b.nextFollowUp)||9e15));
  $('#recEmpty').style.display=rows.length?'none':'block';
  $('#recRows').innerHTML=rows.map(r=>{
    const m=mById(r.matterId)||{name:'(matter removed)'};
    const n=pd(r.nextFollowUp), dd=n?diff(TODAY,n):null;
    return `<tr><td><strong>${esc(m.name)}</strong></td><td>${esc(r.provider)}</td>
      <td class="mono">${fmt(pd(r.requested))}</td>
      <td><span class="pill p-blue">${r.stage===0?'Initial request':'Follow-up '+r.stage}</span>
        <div class="meta">${CHASE[r.stage]?CHASE[r.stage]+'-day mark':'escalate'}</div></td>
      <td class="mono">${fmt(n)}</td>
      <td><span class="num c-${tone(dd)}">${dd===null?'—':dd}</span></td>
      <td><span class="pill ${r.status==='Received'?'p-green':'p-amber'}">${esc(r.status)}</span></td>
      <td>${r.status!=='Received'?`<button class="sm" data-rn="${r.id}">Chased</button> <button class="sm" data-rr="${r.id}">Received</button> `:''}<button class="sm" data-rx="${r.id}">×</button></td></tr>`;
  }).join('');
  $$('[data-rn]').forEach(b=>b.onclick=async()=>{
    const r=DB.records.find(i=>i.id===b.dataset.rn);
    r.stage=Math.min(r.stage+1,CHASE.length-1);
    r.nextFollowUp=iso(roll(add(pd(r.requested),CHASE[r.stage])));
    touch(r);await save();SyncFS.scheduleSync();renderAll();toast('Follow-up logged');
    if(GCal.status.state==='connected') GCal.syncRecordItem(r);});
  $$('[data-rr]').forEach(b=>b.onclick=async()=>{
    const r=DB.records.find(i=>i.id===b.dataset.rr);r.status='Received';touch(r);
    if(GCal.status.state==='connected') await GCal.deleteEventOn(r);
    await save();SyncFS.scheduleSync();renderAll();});
  $$('[data-rx]').forEach(b=>b.onclick=async()=>{
    const r=DB.records.find(i=>i.id===b.dataset.rx);
    if(GCal.status.state==='connected'&&r) await GCal.deleteEventOn(r);
    tomb('records',b.dataset.rx);DB.records=DB.records.filter(i=>i.id!==b.dataset.rx);await save();SyncFS.scheduleSync();renderAll();});
}

export function newRecord(){
  const mid=$('#recMatter').value; if(!mid) return toast('Pick a matter first');
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:520px">
    <div class="mh"><h3>Provider request</h3><div class="s">${esc((mById(mid)||{}).name||'')}</div></div>
    <div class="mb"><div class="grid2">
      <div class="full"><label>Provider</label><input class="t" id="r_prov" placeholder="Life Medical Care"></div>
      <div><label>Date requested</label><input type="date" id="r_req" value="${iso(TODAY)}"></div>
      <div><label>Authorization sent</label><select class="t" id="r_auth"><option>Yes</option><option>No</option></select></div>
      <div class="full"><p class="note">Follow-ups fall at 21, 30, 45, and 60 days from the request. The board advances a stage each time you log a chase.</p></div>
    </div></div>
    <div class="mf"><button id="r_cancel">Cancel</button><button class="primary" id="r_save">Add</button></div>
  </div></div>`;
  $('#r_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  $('#r_save').onclick=async()=>{
    const req=$('#r_req').value; if(!$('#r_prov').value.trim()) return toast('Provider name required');
    const r=touch({id:uid(),matterId:mid,provider:$('#r_prov').value.trim(),requested:req,
      auth:$('#r_auth').value,stage:0,nextFollowUp:iso(roll(add(pd(req),CHASE[0]))),status:'Outstanding'});
    DB.records.push(r);
    await save();SyncFS.scheduleSync();renderAll();$('#modalHost').innerHTML='';toast('Added to the chase board');
    if(GCal.status.state==='connected') GCal.syncRecordItem(r);
  };
}

export function renderLetters(){
  fillMatterSelect('#ltrMatter',false);
  $('#ltrType').innerHTML=LETTERS.map(l=>`<option value="${l.k}">${l.t}</option>`).join('');
  const q=DB.letters.filter(l=>l.status==='Pending');
  $('#apprCount').textContent=q.length;
  $('#apprEmpty').style.display=q.length?'none':'block';
  $('#apprRows').innerHTML=q.map(l=>{
    const m=mById(l.matterId)||{name:'—'};
    return `<tr><td><strong>${esc(m.name)}</strong></td><td>${esc(l.type)}</td>
      <td><span class="pill p-grey">${esc(l.by)}</span></td><td class="mono">${fmt(pd(l.date))}</td>
      <td><button class="sm" data-la="${l.id}">Approve</button> <button class="sm" data-lv="${l.id}">View</button> <button class="sm" data-lx="${l.id}">×</button></td></tr>`;
  }).join('');
  $$('[data-la]').forEach(b=>b.onclick=async()=>{const l=DB.letters.find(x=>x.id===b.dataset.la);
    if(WHO!=='CJG'&&!confirm('Only CJG approves outgoing letters. Approve anyway?'))return;
    l.status='Approved';l.approvedBy=WHO;touch(l);await save();SyncFS.scheduleSync();renderAll();toast('Approved');});
  $$('[data-lv]').forEach(b=>b.onclick=()=>{const l=DB.letters.find(x=>x.id===b.dataset.lv);
    $('#ltrOut').innerHTML=l.raw?`<div class="lh" id="lhPrint">${l.text}</div>`:letterhead(l.text);
    window.scrollTo({top:0,behavior:'smooth'});});
  $$('[data-lx]').forEach(b=>b.onclick=async()=>{tomb('letters',b.dataset.lx);DB.letters=DB.letters.filter(x=>x.id!==b.dataset.lx);await save();SyncFS.scheduleSync();renderAll();});
  renderSentLetters();
}

export function renderSentLetters(){
  const sent=DB.letters.filter(l=>l.status==='Approved').sort((a,b)=>(b._updatedAt||'').localeCompare(a._updatedAt||''));
  const sel=$('#sentMatterFilter'), cur=sel.value;
  const seen=new Map();
  sent.forEach(l=>{ const m=mById(l.matterId); if(m&&!seen.has(m.id)) seen.set(m.id,m.name); });
  sel.innerHTML='<option value="">All matters</option>'+[...seen.entries()].sort((a,b)=>a[1].localeCompare(b[1]))
    .map(([id,name])=>`<option value="${id}">${esc(name)}</option>`).join('');
  sel.value=cur;
  const filtered=sel.value?sent.filter(l=>l.matterId===sel.value):sent;
  $('#sentEmpty').style.display=filtered.length?'none':'block';
  $('#sentRows').innerHTML=filtered.map(l=>{
    const m=mById(l.matterId)||{name:'(matter removed)'};
    const when=l._updatedAt?fmt(new Date(l._updatedAt)):'—';
    return `<tr><td><strong>${esc(m.name)}</strong></td><td>${esc(l.type)}</td>
      <td><span class="pill p-grey">${esc(l.approvedBy||'—')}</span></td><td class="mono">${when}</td>
      <td><button class="sm" data-sv="${l.id}">View</button> <button class="sm" data-sx="${l.id}">×</button></td></tr>`;
  }).join('');
  $$('[data-sv]').forEach(b=>b.onclick=()=>{const l=DB.letters.find(x=>x.id===b.dataset.sv);
    $('#ltrOut').innerHTML=l.raw?`<div class="lh" id="lhPrint">${l.text}</div>`:letterhead(l.text);
    window.scrollTo({top:0,behavior:'smooth'});});
  $$('[data-sx]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Remove this from the sent-letters log? This cannot be undone.')) return;
    tomb('letters',b.dataset.sx);DB.letters=DB.letters.filter(x=>x.id!==b.dataset.sx);await save();SyncFS.scheduleSync();renderAll();});
}

export function runScrub(){
  const lines=$('#billIn').value.split('\n').map(l=>l.trim()).filter(Boolean);
  if(!lines.length){$('#billOut').innerHTML='<div class="empty">Nothing to scrub.</div>';return;}
  const out=[]; let total=0, flagged=0;
  lines.forEach((line,i)=>{
    const p=line.split('|').map(s=>s.trim());
    if(p.length<4){ out.push({i:i+1,raw:line,bad:[{n:'Unparseable',why:'Expected: date | timekeeper | hours | narrative'}],hours:0}); return; }
    const e={date:p[0],tk:p[1],hours:parseFloat(p[2])||0,narr:p.slice(3).join(' | ')};
    total+=e.hours;
    const bad=SCRUB.filter(r=> r.re? r.re.test(e.narr) : r.test(e));
    if(bad.length) flagged++;
    out.push({i:i+1,e,bad});
  });
  $('#billOut').innerHTML=`
    <div class="tiles" style="grid-template-columns:repeat(3,1fr)">
      <div class="tile"><div class="n">${lines.length}</div><div class="l">Entries</div></div>
      <div class="tile"><div class="n">${total.toFixed(1)}</div><div class="l">Hours</div></div>
      <div class="tile ${flagged?'red':'green'}"><div class="n">${flagged}</div><div class="l">Flagged</div></div>
    </div>
    ${out.map(o=>`<div class="card" style="padding:12px 14px;margin-bottom:9px;border-left:3px solid ${o.bad.length?'var(--oxblood)':'var(--moss)'}">
      <div style="font-size:12.5px"><span class="mono">${o.e?esc(o.e.date+' · '+o.e.tk+' · '+o.e.hours.toFixed(1)):''}</span></div>
      <div style="margin:4px 0 6px">${esc(o.e?o.e.narr:o.raw)}</div>
      ${o.bad.length? o.bad.map(b=>`<div style="font-size:11.5px;color:var(--oxblood);margin-top:4px">
        <strong>${esc(b.n)}</strong> — ${esc(b.why)}</div>`).join('')
        : '<div style="font-size:11.5px;color:var(--moss)">Clean.</div>'}
    </div>`).join('')}`;
}

/* ══════════ TASKS ══════════ */
export function renderTasks(){
  const f=$('#taskOwnerFilter');
  if(f.options.length<=1) f.innerHTML='<option value="">All owners</option>'+PEOPLE.map(p=>`<option value="${p.i}">${p.i} — ${p.n}</option>`).join('');
  const own=f.value;
  const cols=[['Open',t=>!t.done&&(!t.due||diff(TODAY,pd(t.due))>14)],
              ['Next 14 days',t=>!t.done&&t.due&&diff(TODAY,pd(t.due))<=14&&diff(TODAY,pd(t.due))>=0],
              ['Overdue',t=>!t.done&&t.due&&diff(TODAY,pd(t.due))<0]];
  const list=DB.tasks.filter(t=>!own||t.owner===own);
  $('#taskCount').textContent=`${list.filter(t=>!t.done).length} open · ${list.filter(t=>t.done).length} done`;
  $('#taskBoard').innerHTML=cols.map(([label,fn])=>{
    const items=list.filter(fn).sort((a,b)=>(pd(a.due)||9e15)-(pd(b.due)||9e15));
    return `<div class="card"><h3>${label} <span class="pill ${label==='Overdue'?'p-red':label==='Next 14 days'?'p-amber':'p-grey'}">${items.length}</span></h3>
      ${items.length? items.map(t=>{
        const m=mById(t.matterId);
        return `<div style="padding:8px 0;border-bottom:1px solid var(--rule2)">
          <div style="display:flex;gap:8px;align-items:flex-start">
            <input type="checkbox" data-tk="${t.id}" style="width:auto;margin-top:3px">
            <div style="flex:1">
              <div style="font-weight:500;font-size:13px">${esc(t.title)}</div>
              <div class="meta">${m?esc(m.name)+' · ':''}<span class="pill p-grey">${esc(t.owner)}</span>
                ${t.due?` <span class="mono c-${tone(diff(TODAY,pd(t.due)))}">${fmt(pd(t.due))}</span>`:''}</div>
            </div>
            <button class="sm ghost" data-tx="${t.id}">×</button></div></div>`;}).join('')
        : '<p class="note">Nothing here.</p>'}</div>`;
  }).join('');
  $$('[data-tk]').forEach(c=>c.onclick=async()=>{
    const t=DB.tasks.find(x=>x.id===c.dataset.tk);
    /* A task linked to a filing deadline is NOT just a checkbox — checking
       it here used to mark the task done directly, which silently
       finished the obligation without ever going through the filing gate
       (no confirmation, no status change on the deadline itself, no
       record of how it was closed). Route to the same gate the Deadlines
       ledger uses instead, so there is exactly one way a filing obligation
       actually closes out, not two. */
    const d=t.linkedDeadlineId&&DB.deadlines.find(x=>x.id===t.linkedDeadlineId);
    if(d&&!isDeadlineDone(d)){ renderAll(); confirmFilingModal(d.id); return; }
    t.done=true;touch(t);await save();SyncFS.scheduleSync();renderAll();
  });
  $$('[data-tx]').forEach(b=>b.onclick=async()=>{tomb('tasks',b.dataset.tx);DB.tasks=DB.tasks.filter(x=>x.id!==b.dataset.tx);await save();SyncFS.scheduleSync();renderAll();});
}

export function newTask(){
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:520px">
    <div class="mh"><h3>New task</h3><div class="s">Assign to the handling attorney, or to Jordan for discovery and motion support.</div></div>
    <div class="mb"><div class="grid2">
      <div class="full"><label>Task</label><input class="t" id="t_title" placeholder="Draft motion to extend discovery"></div>
      <div><label>Owner</label><select class="t" id="t_owner">${PEOPLE.map(p=>`<option value="${p.i}"${p.i===WHO?' selected':''}>${p.i} — ${p.n}</option>`).join('')}</select></div>
      <div><label>Due</label><input type="date" id="t_due"></div>
      <div class="full"><label>Matter (optional)</label><select class="t" id="t_matter"></select></div>
    </div></div>
    <div class="mf"><button id="t_cancel">Cancel</button><button class="primary" id="t_save">Add</button></div>
  </div></div>`;
  fillMatterSelect('#t_matter',true);
  $('#t_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  $('#t_save').onclick=async()=>{
    if(!$('#t_title').value.trim())return toast('Give it a title');
    DB.tasks.push(touch({id:uid(),title:$('#t_title').value.trim(),owner:$('#t_owner').value,
      due:$('#t_due').value,matterId:$('#t_matter').value||null,done:false}));
    await save();SyncFS.scheduleSync();renderAll();$('#modalHost').innerHTML='';toast('Task added');
  };
}

/* ══════════ DIRECTORY ══════════ */
export function renderDirectory(){
  $('#dirOffices').innerHTML=
    `<div style="padding:7px 0;border-bottom:1px solid var(--rule2)"><strong>CEDAR KNOLLS (main)</strong>
      <div class="note">${esc(FIRM.street)}<br>${esc(FIRM.city)}</div></div>`
    +FIRM.otherOffices.map(o=>`<div style="padding:7px 0;border-bottom:1px solid var(--rule2)">
      <strong>${esc(o.label)}</strong><div class="note">${esc(o.l1)}<br>${esc(o.l2)}</div></div>`).join('')
    +`<div style="padding:7px 0"><div class="note mono">${esc(FIRM.phone)} &nbsp;&middot;&nbsp; ${esc(FIRM.fax)}</div>
      <div class="note" style="font-style:italic">${esc(FIRM.respond)}</div></div>`;
  $('#dirPeople').innerHTML=PEOPLE.map(p=>`<tr><td class="mono"><strong>${p.i}</strong></td>
    <td>${esc(p.n)}${p.mark?`<sup>${esc(p.mark)}</sup>`:''}</td>
    <td>${esc(p.r)}</td><td class="note">${esc(p.o||'—')}</td></tr>`).join('')
    +`<tr><td colspan="4" class="note" style="padding-top:9px">${FIRM.legend.map(l=>`<sup>${esc(l.m)}</sup>&nbsp;${esc(l.t)}`).join(' &nbsp;&middot;&nbsp; ')}</td></tr>`;
  $('#dirCarriers').innerHTML=CARRIERS.map(c=>`<tr><td><strong>${esc(c.n)}</strong></td>
    <td><span class="pill ${c.s==='Panel'?'p-green':'p-amber'}">${esc(c.s)}</span></td><td>${esc(c.c||'—')}</td></tr>`).join('');
  $('#dirVenues').innerHTML=Object.entries(VENUES).map(([k,v])=>`<strong>${k}</strong> &nbsp;${esc(v)}`).join('<br>');
}

/* ══════════ EXPORTS ══════════ */
export function dl(name,text,mime){const b=new Blob([text],{type:mime}),u=URL.createObjectURL(b);
  const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500);}

export function icsD(d){return iso(d).replace(/-/g,'');}

export function icalEsc(s){return String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');}

export function buildIcs(){
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//GBR//Matter Ops//EN','CALSCALE:GREGORIAN'];let n=0;
  const ev=(dt,title,desc)=>{L.push('BEGIN:VEVENT','UID:'+uid()+Date.now()+'@gaul-law.com',
    'DTSTAMP:'+icsD(TODAY)+'T090000Z','DTSTART;VALUE=DATE:'+icsD(dt),'DTEND;VALUE=DATE:'+icsD(add(dt,1)),
    'SUMMARY:'+icalEsc(title),'DESCRIPTION:'+icalEsc(desc),
    'BEGIN:VALARM','TRIGGER:-P7D','ACTION:DISPLAY','DESCRIPTION:'+icalEsc(title),'END:VALARM','END:VEVENT');n++;};
  DB.matters.filter(isLive).forEach(m=>{
    matterCalItems(m).forEach(it=>ev(it.date,it.summary,it.description));
  });
  DB.records.filter(r=>r.status!=='Received'&&r.nextFollowUp).forEach(r=>{
    const m=mById(r.matterId); if(!m) return;
    ev(pd(r.nextFollowUp),`${m.owner}: ${m.name} - RECORDS FOLLOW-UP ${r.provider} - ${m.venue||''}`,`Stage ${r.stage}. Requested ${fmt(pd(r.requested))}.`);
  });
  DB.discovery.filter(x=>x.status!=='Complete'&&x.dueDate).forEach(x=>{
    const m=mById(x.matterId); if(!m) return;
    ev(pd(x.dueDate),`${m.owner}: ${m.name} - ${x.item.toUpperCase()} DUE - ${m.venue||''}`,`${x.direction}. Served ${fmt(pd(x.served))}. ${x.authority}.`);
  });
  DB.deadlines.filter(d=>!isDeadlineDone(d)&&d.due).forEach(d=>{
    const m=mById(d.matterId); if(!m) return;
    const prefix=d.filing===true?'FILE WITH COURT':d.filing==='confirm'?'CONFIRM FILING REQ.':'DEADLINE';
    ev(pd(d.due),`${m.owner}: ${m.name} - ${prefix}: ${d.title} - ${m.venue||''}`,`${d.authority}. Trigger ${fmt(pd(d.trigger))}.${d.notes?' '+d.notes:''}`);
  });
  L.push('END:VCALENDAR');return{text:L.join('\r\n'),n};
}

export function buildCsv(){
  const H=['Case Name','Docket #','Our File #','Side','Status','Owner','Track','Carrier','Claim #','Adjuster','Judge',
    'Original DED','Current DED','Days to DED','File Motion By','Return Date','60-Day Consent','Motion to Extend',
    'Medical Records','Plaintiff Deposition','IME','Arbitration','Trial','SOL','Notes'];
  const q=v=>{v=String(v==null?'':v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  const L=[H.join(',')];
  DB.matters.forEach(m=>{const d=derive(m);
    L.push([m.name,m.docket,m.file,m.side,m.status,m.owner,m.track,m.carrier,m.claim,m.adjuster,m.judge,
      fmt(pd(m.originalDED)),fmt(pd(m.currentDED)),d.dDED===null?'':d.dDED,fmt(d.file),fmt(d.ret),
      m.consent,m.motion,m.records,m.depo,m.ime,fmt(pd(m.arbitration)),fmt(pd(m.trial)),fmt(pd(m.sol)),m.notes].map(q).join(','));});
  return L.join('\n');
}

/* ══════════ RENDER + WIRING ══════════ */
export function renderAll(){
  $('#whoLbl').textContent=`${WHO} · ${fmt(TODAY)}`;
  $('#draftBanner').innerHTML = DB.matters.length ? '' : `<div class="info">
    <strong>No matters loaded yet.</strong> Add one by hand from Intake or Matters, drop a scanned notice or order
    to have it read automatically, or open a handoff file from a colleague (Settings → Open handoff file) to bring
    in an existing list. Nothing here leaves this browser unless you connect a shared folder or send a handoff
    file yourself — see Settings.</div>`;
  const of_=$('#fOwner');
  if(of_.options.length<=1) of_.innerHTML='<option value="">All timekeepers</option>'+PEOPLE.map(p=>`<option value="${p.i}">${p.i}</option>`).join('');
  $('#setWho').innerHTML=PEOPLE.map(p=>`<option value="${p.i}"${p.i===WHO?' selected':''}>${p.i} — ${p.n}</option>`).join('');
  $('#setKey').value=APIKEY;
  $('#setRules').innerHTML=STANDING.map(s=>`<li>${esc(s)}</li>`).join('');
  $('#billRules').innerHTML=SCRUB.map(r=>`<div style="padding:7px 0;border-bottom:1px solid var(--rule2)">
    <strong style="font-size:12.5px">${esc(r.n)}</strong><div class="note">${esc(r.why)}</div></div>`).join('');
  paintKey(); renderSyncStatus(); renderGcalStatus();
  renderDash();renderMatters();renderDeadlines();renderDeadlineLedger();renderDiscovery();renderRecords();
  renderLetters();renderTasks();renderDirectory();
}

export function timeAgo(d){
  const s=Math.max(0,Math.round((Date.now()-d.getTime())/1000));
  if(s<60) return 'just now';
  const m=Math.round(s/60); if(m<60) return m+' min ago';
  const h=Math.round(m/60); if(h<24) return h+' hr ago';
  return fmt(d);
}

export function renderSyncStatus(){
  const el=$('#syncStatus'); if(!el) return;
  const s=SyncFS.status;
  const btnConnect=$('#btnSyncConnect'), btnResume=$('#btnSyncResume'), btnNow=$('#btnSyncNow'), btnDisc=$('#btnSyncDisconnect');
  if(!SyncFS.supported){
    el.innerHTML=`<p class="note">This browser doesn't support folder sync (Chrome or Edge only). Use Save/Open handoff file to share data instead.</p>`;
    [btnConnect,btnResume,btnNow,btnDisc].forEach(b=>{ if(b) b.hidden=true; });
    return;
  }
  const ago=s.lastSyncedAt?timeAgo(s.lastSyncedAt):'';
  const views={
    off:()=>`<p class="note">Not connected. Matters stay only in this browser until you connect a folder or use a handoff file.</p>`,
    'needs-permission':()=>`<div class="warn">Sync paused — this browser needs you to confirm access to <strong>${esc(s.name)}</strong> again (browsers ask again after a restart or a while idle). Click Resume syncing.</div>`,
    syncing:()=>`<p class="note">Syncing with <strong>${esc(s.name)}</strong>…</p>`,
    synced:()=>`<p class="note">Synced with <strong>${esc(s.name)}</strong> — last synced ${ago}.</p>`,
    error:()=>`<div class="alert">Sync error on <strong>${esc(s.name)}</strong>: ${esc(s.error)}. Your local copy is safe; this will retry automatically, or click Sync now.</div>`
  };
  el.innerHTML=(views[s.state]||views.off)();
  if(btnConnect) btnConnect.hidden=s.state!=='off';
  if(btnResume) btnResume.hidden=s.state!=='needs-permission';
  if(btnNow) btnNow.hidden=s.state==='off';
  if(btnDisc) btnDisc.hidden=s.state==='off';
}

export function renderGcalStatus(){
  const el=$('#gcalStatus'); if(!el) return;
  const btnConnect=$('#btnGcalConnect'), btnDisc=$('#btnGcalDisconnect'), btnPush=$('#btnGcalPushAll');
  if(!GCal.supported){
    el.innerHTML=`<p class="note">Not set up yet — an admin needs to complete the one-time Google Cloud setup in the README before this can be used.</p>`;
    [btnConnect,btnDisc,btnPush].forEach(b=>{ if(b) b.hidden=true; });
    return;
  }
  const s=GCal.status;
  const views={
    off:()=>`<p class="note">Not connected.</p>`,
    connecting:()=>`<p class="note">Connecting…</p>`,
    connected:()=>`<p class="note">Connected${GCal.email?` as <strong>${esc(GCal.email)}</strong>`:''}.</p>`,
    error:()=>`<div class="alert">Google Calendar error: ${esc(s.error)}. Try Connect again.</div>`
  };
  el.innerHTML=(views[s.state]||views.off)();
  if(btnConnect) btnConnect.hidden=s.state==='connected';
  if(btnDisc) btnDisc.hidden=s.state!=='connected';
  if(btnPush) btnPush.hidden=s.state!=='connected';
}

export function paintKey(){
  const b=$('#keyBanner');
  if(APIKEY||window.storage){b.innerHTML='';return;}
  b.innerHTML=`<div class="warn"><strong>Reading is off.</strong> This copy is running from a file on your computer,
    so it needs the firm's Anthropic API key before it can read documents. Add one in Settings.
    The deadline engine, letters, and Add by hand all work without it.</div>`;
}

$('#tabs').onclick=e=>{
  const b=e.target.closest('button[data-p]'); if(!b) return;
  $$('#tabs button').forEach(x=>x.classList.toggle('on',x===b));
  $$('.panel').forEach(p=>p.classList.toggle('on',p.id==='p-'+b.dataset.p));
  window.scrollTo({top:0});
};

export const drop=$('#drop');

drop.onclick=()=>$('#picker').click();

drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#picker').click();}};

$('#picker').onchange=e=>{handleFiles([...e.target.files]);e.target.value='';};

['dragenter','dragover'].forEach(v=>drop.addEventListener(v,e=>{e.preventDefault();drop.classList.add('hot');}));

['dragleave','drop'].forEach(v=>drop.addEventListener(v,e=>{e.preventDefault();drop.classList.remove('hot');}));

drop.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));

window.addEventListener('dragover',e=>e.preventDefault());

window.addEventListener('drop',e=>e.preventDefault());

export const recChartOpts={queue:'#recQueue',extractor:extractProvidersChart,onResult:reviewProvidersExtract};

export const recDrop=$('#recDrop');

recDrop.onclick=()=>$('#recPicker').click();

recDrop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#recPicker').click();}};

$('#recPicker').onchange=e=>{handleFiles([...e.target.files],recChartOpts);e.target.value='';};

['dragenter','dragover'].forEach(v=>recDrop.addEventListener(v,e=>{e.preventDefault();recDrop.classList.add('hot');}));

['dragleave','drop'].forEach(v=>recDrop.addEventListener(v,e=>{e.preventDefault();recDrop.classList.remove('hot');}));

recDrop.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files],recChartOpts));

$('#btnManual').onclick=()=>openMatter(null);

$('#btnWhatHappened').onclick=openWhatHappened;

$('#btnNewMatter').onclick=()=>openMatter(null);

$('#btnKey').onclick=()=>{$$('#tabs button').forEach(x=>x.classList.toggle('on',x.dataset.p==='settings'));
  $$('.panel').forEach(p=>p.classList.toggle('on',p.id==='p-settings'));window.scrollTo({top:0});};

['fSide','fStatus','fOwner','fSearch'].forEach(i=>$('#'+i).addEventListener('input',renderMatters));

$('#sentMatterFilter').addEventListener('input',renderSentLetters);

['calcRule','calcFrom','calcTrack'].forEach(i=>$('#'+i).addEventListener('input',runCalc));

$('#btnNewDeadline').onclick=()=>newDeadline();

$('#btnNewDisc').onclick=newDiscovery;

$('#btnNewRec').onclick=newRecord;

$('#btnNewTask').onclick=newTask;

$('#taskOwnerFilter').onchange=renderTasks;

$('#btnScrub').onclick=runScrub;

$('#btnScrubClear').onclick=()=>{$('#billIn').value='';$('#billOut').innerHTML='<div class="empty">Paste entries and run the scrub.</div>';};

$('#btnGenLtr').onclick=async()=>{
  const m=mById($('#ltrMatter').value); if(!m) return toast('Pick a matter');
  const kind=$('#ltrType').value, def=LETTERS.find(l=>l.k===kind)||{};
  const isForm=!!def.form;
  const text=isForm?hipaaForm(m):buildLetter(kind,m);
  // The HIPAA authorization is a standalone form - it does not go on letterhead.
  $('#ltrOut').innerHTML=isForm?`<div class="lh" id="lhPrint">${text}</div>`:letterhead(text);
  DB.letters.push(touch({id:uid(),matterId:m.id,type:def.t,by:WHO,
    date:iso(TODAY),status:'Pending',text,raw:isForm}));
  await save();SyncFS.scheduleSync();renderLetters();toast('Drafted — sitting in the approval queue');
};

$('#btnPrintLtr').onclick=()=>{ if(!$('#lhPrint')) return toast('Generate a letter first'); window.print(); };

$('#btnCsv').onclick=()=>{dl('gbr-matters.csv',buildCsv(),'text/csv');toast('Exported');};

$('#btnIcs').onclick=()=>{const{text,n}=buildIcs();if(!n)return toast('No dated items to export');
  dl('gbr-deadlines.ics',text,'text/calendar');toast(n+' events exported');};

export const saveJson=()=>{const c=JSON.parse(JSON.stringify(DB));
  dl('gbr-ops-handoff.json',JSON.stringify({app:'GBR Matter Ops',saved:new Date().toISOString(),db:c},null,2),'application/json');
  toast('Handoff file saved — the API key is not in it');};

$('#btnJson').onclick=saveJson;

 $('#btnJson2').onclick=saveJson;

export const openJson=()=>$('#loader').click();

$('#btnLoad').onclick=openJson;

 $('#btnLoad2').onclick=openJson;

$('#loader').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=async()=>{
    try{
      const inc=JSON.parse(String(r.result)).db||{};
      const localKeys=new Set(DB.matters.map(m=>mergeKey('matters',m)));
      let a=0,u=0;
      (inc.matters||[]).forEach(m=>{ const k=mergeKey('matters',m); if(k&&localKeys.has(k)) u++; else a++; });
      const merged=mergeDB(DB,inc);
      DB.matters=merged.matters; DB.discovery=merged.discovery; DB.records=merged.records;
      DB.tasks=merged.tasks; DB.letters=merged.letters; DB.deadlines=merged.deadlines; DB.deleted=merged.deleted;
      await save();SyncFS.scheduleSync();renderAll();toast(`${a} matters added, ${u} updated`);
    }catch(err){toast('That file could not be read');}
  };
  r.readAsText(f);e.target.value='';
};

$('#btnSaveSet').onclick=async()=>{
  setWho($('#setWho').value); setApiKey($('#setKey').value.trim());
  await Store.set(K_WHO,WHO); await Store.set(K_KEY,APIKEY);
  renderAll(); toast('Saved');
};

$('#btnClearKey').onclick=async()=>{setApiKey('');$('#setKey').value='';await Store.set(K_KEY,'');paintKey();toast('Key removed');};

$('#btnWipe').onclick=async()=>{
  const synced=SyncFS.handle?' This browser is connected to a shared folder — it only clears your local view; the shared file is untouched, and your next sync will bring everything right back. Disconnect first if you actually want it gone from the shared folder too.':'';
  if(!confirm('Erase every matter, task, record, and letter in this browser? Export a handoff file first.'+synced)) return;
  resetDB();
  await save();renderAll();toast('Erased');
};

$('#btnSyncConnect').onclick=()=>SyncFS.connect();

$('#btnSyncResume').onclick=()=>SyncFS.resume();

$('#btnSyncNow').onclick=()=>SyncFS.sync();

$('#btnSyncDisconnect').onclick=()=>{
  if(confirm('Stop syncing this browser to "'+SyncFS.status.name+'"? The shared file itself is left exactly as it is — other people stay connected.')) SyncFS.disconnect();
};

$('#btnGcalConnect').onclick=()=>GCal.connect();

$('#btnGcalDisconnect').onclick=()=>{ if(confirm('Disconnect this browser from Google Calendar? Events already on the calendar are left as they are.')) GCal.disconnect(); };

$('#btnGcalPushAll').onclick=()=>GCal.syncAllMatters();

$('#calcFrom').value=iso(TODAY);

async function boot(){
  await loadDB();
  await loadSettings();
  renderAll();
  SyncFS.init();
  GCal.init();
}
boot();

/* A tab left open across midnight kept computing "days from today" and
   defaulting new date fields against the day it was opened, indefinitely.
   Re-check on a slow interval and whenever the tab regains focus (the
   common real case — someone leaves it open overnight, comes back in the
   morning) and re-render if the date actually rolled over. */
setInterval(()=>{ if(refreshTodayIfStale()) renderAll(); },600000);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible' && refreshTodayIfStale()) renderAll();
});
