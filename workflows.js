"use strict";
import {DATE_PROPOSAL_FIELDS, DISC_TYPES, FILING_STAGES, FIRM, LETTERS, PEOPLE, RULES, TRACK_DAYS, VENUES, WHAT_HAPPENED_EVENTS} from './config.js';
import {add, addBusinessDays, addMonths, addYears, diff, fmt, fmtLong, holidayCoverageNote, iso, pd, returnDate, roll, rollBack, subtractBusinessDays} from './dates.js';
import {$, $$, esc, toast} from './util.js';
import {DB, SyncFS, TODAY, WHO, fillMatterSelect, mById, save, touch, uid} from './store.js';
import {GCal} from './gcal.js';
import {derive, dl, openMatter, renderAll, renderLetters} from './app.js';

/* ══════════ DEADLINE LEDGER ══════════
   Tracks a deadline against a real matter — unlike the calculator above,
   which is just a scratch-pad — so it can carry a status, sync to Google
   Calendar with a reminder ladder, and (for a filing deadline) surface a
   linked task. Reuses the same math as the calculator; see computeRuleDue. */
export function computeRuleDue(r,from,track){
  if(!from) return null;
  if(r.special==='ext') return rollBack(add(returnDate(from),-16));
  if(r.track) return track?roll(add(from,TRACK_DAYS[track])):null;
  if(r.special==='years') return addYears(from,r.n);
  if(r.special==='months') return addMonths(from,r.n);
  /* Corrected 10/1/2026 — R. 1:3-1: a period of LESS than 7 days excludes
     intervening Saturdays, Sundays, and legal holidays from the count
     itself. That is not the same as counting calendar days and rolling
     only the landing day (which is correct, but only for periods of 7
     days or more). Confirmed against current rule text: a 4-day reply
     counted off a Monday return date must land 4 business days earlier,
     not 4 calendar days earlier with the end rolled. */
  if(Math.abs(r.d)<7) return r.d<0?subtractBusinessDays(from,-r.d):addBusinessDays(from,r.d);
  const raw=add(from,r.d);
  return r.d<0?rollBack(raw):roll(raw);
}

export function filingBadge(f){
  if(f===true) return {c:'p-red',t:'FILE WITH COURT'};
  if(f==='confirm') return {c:'p-amber',t:'confirm filing?'};
  return {c:'p-grey',t:'no filing'};
}

export function nextFilingStage(status){
  const i=FILING_STAGES.indexOf(status);
  return FILING_STAGES[i<0?0:Math.min(i+1,FILING_STAGES.length-1)];
}

export function isDeadlineDone(d){ return d.status==='Done'||d.status==='Confirmed'||d.status==='Moot'||d.status==='Superseded'; }

export function deadlineStatusPill(status){
  return {Open:'p-grey',Drafting:'p-blue','Ready to File':'p-amber',Filed:'p-amber',Confirmed:'p-green',Done:'p-green',Moot:'p-grey',Superseded:'p-grey'}[status]||'p-grey';
}

/* Fallback accessors so a deadline logged before this release (missing
   action/workProduct/owner/gbrInternalDate) still renders sensibly instead
   of showing blanks — no migration pass needed, old records just compute
   the same defaults a new one would get. */
export function deadlineAction(d){ return d.action || (d.filing===true?'FILE + SERVE':d.filing==='confirm'?'CONFIRM REQUIRED':'TRACK'); }

export function deadlineOwner(d){ return d.owner || (mById(d.matterId)||{}).owner || '—'; }

export function deadlineInternalDate(d){ return d.gbrInternalDate || d.due; }

/* The actual gate: a filing deadline reaches Confirmed only through here.
   Real confirmation (a method + evidence of when/how) or a reasoned
   override by the managing partner — never a bare status flip. */
/* Corrected 10/1/2026: filing and service are separate acts under the
   rules this table cites (e.g. R. 4:21A-6(b)(1) requires a trial de novo
   demand to be BOTH filed with the civil division manager AND served on
   every other party) — confirming one used to be treated as finishing
   the whole FILE + SERVE obligation, closing its task and deleting its
   Calendar reminder, with service never actually asked about. Now both
   are tracked independently and the obligation only reaches Confirmed
   (and only then loses its task/reminder) once both are recorded. Either
   can be confirmed first; reopening this modal only asks for whichever
   is still missing. */
export function confirmFilingModal(deadlineId){
  const d=DB.deadlines.find(x=>x.id===deadlineId); if(!d) return;
  const m=mById(d.matterId);
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:540px">
    <div class="mh"><h3>Confirm filing &amp; service</h3><div class="s">${esc(m?m.name:'')} — ${esc(d.title)}</div></div>
    <div class="mb">
      <p class="note">This can't reach Confirmed without proof it was filed AND served, or a partner override with a reason on the record for whichever is missing.</p>
      <h4 style="margin:0 0 6px">Filing</h4>
      ${d.filingConfirmation?`<p class="note">Already confirmed — ${esc(d.filingConfirmation.method)}${d.filingConfirmation.filedDate?' — '+fmt(pd(d.filingConfirmation.filedDate)):''}.</p>`:`
      <div class="full"><label>Confirmation method</label><select class="t" id="cf_method">
        <option value="">— pick one —</option>
        <option value="eCourts">NJ eCourts filing confirmation</option>
        <option value="stamped">Stamped / returned copy</option>
        <option value="docket">Docket entry confirmed</option>
        <option value="override">Partner override — no filing confirmation yet</option>
      </select></div>
      <div class="full" id="cf_dateWrap"><label>Filed date</label><input type="date" id="cf_date" value="${iso(TODAY)}"></div>
      <div class="full" id="cf_reasonWrap" style="display:none"><label>Override reason (required)</label><textarea class="t" id="cf_reason" rows="2" placeholder="Why this is being marked confirmed without a filing confirmation"></textarea></div>`}
      <h4 style="margin:14px 0 6px">Service</h4>
      ${d.serviceConfirmation?`<p class="note">Already confirmed — ${esc(d.serviceConfirmation.method)}${d.serviceConfirmation.servedDate?' — '+fmt(pd(d.serviceConfirmation.servedDate)):''}.</p>`:`
      <div class="full"><label>Confirmation method</label><select class="t" id="cs_method">
        <option value="">— pick one —</option>
        <option value="eCourts">NJ eCourts electronic service</option>
        <option value="mail">Regular/certified mail</option>
        <option value="hand">Hand delivery</option>
        <option value="email">Email (by agreement/consent)</option>
        <option value="override">Partner override — no service confirmation yet</option>
      </select></div>
      <div class="full" id="cs_dateWrap"><label>Served date</label><input type="date" id="cs_date" value="${iso(TODAY)}"></div>
      <div class="full" id="cs_reasonWrap" style="display:none"><label>Override reason (required)</label><textarea class="t" id="cs_reason" rows="2" placeholder="Why this is being marked confirmed without a service confirmation"></textarea></div>`}
    </div>
    <div class="mf"><button id="cf_cancel">Cancel</button><button class="primary" id="cf_save">Save</button></div>
  </div></div>`;
  if($('#cf_method')){
    const toggle=()=>{ const v=$('#cf_method').value;
      $('#cf_reasonWrap').style.display=v==='override'?'':'none';
      $('#cf_dateWrap').style.display=v==='override'?'none':''; };
    $('#cf_method').addEventListener('input',toggle); toggle();
  }
  if($('#cs_method')){
    const toggle=()=>{ const v=$('#cs_method').value;
      $('#cs_reasonWrap').style.display=v==='override'?'':'none';
      $('#cs_dateWrap').style.display=v==='override'?'none':''; };
    $('#cs_method').addEventListener('input',toggle); toggle();
  }
  $('#cf_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  $('#cf_save').onclick=async()=>{
    let changed=false;
    if(!d.filingConfirmation && $('#cf_method')){
      const method=$('#cf_method').value;
      if(method){
        if(method==='override'){
          if(WHO!=='CJG') return toast('Only CJG can override a filing confirmation');
          const reason=$('#cf_reason').value.trim(); if(!reason) return toast('Filing override reason is required');
          d.filingConfirmation={method:'override',by:WHO,reason,at:new Date().toISOString()};
        } else {
          const fd=$('#cf_date').value; if(!pd(fd)) return toast('Pick a valid filed date');
          d.filingConfirmation={method,by:WHO,filedDate:fd,at:new Date().toISOString()};
        }
        changed=true;
      }
    }
    if(!d.serviceConfirmation && $('#cs_method')){
      const method=$('#cs_method').value;
      if(method){
        if(method==='override'){
          if(WHO!=='CJG') return toast('Only CJG can override a service confirmation');
          const reason=$('#cs_reason').value.trim(); if(!reason) return toast('Service override reason is required');
          d.serviceConfirmation={method:'override',by:WHO,reason,at:new Date().toISOString()};
        } else {
          const sd=$('#cs_date').value; if(!pd(sd)) return toast('Pick a valid served date');
          d.serviceConfirmation={method,by:WHO,servedDate:sd,at:new Date().toISOString()};
        }
        changed=true;
      }
    }
    if(!changed) return toast('Pick at least a filing or service confirmation method');
    touch(d);
    const complete=!!d.filingConfirmation&&!!d.serviceConfirmation;
    if(complete){
      d.status='Confirmed';
      if(GCal.status.state==='connected') await GCal.deleteEventOn(d);
      closeLinkedTask(d.id); closeLinkedObligation(d.id);
    } else {
      d.status='Filed'; // one side confirmed; stays open and keeps its reminder until the other is too
    }
    await save(); SyncFS.scheduleSync(); renderAll();
    $('#modalHost').innerHTML='';
    toast(complete?'Filing and service confirmed':`${d.filingConfirmation?'Filing':'Service'} confirmed — still needs ${d.filingConfirmation?'service':'filing'} confirmation`);
  };
}

/* The `filing:'confirm'` case (an uncertain filing requirement, e.g. a
   subpoena-adjacent item this app can't classify on its own) used to get
   a bare Done button with no gate at all — staff could close it without
   ever actually resolving whether it needed to be filed. This forces that
   determination first, on the record, before the obligation can close. */
export function resolveFilingRequirementModal(deadlineId){
  const d=DB.deadlines.find(x=>x.id===deadlineId); if(!d) return;
  const m=mById(d.matterId);
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:480px">
    <div class="mh"><h3>Resolve filing requirement</h3><div class="s">${esc(m?m.name:'')} — ${esc(d.title)}</div></div>
    <div class="mb">
      <p class="note">This was logged with an unresolved filing requirement. Confirm whether it actually needs to be filed with the court before it can close.</p>
      <div class="full"><label>Does this need to be filed with the court?</label>
        <select class="t" id="rf_answer"><option value="">— pick one —</option>
          <option value="yes">Yes — filing (and service) is required</option>
          <option value="no">No — tracking/service only, no court filing</option>
        </select></div>
      <div class="full" id="rf_noteWrap" style="display:none"><label>Note (required)</label><textarea class="t" id="rf_note" rows="2" placeholder="Basis for this determination"></textarea></div>
    </div>
    <div class="mf"><button id="rf_cancel">Cancel</button><button class="primary" id="rf_save">Save</button></div>
  </div></div>`;
  const toggle=()=>{ $('#rf_noteWrap').style.display=$('#rf_answer').value?'':'none'; };
  $('#rf_answer').addEventListener('input',toggle); toggle();
  $('#rf_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  $('#rf_save').onclick=async()=>{
    const answer=$('#rf_answer').value; if(!answer) return toast('Pick an answer');
    const note=$('#rf_note').value.trim(); if(!note) return toast('A note is required');
    d.filingResolution={answer,by:WHO,note,at:new Date().toISOString()};
    if(answer==='yes'){
      d.filing=true; d.action='FILE + SERVE'; touch(d);
      /* logDeadline() only creates the Tasks-tab reminder when filing:true
         is known at CREATION time — an obligation converted from uncertain
         to required here needs the same reminder created now, or it has no
         staff-facing task the way every other FILE + SERVE deadline does. */
      if(!DB.tasks.some(t=>t.linkedDeadlineId===d.id)){
        DB.tasks.push(touch({id:uid(),title:`File: ${d.title} — ${(m||{}).name||''}`,
          owner:(m&&m.owner)||d.owner||WHO,due:d.due,matterId:d.matterId,done:false,linkedDeadlineId:d.id}));
      }
      await save(); SyncFS.scheduleSync(); renderAll();
      $('#modalHost').innerHTML='';
      toast('Marked as requiring filing — confirm filing and service from the ledger');
    } else {
      d.status='Done'; touch(d);
      if(GCal.status.state==='connected') await GCal.deleteEventOn(d);
      closeLinkedTask(d.id); closeLinkedObligation(d.id);
      await save(); SyncFS.scheduleSync(); renderAll();
      $('#modalHost').innerHTML='';
      toast('Resolved — no filing required, marked done');
    }
  };
}

/* The other legitimate way a filing obligation closes: it turned out not
   to be needed (withdrawn, mooted, the matter settled). Distinct from
   Confirmed (which asserts a filing happened) and from deleting the row
   (which would erase why it was closed) — this keeps the audit trail
   honest about what actually happened. */
export function closeMootModal(deadlineId){
  const d=DB.deadlines.find(x=>x.id===deadlineId); if(!d) return;
  const m=mById(d.matterId);
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:520px">
    <div class="mh"><h3>Close without filing</h3><div class="s">${esc(m?m.name:'')} — ${esc(d.title)}</div></div>
    <div class="mb">
      <p class="note">Use this when the filing is genuinely no longer needed — not as a way around Confirm filing.</p>
      <div class="full"><label>Reason (required)</label><textarea class="t" id="mt_reason" rows="2" placeholder="e.g. motion withdrawn, matter settled before the return date"></textarea></div>
    </div>
    <div class="mf"><button id="mt_cancel">Cancel</button><button class="primary" id="mt_save">Close it</button></div>
  </div></div>`;
  $('#mt_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  $('#mt_save').onclick=async()=>{
    const reason=$('#mt_reason').value.trim(); if(!reason) return toast('A reason is required');
    d.mootReason={by:WHO,reason,at:new Date().toISOString()};
    d.status='Moot'; touch(d);
    if(GCal.status.state==='connected') await GCal.deleteEventOn(d);
    closeLinkedTask(d.id); closeLinkedObligation(d.id);
    await save(); SyncFS.scheduleSync(); renderAll();
    $('#modalHost').innerHTML=''; toast('Closed — no filing was made');
  };
}

/* A filing deadline auto-creates a linked task (see newDeadline); once the
   deadline itself is done or removed, that task should never keep showing
   as open work — nobody should be re-filing something already handled, or
   working a task whose deadline turned out to be entered by mistake. */
export function closeLinkedTask(deadlineId){
  const t=DB.tasks.find(x=>x.linkedDeadlineId===deadlineId&&!x.done);
  if(t){ t.done=true; touch(t); }
}

export function newDeadline(presetMid){
  const mid=presetMid||$('#dlMatter').value; if(!mid) return toast('Pick a matter first');
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:580px">
    <div class="mh"><h3>Log a deadline</h3><div class="s">${esc((mById(mid)||{}).name||'')}</div></div>
    <div class="mb"><div class="grid2">
      <div class="full"><label>Rule</label><select class="t" id="dl_rule">${RULES.map(r=>`<option value="${r.k}">${r.t} — ${r.a}</option>`).join('')}</select></div>
      <div><label>Trigger date</label><input type="date" id="dl_from" value="${iso(TODAY)}"></div>
      <div id="dl_trackWrap" style="display:none"><label>Track</label><select class="t" id="dl_track">
        <option value="">n/a</option><option value="I">I — 150 days</option><option value="II">II — 300 days</option>
        <option value="III">III — 450 days</option><option value="IV">IV — 450 days, judge managed</option></select></div>
      <div class="full"><div class="derived" id="dl_calc"></div></div>
      <div><label>Requires filing with the court?</label><select class="t" id="dl_filing">
        <option value="true">Yes — file with the court</option>
        <option value="false">No — service or tracking only</option>
        <option value="confirm">Not sure — confirm before relying on this</option></select></div>
      <div class="full"><label>Notes (optional)</label><input class="t" id="dl_notes" placeholder="e.g. return date, judge, anything case-specific"></div>
    </div></div>
    <div class="mf"><button id="dl_cancel">Cancel</button><button class="primary" id="dl_save">Log it</button></div>
  </div></div>`;
  const rc=()=>{
    const r=RULES.find(x=>x.k===$('#dl_rule').value), from=pd($('#dl_from').value), track=$('#dl_track')?$('#dl_track').value:'';
    $('#dl_trackWrap').style.display=r.track?'':'none';
    if(!from){ $('#dl_calc').innerHTML='<div class="r"><span>Pick a trigger date</span></div>'; return; }
    const due=computeRuleDue(r,from,track);
    $('#dl_calc').innerHTML = due
      ? `<div class="r"><span>Computed due date</span><span class="mono"><strong>${fmt(due)}</strong></span></div>
         <div class="r"><span>Days from today</span><span class="mono">${diff(TODAY,due)}</span></div>`
      : (r.track?'<div class="r"><span>Choose a track</span></div>':'<div class="r"><span>No fixed date — enter manually once known</span></div>');
  };
  /* Filing default only resets when the RULE changes — once the person has
     looked at it and picked an answer (e.g. overriding a 'confirm' rule to
     Yes because they know it applies here), fixing the trigger date or
     track should never silently discard that choice. */
  $('#dl_rule').addEventListener('input',()=>{ $('#dl_filing').value=String(RULES.find(x=>x.k===$('#dl_rule').value).filing); rc(); });
  ['dl_from','dl_track'].forEach(i=>$('#'+i).addEventListener('input',rc));
  $('#dl_filing').value=String(RULES.find(x=>x.k===$('#dl_rule').value).filing);
  rc();
  $('#dl_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  $('#dl_save').onclick=async()=>{
    const r=RULES.find(x=>x.k===$('#dl_rule').value), from=pd($('#dl_from').value), track=$('#dl_track')?$('#dl_track').value:'';
    if(!from) return toast('Pick a trigger date');
    const due=computeRuleDue(r,from,track);
    if(!due) return toast(r.track?'Choose a track':'This rule has no fixed date to compute — log it once the date is known');
    const filingVal=$('#dl_filing').value;
    await logDeadline(mid,r.k,from,filingVal==='true'?true:filingVal==='false'?false:'confirm',$('#dl_notes').value.trim(),track);
    renderAll();$('#modalHost').innerHTML='';toast('Deadline logged');
  };
}

/* The one path that creates a RULE-based tracked deadline — used by the
   manual Log Deadline form above and by the event-driven "What happened?"
   flow below, so a rule's due date, linked filing task, and Calendar push
   are never computed two different ways. (logInternalObligation() below
   is the other, narrower path into DB.deadlines — for a workflow's own
   drafting-stage obligations, which have no NJ rule to cite at all.)
   Caller must already know `due` is computable (the UI forms check first
   so they can show a useful message instead of a silent failure). */
export async function logDeadline(matterId,ruleKey,triggerDate,filing,notes,track){
  if(!triggerDate||isNaN(triggerDate.getTime())) return null; // strict: never compute off a missing/invalid trigger
  const r=RULES.find(x=>x.k===ruleKey); if(!r) return null;
  const due=computeRuleDue(r,triggerDate,track||''); if(!due||isNaN(due.getTime())) return null;
  const mtr=mById(matterId);
  /* GBR internal target: an earlier, non-legal buffer date for a filing
     obligation so staff get nagged before the real deadline, not on it.
     Purely additive — `due` stays the authoritative legal date everywhere
     (Calendar, conflict detection, the Rule reference table); this is
     only ever a second, softer reminder next to it. */
  const internal = filing===true ? iso(subtractBusinessDays(due,3)) : iso(due);
  const covNote=(r.special==='years'||r.special==='months')?'':holidayCoverageNote(due);
  const notesOut=(notes||'')+(covNote?` ⚠ ${covNote}`:'');
  const d=touch({id:uid(),matterId,ruleKey:r.k,title:r.t,authority:r.a,
    trigger:iso(triggerDate),due:iso(due),filing,notes:notesOut,status:'Open',
    action: filing===true?'FILE + SERVE':filing==='confirm'?'CONFIRM REQUIRED':'TRACK',
    workProduct:r.t, owner:(mtr&&mtr.owner)||WHO, supervisor:filing===true?'CJG':'',
    gbrInternalDate:internal});
  DB.deadlines.push(d);
  let task=null;
  if(d.filing===true){
    task=touch({id:uid(),title:`File: ${r.t} — ${(mById(matterId)||{}).name||''}`,
      owner:(mById(matterId)||{}).owner||WHO,due:iso(due),matterId,done:false,linkedDeadlineId:d.id});
    DB.tasks.push(task);
  }
  /* Corrected 10/1/2026: a storage failure here used to be invisible to
     the caller — save() showed its own toast, but this still returned the
     new record as if persisted, so a workflow would go on to announce
     "Deadline logged" and sync it to Calendar even though it only ever
     existed in memory and would vanish on reload. Roll back the in-memory
     push and report failure instead. */
  if(!await save()){
    DB.deadlines=DB.deadlines.filter(x=>x.id!==d.id);
    if(task) DB.tasks=DB.tasks.filter(x=>x.id!==task.id);
    return null;
  }
  SyncFS.scheduleSync();
  if(GCal.status.state==='connected') GCal.syncDeadline(d);
  return d;
}

/* ══════════ WORKFLOW TEMPLATES ══════════
   A workflow is a bundle of obligations generated from one event, not a
   second rules engine: "Motion practice" below still computes every date
   through the exact same RULES/computeRuleDue/logDeadline path as a
   single manually-logged deadline. The only new thing a workflow adds is
   a drafting-stage obligation ahead of the real filing deadline, logged
   via this helper rather than logDeadline() because drafting isn't
   itself an NJ rule — it has no authority to cite, so it's tracked as an
   internal-only obligation (filing:false, no linked Calendar prefix
   implying a court filing) sitting in the same ledger as everything else. */
/* linkedDeadlineId (optional) ties a drafting/follow-up obligation to the
   real deadline it's ahead of, so closeLinkedObligation() below can
   resolve the draft automatically once the real deadline is done,
   confirmed, mooted, or superseded — corrected 10/1/2026; these used to
   carry no parent reference at all, so finishing the real deadline left
   its drafting obligation sitting open forever. */
export async function logInternalObligation(matterId,title,dueDate,notes,linkedDeadlineId){
  if(!dueDate||isNaN(dueDate.getTime())) return null; // strict: reject a missing/invalid computed due date
  const mtr=mById(matterId);
  const d=touch({id:uid(),matterId,ruleKey:null,title,authority:'Internal — GBR workflow step',
    trigger:'',due:iso(dueDate),filing:false,notes:notes||'',status:'Open',
    action:'DRAFT',workProduct:title,owner:(mtr&&mtr.owner)||WHO,supervisor:'',
    gbrInternalDate:iso(dueDate),linkedDeadlineId:linkedDeadlineId||null});
  DB.deadlines.push(d);
  if(!await save()){ DB.deadlines=DB.deadlines.filter(x=>x.id!==d.id); return null; }
  SyncFS.scheduleSync();
  if(GCal.status.state==='connected') GCal.syncDeadline(d);
  return d;
}

/* The internal-obligation counterpart to closeLinkedTask() — resolves a
   drafting/follow-up obligation automatically once the real deadline it
   was logged ahead of reaches a terminal state, instead of leaving it
   open with nothing left to draft toward. */
export function closeLinkedObligation(deadlineId){
  const ob=DB.deadlines.find(x=>x.linkedDeadlineId===deadlineId&&!isDeadlineDone(x));
  if(ob){ ob.status='Done'; touch(ob); }
}

/* Trial workflow: call this wherever a matter's trial date just became
   real (not merely proposed) — the Phase-1 accept flow AND a direct
   manual edit in the matter editor both count, since both are legitimate,
   normal ways a trial date gets set in this app. R. 4:58-1's Offer of
   Judgment deadline counts backward from that date, so it only ever
   bundles off a date someone actually confirmed, not a pending proposal.
   Only creates one if the matter doesn't already have an open OJ deadline
   — a later trial-date correction does not auto-update an existing one,
   since silently rewriting an obligation someone may already be acting
   on is exactly the risk this whole project exists to avoid. Surfaces a
   toast on failure instead of silently doing nothing, same as every
   sibling workflow bundle. */
/* Corrected 10/1/2026: this used to bail out whenever ANY open OJ
   deadline existed for the matter, without checking whether its trigger
   still matched the current trial date — so advancing or postponing a
   confirmed trial left a stale, now-wrong OJ deadline sitting on the
   ledger with no warning, and clearing the trial date did nothing at all
   (callers only invoked this `if(m.trial)`). Now: an unmatched existing
   OJ deadline is never overwritten or silently left stale — it's flagged
   with a supersedeProposal that a human must accept or dismiss (see
   acceptDeadlineSupersede/dismissDeadlineSupersede below), mirroring how
   proposeDateChanges/acceptDateChange handle a matter's own fields. Call
   this on every save (trial set, changed, or cleared), not just when
   m.trial is truthy. */
export async function maybeLogOJForTrial(matterId,trialDateIso){
  const ojRule=RULES.find(x=>x.k==='oj');
  const existing=DB.deadlines.find(x=>x.matterId===matterId&&x.ruleKey==='oj'&&!isDeadlineDone(x));
  const td=trialDateIso?pd(trialDateIso):null;
  if(trialDateIso && !td){
    toast('Trial date saved, but it could not be parsed to log or review the Offer of Judgment deadline — handle it manually from Deadlines');
    return;
  }
  if(!existing){
    if(!td) return; // no trial date, no existing OJ obligation — nothing to do
    const dl=await logDeadline(matterId,'oj',td,ojRule.filing,`Auto-logged when trial date was set to ${fmt(td)}`);
    if(!dl) toast('Trial date saved, but the Offer of Judgment deadline could not be computed — log it manually from Deadlines');
    return;
  }
  if(td && existing.trigger===iso(td)){
    /* The trial date reverted back to match this deadline's own trigger
       (an undo, a correction) after having been flagged as changed. Any
       pending proposal is now stale against the WRONG intermediate trial
       date — clear it rather than leave a reviewer to accept a supersede
       that would compute off a trial date nobody is using anymore. */
    if(existing.supersedeProposal){
      existing.supersedeHistory=existing.supersedeHistory||[];
      existing.supersedeHistory.push({action:'auto-cleared',at:new Date().toISOString(),
        note:`Trial date reverted to ${fmt(td)}, matching this deadline's own trigger again`});
      delete existing.supersedeProposal;
      touch(existing); await save(); SyncFS.scheduleSync();
    }
    return;
  }
  existing.supersedeProposal={newTrial:trialDateIso||'',
    reason:td?`Trial date changed to ${fmt(td)}`:'Trial date was cleared',at:new Date().toISOString()};
  touch(existing);
  await save();SyncFS.scheduleSync();
  toast('The trial date changed — an existing Offer of Judgment deadline needs review in the Deadlines ledger');
}

export function pendingSupersedeCard(d){
  const p=d.supersedeProposal;
  const newTd=p.newTrial?pd(p.newTrial):null;
  return `<div class="warn" style="margin-bottom:10px" data-psc="${d.id}">
    <strong>⚠ Dependent deadline needs review — ${esc(d.title)}</strong>
    <div style="margin-top:6px">
      <div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0"><span>Reason</span><span class="mono">${esc(p.reason)}</span></div>
      <div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0"><span>Currently logged against</span><span class="mono">${d.trigger?fmt(pd(d.trigger)):'(none)'}</span></div>
      <div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0"><span>${newTd?'Replace with a deadline computed from':'No trial date — would close as'}</span><span class="mono"><strong>${newTd?fmt(newTd):'Moot'}</strong></span></div>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="sm" data-psc-keep="${d.id}">Keep As Is</button>
      <button class="sm primary" data-psc-accept="${d.id}">${newTd?'Supersede With New Deadline':'Close As Moot'}</button>
    </div></div>`;
}

export async function acceptDeadlineSupersede(deadlineId){
  const d=DB.deadlines.find(x=>x.id===deadlineId); if(!d||!d.supersedeProposal) return;
  const p=d.supersedeProposal, newTd=p.newTrial?pd(p.newTrial):null;
  d.supersedeHistory=d.supersedeHistory||[];
  if(newTd){
    const ojRule=RULES.find(x=>x.k===d.ruleKey)||RULES.find(x=>x.k==='oj');
    const nd=await logDeadline(d.matterId,d.ruleKey,newTd,ojRule.filing,
      `Supersedes an earlier ${d.title} deadline after the trial date changed to ${fmt(newTd)}`);
    if(!nd){ toast('Could not compute the replacement deadline — the old one is left open for manual review'); return; }
    d.supersedeHistory.push({action:'accepted',supersededBy:nd.id,at:new Date().toISOString()});
    d.status='Superseded';
  } else {
    d.mootReason={by:WHO,reason:'Trial date was cleared — this deadline no longer applies',at:new Date().toISOString()};
    d.supersedeHistory.push({action:'accepted-cleared',at:new Date().toISOString()});
    d.status='Moot';
  }
  delete d.supersedeProposal;
  touch(d);
  if(GCal.status.state==='connected') await GCal.deleteEventOn(d);
  closeLinkedTask(d.id); closeLinkedObligation(d.id);
  await save();SyncFS.scheduleSync();renderAll();
  toast(newTd?'Replaced with an updated deadline':'Closed — no trial date, so this deadline no longer applies');
}

export async function dismissDeadlineSupersede(deadlineId){
  const d=DB.deadlines.find(x=>x.id===deadlineId); if(!d||!d.supersedeProposal) return;
  d.supersedeHistory=d.supersedeHistory||[];
  d.supersedeHistory.push({action:'rejected',at:new Date().toISOString(),note:d.supersedeProposal.reason});
  delete d.supersedeProposal;
  touch(d);
  await save();SyncFS.scheduleSync();renderAll();
  toast('Kept as is — it will be flagged again if the trial date changes further');
}

/* Jumps to Letters with the matter and the new notice type pre-selected,
   drafts it against this one deadline, and drops it in the approval queue
   — same path a human would take by hand, just pre-filled. */
export function draftDeadlineNotice(deadlineId){
  const d=DB.deadlines.find(x=>x.id===deadlineId); if(!d) return;
  const m=mById(d.matterId); if(!m) return toast('Matter not found');
  $$('#tabs button').forEach(x=>x.classList.toggle('on',x.dataset.p==='letters'));
  $$('.panel').forEach(p=>p.classList.toggle('on',p.id==='p-letters'));
  window.scrollTo({top:0});
  fillMatterSelect('#ltrMatter',false); $('#ltrMatter').value=m.id;
  $('#ltrType').innerHTML=LETTERS.map(l=>`<option value="${l.k}">${l.t}</option>`).join(''); $('#ltrType').value='deadlinenotice';
  const text=buildLetter('deadlinenotice',m,{deadlineId:d.id});
  $('#ltrOut').innerHTML=letterhead(text);
  DB.letters.push(touch({id:uid(),matterId:m.id,type:'Internal notice — upcoming court deadline(s)',by:WHO,
    date:iso(TODAY),status:'Pending',text,raw:false}));
  save().then(()=>{SyncFS.scheduleSync();renderLetters();toast('Drafted — sitting in the approval queue');});
}

/* Single place that actually creates a discovery-ledger entry — used by
   the manual Log Discovery form above and by the event-driven "What
   happened?" flow below. */
/* floorServedIso is optional: only meaningful for a DISC_TYPE with
   floorDays set (currently just Notice to produce, R. 4:18-1(b)(2)'s
   50-day floor from service of the summons and complaint on that
   defendant, when that's a different date than the notice itself). */
export async function logDiscoveryItem(matterId,discType,servedIso,direction,manualDueIso,floorServedIso){
  const served=pd(servedIso);
  if(!served) return null; // strict trigger: a blank/invalid service date must never fall back to the epoch
  let due;
  if(discType.manual){
    if(!pd(manualDueIso)) return null; // manual due date must itself be a real calendar date, not just non-empty
    due=manualDueIso;
  } else {
    due=iso(roll(add(served,discType.d)));
    if(discType.floorDays && floorServedIso){
      const floorServed=pd(floorServedIso);
      if(!floorServed) return null; // entered but unparseable — reject rather than silently ignoring the floor
      const floorDue=iso(roll(add(floorServed,discType.floorDays)));
      if(floorDue>due) due=floorDue; // a floor is a minimum, not a substitute — take whichever is later
    }
  }
  const x=touch({id:uid(),matterId,item:discType.t,authority:discType.a,direction,
    served:iso(served),dueDate:due,status:'Outstanding',
    ...(discType.floorDays&&floorServedIso?{floorServed:iso(pd(floorServedIso)),floorAuthority:discType.floorAuthority}:{})});
  DB.discovery.push(x);
  // Same save-failure rollback as logDeadline/logInternalObligation — a
  // storage failure here must not be reported as a successfully logged item.
  if(!await save()){ DB.discovery=DB.discovery.filter(i=>i.id!==x.id); return null; }
  SyncFS.scheduleSync();
  if(GCal.status.state==='connected') GCal.syncDiscoveryItem(x);
  return x;
}

export function openWhatHappened(presetMid){
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:640px">
    <div class="mh"><h3>What happened?</h3><div class="s">Pick a matter, then what happened on it. The right rule runs underneath — you never have to pick it.</div></div>
    <div class="mb">
      <div class="full" style="margin-bottom:14px"><label>Matter</label><select class="t" id="wh_matter"></select></div>
      <div class="grid2" id="wh_tiles">${WHAT_HAPPENED_EVENTS.map(e=>
        `<button class="sm" data-wh="${e.k}" style="text-align:left;padding:10px 12px;height:auto">
          <strong style="display:block">${esc(e.t)}</strong><span class="meta">${esc(e.h)}</span></button>`).join('')}</div>
    </div>
    <div class="mf"><button id="wh_cancel">Cancel</button></div>
  </div></div>`;
  fillMatterSelect('#wh_matter',true);
  if(presetMid) $('#wh_matter').value=presetMid; // Back, from an event sub-form — don't make them re-find the matter
  $('#wh_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  $$('[data-wh]').forEach(b=>b.onclick=()=>{
    const mid=$('#wh_matter').value; if(!mid) return toast('Pick a matter first');
    openWhatHappenedEvent(b.dataset.wh,mid);
  });
}

/* One sub-form per event, each asking only what that event needs, each
   ending by calling the same logging functions the rule-driven forms use. */
export function openWhatHappenedEvent(key,mid){
  const m=mById(mid); if(!m) return toast('Matter not found');
  const back=()=>openWhatHappened(mid);
  const shell=(title,body,onSave)=>{
    $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:560px">
      <div class="mh"><h3>${esc(title)}</h3><div class="s">${esc(m.name)}</div></div>
      <div class="mb">${body}</div>
      <div class="mf"><button id="wh_back">Back</button><span class="sp"></span><button class="primary" id="wh_save">Log it</button></div>
    </div></div>`;
    $('#wh_back').onclick=back;
    $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
    $('#wh_save').onclick=onSave;
  };
  const dateFieldPlain=(id,label)=>`<div class="full"><label>${esc(label)}</label><input type="date" id="${id}" value="${iso(TODAY)}"></div>`;
  const dateField=(id,label)=>dateFieldPlain(id,label)+`<div class="full"><div class="derived" id="${id}_calc"></div></div>`;
  const closeDone=(msg)=>{ renderAll(); $('#modalHost').innerHTML=''; toast(msg); };

  if(key==='complaint_served'){
    /* Complaint/Answer workflow: the service date generates both the real
       Answer deadline and an internal drafting target ahead of it, same
       bundling pattern as Motion Practice. */
    shell('Complaint served',dateField('wh_d','Date of service'),async()=>{
      const d=pd($('#wh_d').value); if(!d) return toast('Pick the service date');
      const r=RULES.find(x=>x.k==='answer');
      const dl=await logDeadline(mid,'answer',d,r.filing,`Reported via What Happened — complaint served ${fmt(d)}`);
      if(!dl) return toast('Could not compute a due date — use the Deadlines calculator directly');
      const draftBy=subtractBusinessDays(pd(dl.due),3);
      await logInternalObligation(mid,'Draft answer',draftBy,`Ahead of ${r.t} (${r.a}), due ${fmt(pd(dl.due))}`,dl.id);
      closeDone(`Answer deadline logged (due ${fmt(pd(dl.due))}) with a drafting target (${fmt(draftBy)})`);
    });
    const rc=()=>{ const d=pd($('#wh_d').value); const r=RULES.find(x=>x.k==='answer'); const due=d&&computeRuleDue(r,d,'');
      $('#wh_d_calc').innerHTML=due?`<div class="r"><span>Answer due (${esc(r.a)})</span><span class="mono"><strong>${fmt(due)}</strong></span></div>`
        +`<div class="r"><span>Drafting target (internal, 3 business days ahead)</span><span class="mono">${fmt(subtractBusinessDays(due,3))}</span></div>`:''; };
    $('#wh_d').addEventListener('input',rc); rc();
    return;
  }
  if(key==='motion_received'||key==='motion_filed'){
    /* Ordinary-motion and summary-judgment timing are NOT the same rule
       (sjopp is -10 days, motopp is -8) — this app's one rule table has no
       separate SJ reply row, so "filed" uses motreply either way, same as
       picking the rule by hand would; "received" must still ask, since
       sjopp vs motopp is a real two-day difference a rule-free shortcut
       cannot silently guess. Cross-motions stay on "Other" (the manual
       rule picker) — which side owes what, and by when, is genuinely
       ambiguous here and not worth guessing at. */
    const ruleKey=key==='motion_received'?{ordinary:'motopp',sj:'sjopp'}:{ordinary:'motreply',sj:'motreply'};
    const label=key==='motion_received'?'our opposition':'our reply';
    const draftLabel=key==='motion_received'?'Draft opposition to motion':'Draft motion papers';
    /* Motion practice workflow: one input (return date) generates the
       drafting obligation AND the real filing deadline, instead of
       someone having to separately remember to also give themselves lead
       time to draft. The filing deadline is computed exactly as it was
       before this release — the workflow only adds the drafting step
       ahead of it. */
    shell(key==='motion_received'?'Motion received':'Motion filed',
      `<div class="full"><label>What kind of motion?</label><select class="t" id="wh_kind">
         <option value="ordinary">Ordinary motion</option><option value="sj">Summary judgment</option></select></div>`
      +dateField('wh_d','Return date'),async()=>{
      const d=pd($('#wh_d').value); if(!d) return toast('Pick the return date');
      const r=RULES.find(x=>x.k===ruleKey[$('#wh_kind').value]);
      const dl=await logDeadline(mid,r.k,d,r.filing,`Reported via What Happened — ${key==='motion_received'?'motion received':'motion filed'}, return date ${fmt(d)}`);
      if(!dl) return toast('Could not compute a due date for that rule — use the Deadlines calculator directly');
      const draftBy=subtractBusinessDays(pd(dl.due),3);
      await logInternalObligation(mid,draftLabel,draftBy,`Ahead of ${r.t} (${r.a}), due ${fmt(pd(dl.due))}`,dl.id);
      closeDone(`Logged ${r.t} (due ${fmt(pd(dl.due))}) and a drafting target (${fmt(draftBy)})`);
    });
    const rc=()=>{ const d=pd($('#wh_d').value); const r=RULES.find(x=>x.k===ruleKey[$('#wh_kind').value]); const due=d&&computeRuleDue(r,d,'');
      $('#wh_d_calc').innerHTML=due?`<div class="r"><span>Due date for ${label} (${esc(r.a)})</span><span class="mono"><strong>${fmt(due)}</strong></span></div>`
        +`<div class="r"><span>Drafting target (internal, 3 business days ahead)</span><span class="mono">${fmt(subtractBusinessDays(due,3))}</span></div>`:''; };
    ['wh_kind','wh_d'].forEach(i=>$('#'+i).addEventListener('input',rc)); rc();
    return;
  }
  if(key==='discovery_received'){
    shell('Discovery received',
      `<div class="full"><label>What was it?</label><select class="t" id="wh_type">${DISC_TYPES.map(t=>`<option value="${t.t}">${t.t} — ${t.manual?'no fixed period':t.d+' days'} · ${t.a}</option>`).join('')}</select></div>
       <div class="full"><label>Date served on us</label><input type="date" id="wh_d" value="${iso(TODAY)}"></div>
       <div class="full" id="wh_floorWrap" style="display:none"></div>
       <div class="full"><div class="derived" id="wh_d_calc"></div></div>`,
      async()=>{
        const t=DISC_TYPES.find(x=>x.t===$('#wh_type').value);
        if(!pd($('#wh_d').value)) return toast('Pick a valid service date');
        const manualDue=t.manual?$('#wh_manual')?.value:'';
        if(t.manual&&!pd(manualDue)) return toast('Enter the due date shown on the document');
        const floorServed=t.floorDays?$('#wh_floor')?.value:'';
        const x=await logDiscoveryItem(mid,t,$('#wh_d').value,'Received from adversary',manualDue,floorServed);
        if(!x) return toast('Could not log that item — check the date(s) entered');
        /* Discovery-response workflow: same bundling as Motion Practice and
           Complaint/Answer — an internal drafting target ahead of the real
           response deadline, not just the deadline itself. */
        const draftBy=subtractBusinessDays(pd(x.dueDate),3);
        await logInternalObligation(mid,`Draft responses — ${t.t}`,draftBy,`Ahead of ${t.t} (${t.a}), due ${fmt(pd(x.dueDate))}`,x.id);
        closeDone(`Logged to the discovery ledger (due ${fmt(pd(x.dueDate))}) with a drafting target (${fmt(draftBy)})`);
      });
    const rc=()=>{
      const t=DISC_TYPES.find(x=>x.t===$('#wh_type').value), s=pd($('#wh_d').value);
      $('#wh_floorWrap').style.display=t.floorDays?'':'none';
      if(t.floorDays && !$('#wh_floor')){
        $('#wh_floorWrap').innerHTML=`<label>${esc(t.floorLabel)}</label><input type="date" id="wh_floor">`;
        $('#wh_floor').addEventListener('input',rc);
      }
      if(t.manual){ $('#wh_d_calc').innerHTML=`<div class="r"><span>Due date</span><span class="mono"><input type="date" id="wh_manual" class="t"></span></div>
        <p class="note" style="margin-top:6px">No NJ rule sets a fixed period for this — enter the date printed on the document, or the date demanded/agreed.</p>`; return; }
      if(!s){ $('#wh_d_calc').innerHTML=''; return; }
      let due=roll(add(s,t.d)), rows=`<div class="r"><span>Response due (${esc(t.a)})</span><span class="mono">${fmt(due)}</span></div>`;
      if(t.floorDays){
        const fs=pd($('#wh_floor')?.value);
        if(fs){
          const floorDue=roll(add(fs,t.floorDays));
          rows+=`<div class="r"><span>${t.floorDays}-day floor (${esc(t.floorAuthority)})</span><span class="mono">${fmt(floorDue)}</span></div>`;
          if(floorDue>due) due=floorDue;
        }
      }
      rows+=`<div class="r"><span>Controlling due date</span><span class="mono"><strong>${fmt(due)}</strong></span></div>`;
      $('#wh_d_calc').innerHTML=rows;
    };
    ['wh_type','wh_d'].forEach(i=>$('#'+i).addEventListener('input',rc)); rc();
    return;
  }
  if(key==='discovery_deficiency'){
    /* The firm's own "Discovery deficiency letter" template (Letters tab)
       gives the adversary twenty (20) days to cure before we move to
       compel under R. 4:23-5 — this just tracks that cure period so it
       doesn't get forgotten. No drafting-obligation bundle: the letter
       itself is the output of that other tab, not something this
       workflow drafts. */
    shell('Discovery deficiency letter sent',dateField('wh_d','Date the letter was sent'),async()=>{
      const d=pd($('#wh_d').value); if(!d) return toast('Pick the date the letter was sent');
      /* Keyed to the letter's own sent date, not just the matter, so a
         second deficiency letter (e.g. a later round covering a different
         discovery set) gets its own cure-check instead of being silently
         dropped while an earlier one is still open. */
      const title=`Discovery deficiency cure check (sent ${fmt(d)})`;
      if(DB.deadlines.some(x=>x.matterId===mid&&x.ruleKey===null&&x.title===title&&!isDeadlineDone(x)))
        return toast('A cure check for a letter sent on this date already exists for this matter');
      const due=roll(add(d,20));
      await logInternalObligation(mid,title,due,`Deficiency letter sent ${fmt(d)} — 20 days to cure before a motion to compel under R. 4:23-5 becomes the next step`);
      closeDone(`Cure-check reminder logged for ${fmt(due)}`);
    });
    const rc=()=>{ const d=pd($('#wh_d').value); const due=d&&roll(add(d,20));
      $('#wh_d_calc').innerHTML=due?`<div class="r"><span>Cure period ends (20 days)</span><span class="mono"><strong>${fmt(due)}</strong></span></div>`:''; };
    $('#wh_d').addEventListener('input',rc); rc();
    return;
  }
  if(key==='discovery_extended'||key==='arbitration_scheduled'||key==='trial_scheduled'){
    const cfg={discovery_extended:{label:'New discovery end date',xKey:'discoveryEndDate',docType:'order extending discovery'},
      arbitration_scheduled:{label:'Arbitration date',xKey:'arbitrationDate',docType:'arbitration notice'},
      trial_scheduled:{label:'Trial date',xKey:'trialDate',docType:'trial notice'}}[key];
    shell(WHAT_HAPPENED_EVENTS.find(e=>e.k===key).t,dateFieldPlain('wh_d',cfg.label),async()=>{
      const d=pd($('#wh_d').value); if(!d) return toast('Pick a date');
      const x={documentType:cfg.docType}; x[cfg.xKey]=iso(d);
      const n=proposeDateChanges(m,x,'Reported via What Happened');
      touch(m); await save(); SyncFS.scheduleSync();
      $('#modalHost').innerHTML=''; renderAll();
      if(n) openMatter(m);
      toast(n?'Proposed — review and accept in the matter':'Matches what’s already on file — nothing to change');
    });
    return;
  }
  if(key==='arbitration_award'){
    /* Deciding whether to request a trial de novo (and filing if so) isn't
       a drafting task the way an answer or opposition is — no internal
       obligation bundle here, just the real R. 4:21A-6(b)(1) deadline. */
    shell('Arbitration award entered',dateField('wh_d','Date award was filed'),async()=>{
      const d=pd($('#wh_d').value); if(!d) return toast('Pick the date the award was filed');
      if(DB.deadlines.some(x=>x.matterId===mid&&x.ruleKey==='denovo'&&!isDeadlineDone(x)))
        return toast('An open trial de novo deadline already exists for this matter — close it as Moot in the Deadlines ledger first if this date needs correcting');
      const r=RULES.find(x=>x.k==='denovo');
      const dl=await logDeadline(mid,'denovo',d,r.filing,`Reported via What Happened — arbitration award filed ${fmt(d)}`);
      if(!dl) return toast('Could not compute a due date — use the Deadlines calculator directly');
      closeDone(`Trial de novo deadline logged (due ${fmt(pd(dl.due))})`);
    });
    const rc=()=>{ const d=pd($('#wh_d').value); const r=RULES.find(x=>x.k==='denovo'); const due=d&&computeRuleDue(r,d,'');
      $('#wh_d_calc').innerHTML=due?`<div class="r"><span>Trial de novo deadline (${esc(r.a)})</span><span class="mono"><strong>${fmt(due)}</strong></span></div>`:''; };
    $('#wh_d').addEventListener('input',rc); rc();
    return;
  }
  if(key==='ime_scheduled'){
    /* m.ime stays free text (it's always allowed a status like "scheduled"
       with no firm date yet, per the Matters editor) — the actual date
       field here is only ever used to compute the follow-up obligation,
       and is optional for exactly that reason. */
    shell('IME scheduled',
      `<div class="full"><label>IME date or status</label><input class="t" id="wh_ime" value="${esc(m.ime||'')}" placeholder="date or scheduled"></div>
       <div class="full"><label>Actual IME date (optional — for a report follow-up reminder)</label><input type="date" id="wh_d"></div>
       <div class="full"><div class="derived" id="wh_d_calc"></div></div>`,
      async()=>{
        m.ime=$('#wh_ime').value.trim(); touch(m); await save(); SyncFS.scheduleSync();
        const imeDate=pd($('#wh_d').value);
        if(imeDate){
          /* Corrected 10/1/2026: dedup used to be keyed on a fixed title
             with no date, so a second examination (a different specialist,
             a re-exam) couldn't get its own follow-up reminder while the
             first was still open — same class of bug already fixed for
             deposition_scheduled and discovery_deficiency below/above. */
          const title=`Follow up on IME report (examined ${fmt(imeDate)})`;
          if(DB.deadlines.some(x=>x.matterId===mid&&x.ruleKey===null&&x.title===title&&!isDeadlineDone(x)))
            return closeDone('IME updated — a report follow-up reminder for this exact exam date is already open');
          const followUp=add(imeDate,14);
          await logInternalObligation(mid,title,followUp,`IME held ${fmt(imeDate)} — report not yet received as of this reminder`);
          closeDone(`IME updated with a report follow-up on ${fmt(followUp)}`);
        } else closeDone('IME updated');
      });
    const rc=()=>{ const d=pd($('#wh_d').value); const followUp=d&&add(d,14);
      $('#wh_d_calc').innerHTML=followUp?`<div class="r"><span>Report follow-up reminder (14 days)</span><span class="mono"><strong>${fmt(followUp)}</strong></span></div>`:''; };
    $('#wh_d').addEventListener('input',rc); rc();
    return;
  }
  if(key==='deposition_scheduled'){
    /* No NJ Court Rule ties an automatic deadline to scheduling a
       deposition the way R. 4:17/4:18/4:22 do for written discovery —
       this just bundles the one thing every deposition genuinely needs,
       a prep reminder ahead of it, the same lead-time pattern used for
       the other drafting/prep obligations. */
    shell('Deposition scheduled',
      `<div class="full"><label>Whose deposition?</label><input class="t" id="wh_who" placeholder="e.g. Plaintiff, Dr. Smith, our client"></div>`
      +dateField('wh_d','Deposition date'),async()=>{
      const d=pd($('#wh_d').value); if(!d) return toast('Pick the deposition date');
      /* Date is part of the title, not just the witness name, so a
         continued/second-day deposition of the same witness gets its own
         prep reminder instead of being blocked by the first day's still-
         open one — and the comparison is case/whitespace-insensitive so
         "Dr. Smith" vs "dr.  smith" for the same date still dedupes. */
      const who=$('#wh_who').value.trim().replace(/\s+/g,' ');
      const title=`Prepare for deposition — ${who||'TBD'} (${fmt(d)})`;
      if(DB.deadlines.some(x=>x.matterId===mid&&x.ruleKey===null&&x.title&&x.title.toLowerCase()===title.toLowerCase()&&!isDeadlineDone(x)))
        return toast('An open prep reminder already exists for this deposition — close it first if the date needs correcting');
      const prepBy=subtractBusinessDays(d,3);
      await logInternalObligation(mid,title,prepBy,`Deposition date ${fmt(d)}`);
      closeDone(`Prep reminder logged for ${fmt(prepBy)}, ahead of the ${fmt(d)} deposition`);
    });
    const rc=()=>{ const d=pd($('#wh_d').value); const prepBy=d&&subtractBusinessDays(d,3);
      $('#wh_d_calc').innerHTML=prepBy?`<div class="r"><span>Prep target (internal, 3 business days ahead)</span><span class="mono"><strong>${fmt(prepBy)}</strong></span></div>`:''; };
    $('#wh_d').addEventListener('input',rc); rc();
    return;
  }
  if(key==='order_entered'){
    shell('Order entered',
      `<div class="full"><label>What did the order change?</label><select class="t" id="wh_kind">
         <option value="ded">Discovery end date</option><option value="arb">Arbitration date</option>
         <option value="trial">Trial date</option><option value="note">Nothing — just log a note</option></select></div>
       <div class="full" id="wh_dateWrap">${dateFieldPlain('wh_d','New date')}</div>
       <div class="full"><label>Note (optional)</label><input class="t" id="wh_note" placeholder="what the order said"></div>`,
      async()=>{
        const kind=$('#wh_kind').value, note=$('#wh_note').value.trim();
        if(kind==='note'){
          m.notes=(m.notes?m.notes+' ':'')+`[${fmt(TODAY)} Order entered${note?': '+note:''}]`;
          touch(m); await save(); SyncFS.scheduleSync(); closeDone('Noted on the matter'); return;
        }
        const d=pd($('#wh_d').value); if(!d) return toast('Pick the new date');
        const map={ded:{xKey:'discoveryEndDate',docType:'order extending discovery'},
          arb:{xKey:'arbitrationDate',docType:'order'},trial:{xKey:'trialDate',docType:'order'}}[kind];
        const x={documentType:map.docType}; x[map.xKey]=iso(d);
        const n=proposeDateChanges(m,x,`Order entered${note?' — '+note:''}`);
        if(note) m.notes=(m.notes?m.notes+' ':'')+`[${fmt(TODAY)} Order entered: ${note}]`;
        touch(m); await save(); SyncFS.scheduleSync();
        $('#modalHost').innerHTML=''; renderAll();
        if(n) openMatter(m);
        toast(n?'Proposed — review and accept in the matter':'Matches what’s already on file — nothing to change');
      });
    const toggleDate=()=>{ $('#wh_dateWrap').style.display=$('#wh_kind').value==='note'?'none':''; };
    $('#wh_kind').addEventListener('input',toggleDate); toggleDate();
    return;
  }
  if(key==='other'){
    $('#modalHost').innerHTML='';
    $('#tabs').querySelector('[data-p="deadlines"]')?.click();
    newDeadline(mid);
    return;
  }
}

export function letterhead(bodyText){
  const bar=PEOPLE.filter(p=>p.onLH&&!p.counsel);
  const oc =PEOPLE.filter(p=>p.counsel);
  const me =PEOPLE.find(p=>p.i===WHO)||PEOPLE.find(p=>p.i==='CJG');
  return `<div class="lh" id="lhPrint">
    <div class="lh-top">
      <div class="lh-firm">${esc(FIRM.name)}</div>
      <div class="lh-tag">${esc(FIRM.tagline)}</div>
      <div class="lh-addr">${esc(FIRM.street)}<br>${esc(FIRM.city)}</div>
    </div>
    <div class="lh-cols">
      <div class="lh-names">
        ${bar.map(p=>`<div>${esc(p.lh)}<sup>${esc(p.mark)}</sup></div>`).join('')}
        ${oc.length?`<div class="lh-oc">_____</div>
        ${oc.map(p=>`<div>${esc(p.lh)}<sup>${esc(p.mark)}</sup></div>`).join('')}
        <div class="lh-oclabel">OF COUNSEL</div>`:''}
      </div>
      <div class="lh-mid">
        <div>${esc(FIRM.phone)}</div>
        <div>${esc(FIRM.fax)}</div>
      </div>
      <div class="lh-offices">
        ${FIRM.otherOffices.map(o=>`<div class="lh-oname">${esc(o.label)}</div>
          <div>${esc(o.l1)}</div><div>${esc(o.l2)}</div>`).join('')}
        <div class="lh-respond">${esc(FIRM.respond)}</div>
      </div>
    </div>
    <div class="lh-legend">
      ${FIRM.legend.map(l=>`<span><sup>${esc(l.m)}</sup>&nbsp;${esc(l.t)}</span>`).join('')}
    </div>
    <div class="lh-email">Sender&rsquo;s Direct E-mail: ${esc(me&&me.email?me.email:'')}</div>
    <div class="lh-rule"></div>
    <div class="body">${esc(bodyText)}</div>
  </div>`;
}

/* Reproduces AUTHORIZATION FOR RELEASE OF MEDICAL RECORDS PURSUANT TO
   45 CFR 164.508 (HIPAA) - the firm's operative form including the
   reproductive-health line. Text is the firm's own; only the party
   fields are filled from the matter.                                    */
export function hipaaForm(m){
  const items=[
    ['EMERGENCY ROOM RECORD','EEG TRACINGS'],
    ['CONSULTATIONS','NURSES - NOTES'],
    ['HISTORY &amp; PHYSICAL EXAM','PATHOLOGY SLIDES'],
    ['PROGRESS NOTES','PSYCHOTHERAPY NOTES'],
    ['OPERATIVE REPTS &amp; PATHOLOGY','DISCHARGE SUMMARY'],
    ['LAB, X-RAY &amp; TESTS','COMPLETE RECORD'],
    ['X-RAY FILMS','BILLING INFO'],
    ['Other:  MRI Reports and Films','REPRODUCTIVE HEALTH']
  ];
  const fill='<span class="fillin"></span>';
  return `<div class="hipaa">
  <div class="h-title">AUTHORIZATION FOR RELEASE OF MEDICAL<br>RECORDS PURSUANT TO 45 CFR 164.508 (HIPAA)</div>
  <p>PATIENT NAME: ${fill} D.O.B.: ${fill}</p>
  <p>ADDRESS: ${fill}</p>
  <p>I hereby authorize ${fill}</p>
  <p>ADDRESS: ${fill}</p>
  <p>to release my health information to:&nbsp;&nbsp;<strong>Gaul, Baratta &amp; Rosello</strong><br>
     100 Hanover Ave<br>Cedar Knolls, NJ 07927</p>
  <p>The information to be disclosed to and used by the above is for the following purpose: At the request of the individual named above.</p>
  <p>This authorization is limited to all dates of treatment: &nbsp; Patient&rsquo;s DOB - Present</p>
  <p><u>Information to be disclosed:</u></p>
  <table class="h-items">${items.map(r=>`<tr><td>[ X ]&nbsp;&nbsp; ${r[0]}</td><td>[ X ]&nbsp;&nbsp; ${r[1]}</td></tr>`).join('')}</table>
  <p>It is my intent that the use of the information furnished is prohibited for any purpose other than stated above and that the recipient is prohibited from disclosing this information to any other party to whom disclosure is not necessary or required for the purpose stated above. I hereby designate Gaul, Baratta &amp; Rosello, LLC, as authorized representative per N.J.A.C. 13:35-6.5 (a) and (c).</p>
  <p>I understand that the above provider will not condition treatment on whether or not I agree to sign this authorization.</p>
  <p>I understand that I have the right to revoke this authorization at any time. I understand if I revoke this authorization, I must do so in writing and present my written revocation to the Health Information Management Department. I understand that the unauthorized re-disclosure of this information is no longer protected under federal and/or state confidentiality rules. I understand that this revocation will not apply to the extent that you have already taken action in reliance on this authorization. This authorization will automatically expire 180 days from the date of my signature, unless I otherwise specify that this authorization will terminate on the following date, or concurrently with the following event or condition:</p>
  <p>I understand that if my medical records contain information related to the history, diagnosis and/or treatment of any psychiatric problems, mental illness, drug abuse, alcoholism, sexual and reproductive health, touch on care, sexually transmitted or communicable disease, Aids or test for infection of human immunodeficiency virus (HIV), that my signing this document authorizes you to release that information. I acknowledge and am aware that New Jersey has a statutory privilege accorded to the confidential communications between a patient and a licensed physician or psychologist and that my signing this form waives this privilege.</p>
  <p>I understand that I may be subject to criminal penalties pursuant to 42 U.S.C. 1320d-6 if I knowingly and in violation of HIPAA obtain individually identifiable health information relating to an individual or disclose individually identifiable health information to another person.</p>
  <p style="margin-top:26px">PATIENT SIGNATURE: ________________________________________ DATE: ________________________</p>
  <p class="h-note">Note: You are required by 45 CFR 164.524 to permit access, or provide copies of the requested records, within 30 days after receipt of this request.</p>
  <p class="h-matter">${esc(m?m.name:'')}${m&&m.docket?' &nbsp;&middot;&nbsp; Docket No. '+esc(m.docket):''}${m&&m.file?' &nbsp;&middot;&nbsp; Our File No. '+esc(m.file):''}</p>
  </div>`;
}

export function buildLetter(kind,m,opt){
  const d=derive(m), today=fmtLong(TODAY);
  const cap=m.name, dk=m.docket||'[docket]', me=PEOPLE.find(p=>p.i===WHO)||PEOPLE.find(p=>p.i==='CJG');
  const sign=`\n\nVery truly yours,\n\nGAUL, BARATTA & ROSELLO, LLC\n\n\n${me.n}\n`;
  const head=(to,re)=>`${today}\n\n${to}\n\nRe:\t${cap}\n\tDocket No. ${dk}\n\tOur File No. ${m.file}${m.claim?`\n\tClaim No. ${m.claim}`:''}\n\t${re}\n\nDear ${to.split('\n')[0].startsWith('Attn')?'Counsel':'Sir or Madam'}:\n\n`;
  switch(kind){
    case 'carrier': return head(`${m.carrier||'[Carrier]'}\n${m.adjuster?'Attn: '+m.adjuster:'Attn: Claim Representative'}`,'Status Report')
      + `We write to report on the status of the above matter.\n\n`
      + `POSTURE. This matter is in ${m.status.toLowerCase()} posture in ${VENUES[m.venue]||m.venue||'[venue]'} County, Law Division, on Track ${m.track}. `
      + (d.ded?`The discovery end date is ${fmtLong(d.ded)}.`:`No discovery end date has been assigned.`)
      + (pd(m.arbitration)?` Arbitration is scheduled for ${fmtLong(pd(m.arbitration))}.`:'')
      + (pd(m.trial)?` Trial is listed for ${fmtLong(pd(m.trial))}.`:'')
      + `\n\nDISCOVERY. ${m.depo?`Plaintiff's deposition: ${m.depo}. `:'Plaintiff has not yet been deposed. '}`
      + `${m.records?`Medical records are ${m.records.toLowerCase()}. `:''}${m.ime?`IME: ${m.ime}.`:'No Independent Medical Examination has been scheduled to date.'}`
      + (d.file&&d.dFile>=0?`\n\nDISCOVERY EXTENSION. Should an extension become necessary, any motion must be filed and served by ${fmtLong(d.file)} to be returnable ${fmtLong(d.ret)}, which precedes the discovery end date as R. 4:24-1(c) requires.`:'')
      + (d.locked?`\n\nWe note that a ${pd(m.arbitration)?'arbitration':'trial'} date has been fixed. Under R. 4:24-1(c) no further extension of discovery is available absent a showing of exceptional circumstances.`:'')
      + `\n\nEVALUATION. [Liability assessment, damages exposure, and reserve recommendation to be inserted.]\n\nWe will continue to keep you apprised.`+sign;
    case 'hipaa': return head('Attn: Counsel for Plaintiff','HIPAA Authorizations')
      + `Enclosed please find HIPAA-compliant authorizations for execution by your client in connection with the above matter.\n\n`
      + `Kindly have your client execute each authorization and return them within twenty (20) days. The authorizations are limited to the providers identified and to records relevant to the injuries placed in controversy by the pleadings.\n\n`
      + `If your client objects to any authorization, please identify the specific objection in writing so that the issue can be narrowed before motion practice becomes necessary.`+sign;
    case 'records': return head('[Provider name]\n[Provider address]','Request for Medical Records')
      + `This office represents the defendant in the above-captioned matter. Enclosed is a HIPAA-compliant authorization executed by your patient.\n\n`
      + `Please provide complete copies of all records in your possession, including office notes, intake forms, diagnostic imaging and reports, operative reports, physical therapy notes, billing records, and any correspondence relating to treatment.\n\n`
      + `Please advise of any copying charge in advance. Records may be produced electronically to ${(PEOPLE.find(p=>p.i==='CJG')||{}).email||''}.`+sign;
    case 'deficiency': return head('Attn: Counsel for Plaintiff','Discovery Deficiencies')
      + `We write concerning deficiencies in your client's discovery responses in the above matter.\n\n`
      + `[Itemize each deficiency by interrogatory or demand number.]\n\n`
      + `Please provide fully responsive answers within twenty (20) days. If we do not receive them, we will move to compel and, if warranted, for dismissal under R. 4:23-5, together with an application for fees.\n\n`
      + `This letter is written in a good-faith effort to resolve these issues without motion practice pursuant to R. 1:6-2(c).`+sign;
    case 'consent': {
      const cur=d.ded, prop=cur?add(cur,60):null;
      return head('Attn: Counsel of Record','Consent to Extend Discovery — R. 4:24-1(c)')
      + `The discovery end date in this matter is ${cur?fmtLong(cur):'[date]'}. Discovery remains outstanding, and the parties require additional time to complete it.\n\n`
      + `Pursuant to R. 4:24-1(c), the parties may consent to an extension of sixty (60) days without application to the court where no arbitration or trial date has been fixed. `
      + (d.locked?`We note that a date has been fixed in this matter, which may require an application to the court instead.\n\n`:`No arbitration or trial date has been fixed.\n\n`)
      + `We therefore propose extending the discovery end date to ${prop?fmtLong(prop):'[date]'}. Kindly countersign below and return a copy at your earliest convenience.\n\n`
      + `If you do not consent, please advise promptly so that a motion may be filed and made returnable before the discovery period ends, as the Rule requires.\n\n\nCONSENTED AND AGREED:\n\n_______________________________\t\tDated: ______________`+sign; }
    case 'adjourn': return head('Hon. '+(m.judge||'[Judge]')+', J.S.C.\n'+(VENUES[m.venue]||'[County]')+' County Courthouse','Request for Adjournment')
      + `We respectfully request an adjournment of the [proceeding] presently scheduled for [date].\n\n`
      + `The basis for this request is [reason]. [Adversary] has been contacted and [consents / does not consent] to this request. This is the [first] such request.\n\n`
      + `We are available on [proposed dates] and thank the Court for its consideration.`+sign;
    case 'deadlinenotice': {
      /* ruleKey filters out internal workflow obligations (e.g. a drafting
         target from logInternalObligation) — this memo is specifically
         about court deadlines, and mixing in an internal to-do under a
         "FILE WITH COURT" boilerplate would make exactly the kind of
         record this memo exists to get right less reliable, not more. */
      const list=(opt&&opt.deadlineId) ? DB.deadlines.filter(x=>x.id===opt.deadlineId)
        : DB.deadlines.filter(x=>x.matterId===m.id&&!isDeadlineDone(x)&&x.ruleKey).sort((a,b)=>(pd(a.due)||9e15)-(pd(b.due)||9e15));
      if(!list.length) return `${today}\n\nTO:\tFile\nFROM:\t${me.n}\nRE:\t${cap} — Docket No. ${dk} — Our File No. ${m.file}\nSUBJECT:\tUpcoming Court Deadlines\n\nNo open tracked deadlines for this matter as of this date.`+sign;
      const lines=list.map(x=>{const fb=filingBadge(x.filing), due=pd(x.due);
        return `•  ${x.title} (${x.authority}) — due ${fmtLong(due)}${due?` (${diff(TODAY,due)} days)`:''} — ${fb.t}${x.notes?`\n   Note: ${x.notes}`:''}`;}).join('\n\n');
      return `${today}\n\nTO:\tFile\nFROM:\t${me.n}\nRE:\t${cap} — Docket No. ${dk} — Our File No. ${m.file}\nSUBJECT:\tUpcoming Court Deadline${list.length>1?'s':''}\n\n`
        + `The following deadline${list.length>1?'s remain':' remains'} open on this matter:\n\n${lines}\n\n`
        + `Anything marked FILE WITH COURT requires a document actually filed with the court by the date shown, not merely served. Confirm status and close it out in the Deadlines tab once addressed.`+sign;
    }
    default: return head('[Recipient]','Acknowledgment')
      + `We acknowledge receipt of your correspondence of [date] in the above matter.\n\n`
      + `[Substantive response.]\n\nThank you for your courtesy.`+sign;
  }
}

/* A complaint or notice of motion carries its own NJ-rule deadline, but
   logging it as a tracked Deadline (so it syncs to Calendar) is a separate,
   deliberate step — intake only flags the suggestion with the rule already
   applied, it never writes to DB.deadlines on its own. */
export function suggestDeadlineFromExtract(x){
  if(/complaint/i.test(x.documentType||'')&&x.dateOfService){
    const svc=pd(x.dateOfService), r=RULES.find(ru=>ru.k==='answer'), due=svc&&computeRuleDue(r,svc,'');
    if(due) return `ACTION — log in Deadlines tab: ${r.t} (${r.a}), due ${fmt(due)} (served ${fmt(svc)}).`;
  }
  if(/notice of motion/i.test(x.documentType||'')&&x.motionReturnDate){
    const ret=pd(x.motionReturnDate), opp=RULES.find(ru=>ru.k==='motopp'), rep=RULES.find(ru=>ru.k==='motreply');
    if(ret) return `ACTION — log in Deadlines tab: ${opp.t} due ${fmt(computeRuleDue(opp,ret,''))}; `
      +`${rep.t} due ${fmt(computeRuleDue(rep,ret,''))} (return date ${fmt(ret)}).`;
  }
  return null;
}

export function proposeDateChanges(existing,x,source){
  const isOrder=/order|extend/i.test(x.documentType||'');
  existing.pendingDateChanges=existing.pendingDateChanges||[];
  let added=0;
  DATE_PROPOSAL_FIELDS.forEach(c=>{
    const extracted=x[c.extractKey]; if(!extracted) return;
    if(c.onlyFromOrder&&!isOrder) return;
    const current=existing[c.field]||'';
    if(current===extracted) return; // Confirmed — matches what's already on file, nothing to propose
    existing.pendingDateChanges=existing.pendingDateChanges.filter(p=>p.field!==c.field); // superseded by this newer read
    existing.pendingDateChanges.push({id:uid(),field:c.field,label:c.label,current,proposed:extracted,source,
      confidence:(x.uncertain||[]).includes(c.extractKey)?'Review':'High',at:new Date().toISOString()});
    added++;
  });
  return added;
}

export function pendingChangeCard(p){
  const row=(a,b)=>`<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0">${a}${b}</div>`;
  return `<div class="warn" style="margin-bottom:10px" data-pdc="${p.id}">
    <strong>⚠ Proposed Date Change — ${esc(p.label)}</strong>
    <div style="margin-top:6px">
      ${row('<span>Current</span>',`<span class="mono">${p.current?fmt(pd(p.current)):'(none on file)'}</span>`)}
      ${row('<span>PDF detected</span>',`<span class="mono"><strong>${fmt(pd(p.proposed))}</strong></span>`)}
      ${row('<span>Source</span>',`<span class="mono">${esc(p.source)}</span>`)}
      ${row('<span>Confidence</span>',`<span class="mono">${esc(p.confidence)}</span>`)}
    </div>
    <div class="row" style="margin-top:8px">
      <button class="sm" data-pdc-keep="${p.id}">Keep Current</button>
      <button class="sm primary" data-pdc-accept="${p.id}">Accept New Date</button>
      <button class="sm" data-pdc-review="${p.id}" title="Leaves this pending — the app doesn't retain the source document to show you, by design (see Confidentiality in the README)">Decide Later</button>
    </div></div>`;
}

export function dateHistoryBlock(m){
  if(!m.dateHistory||!m.dateHistory.length) return '';
  const rows=m.dateHistory.slice().sort((a,b)=>(b.at||'').localeCompare(a.at||''));
  return `<div class="card" style="margin-top:12px"><h3>Date history</h3>${rows.map(h=>{
    const body = h.kind==='kept'
      ? `<strong>${esc(h.label)} — proposal declined, kept as is</strong><br>Proposed ${fmt(pd(h.proposed))}, kept <strong>${h.from?fmt(pd(h.from)):'(none)'}</strong>`
      : h.kind==='stale'
      ? `<strong>${esc(h.label)} — proposal dropped as stale</strong><br>Proposed ${fmt(pd(h.proposed))} against ${h.from?fmt(pd(h.from)):'(none)'}, but the field had already changed by the time this was reviewed`
      : `<strong>${esc(h.label)} changed</strong><br>${h.from?fmt(pd(h.from)):'(none)'} → <strong>${fmt(pd(h.to))}</strong>`;
    return `<div style="padding:6px 0;border-bottom:1px solid var(--rule2);font-size:12.5px">${body}
      <div class="meta">${new Date(h.at).toLocaleString()} · ${esc(h.by)} · ${esc(h.source)}</div></div>`;
  }).join('')}</div>`;
}

/* Mutation + the actual history entry happen here — nowhere else should
   ever write existing.currentDED/arbitration/trial directly from an
   intake read. */
export async function acceptDateChange(m,proposalId){
  const p=m.pendingDateChanges.find(x=>x.id===proposalId); if(!p) return;
  const from=m[p.field]||'';
  /* The proposal is a snapshot of what the field looked like when the PDF
     was read. If something else changed that same field since then (a
     manual correction, another accepted proposal, a sync from a
     teammate), applying the stale snapshot would overwrite a newer value
     — the exact silent-overwrite bug this release exists to fix, just
     reached through the "safe" path instead of the old direct-mutation
     one. Refuse and drop the stale card rather than guess. */
  if(from!==p.current){
    m.pendingDateChanges=m.pendingDateChanges.filter(x=>x.id!==proposalId);
    m.dateHistory=m.dateHistory||[];
    m.dateHistory.push({field:p.field,label:p.label,kind:'stale',from,proposed:p.proposed,
      at:new Date().toISOString(),by:WHO,source:p.source});
    touch(m); await save(); SyncFS.scheduleSync(); renderAll(); openMatter(m);
    toast(`${p.label} changed since this was proposed — re-run intake on the document if the new date still needs logging`);
    return;
  }
  if(p.field==='currentDED'&&!m.originalDED) m.originalDED=from||'';
  m[p.field]=p.proposed;
  m.dateHistory=m.dateHistory||[];
  m.dateHistory.push({field:p.field,label:p.label,from,to:p.proposed,at:new Date().toISOString(),by:WHO,source:p.source});
  m.pendingDateChanges=m.pendingDateChanges.filter(x=>x.id!==proposalId);
  /* Field-level timestamp, separate from the whole-record _updatedAt —
     lets a shared-folder merge tell that THIS field changed just now even
     if another copy's whole record has a later _updatedAt from an edit to
     some unrelated field (e.g. notes). See mergeMatterRecord() in store.js. */
  m.fieldUpdatedAt=m.fieldUpdatedAt||{};
  m.fieldUpdatedAt[p.field]=new Date().toISOString();
  /* Runs BEFORE the renderAll() below, so the OJ deadline (if any gets
     created) is already in DB.deadlines by the time the Deadlines tab
     and Dashboard re-render — otherwise it stays invisible until some
     unrelated later action happens to re-render those panels. */
  if(p.field==='trial') await maybeLogOJForTrial(m.id,p.proposed);
  touch(m); await save(); SyncFS.scheduleSync(); renderAll();
  if(GCal.status.state==='connected') GCal.syncMatter(m);
  openMatter(m); toast('Date accepted');
}

export async function keepCurrentDate(m,proposalId){
  const p=m.pendingDateChanges.find(x=>x.id===proposalId); if(!p) return;
  m.pendingDateChanges=m.pendingDateChanges.filter(x=>x.id!==proposalId);
  /* Corrected 10/1/2026: this used to delete the proposal with no record
     of the decision — re-reading the same document would just propose it
     again with no way to tell a reviewer had already looked at and
     declined it once. Now the decision itself is retained in dateHistory,
     same as an accepted change, just tagged kind:'kept' instead of a
     from->to change (see dateHistoryBlock). */
  m.dateHistory=m.dateHistory||[];
  m.dateHistory.push({field:p.field,label:p.label,kind:'kept',from:m[p.field]||'',proposed:p.proposed,
    at:new Date().toISOString(),by:WHO,source:p.source});
  touch(m); await save(); SyncFS.scheduleSync(); renderAll();
  openMatter(m); toast('Kept the existing date — nothing changed');
}

/* "Decide Later" — not "Review PDF": the source document is never kept
   past extraction (see the Confidentiality section of the README), so
   there is nothing on file to show. This just defers the decision; go
   look at the actual document outside the app, then come back. */
export function reviewPendingDate(){
  toast("Left pending — nothing changed. The source document isn't stored here; check it where it actually lives, then come back to Keep or Accept.");
}
