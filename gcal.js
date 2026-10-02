"use strict";
import {CONFIG, GCAL_CALENDAR_ID, GCAL_CLIENT_ID} from './config.js';
import {add, fmt, iso, pd} from './dates.js';
import {isLive, toast} from './util.js';
import {DB, SyncFS, mById, save, touch} from './store.js';
import {isDeadlineDone} from './workflows.js';
import {derive, renderGcalStatus} from './app.js';

/* ══════════ GOOGLE CALENDAR SYNC ══════════
   Optional and off by default. Fill in GCAL_CLIENT_ID and GCAL_CALENDAR_ID
   below (see README for the one-time Google Cloud setup) to turn it on —
   until both are set, this whole feature stays inert and hidden. Once
   connected, a matter's calendar-worthy dates push automatically to a
   shared Google Calendar the moment a document read or manual edit is
   saved — see the e_save handler. matterCalItems() above (also used by
   the .ics export) is the single source of truth for which dates those
   are, so this and the .ics export can never show something different.
   Each matter keeps the Google event id it was given per date (m.gcal),
   so a re-sync updates that same event instead of creating a duplicate —
   including when a different signed-in person triggers the next sync,
   since m.gcal travels with the matter through the shared-folder sync
   like any other field. */
export const GCal={
  supported: !!(GCAL_CLIENT_ID && GCAL_CALENDAR_ID),
  token:null, tokenClient:null, email:'',
  status:{state:'off',error:''}, // off | connecting | connected | error

  init(){
    if(!this.supported) return;
    this._loadGis(()=>{
      this.tokenClient=google.accounts.oauth2.initTokenClient({
        client_id:GCAL_CLIENT_ID,
        scope:'https://www.googleapis.com/auth/calendar.events',
        callback:(resp)=>{
          if(resp.error){ this.status={state:'error',error:String(resp.error)}; renderGcalStatus(); return; }
          this.token=resp.access_token; this.status={state:'connected',error:''};
          this._fetchEmail(); renderGcalStatus();
          this.drainPendingDeletes(); // retry anything queued while disconnected or mid-error
        }
      });
      renderGcalStatus();
    });
  },
  _loadGis(cb){
    if(window.google&&google.accounts&&google.accounts.oauth2){ cb(); return; }
    const s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client'; s.async=true;
    s.onload=cb; s.onerror=()=>{ this.status={state:'error',error:"Could not load Google's sign-in library."}; renderGcalStatus(); };
    document.head.appendChild(s);
  },
  connect(){
    if(!this.supported) return toast("Google Calendar isn't set up for this app yet.");
    this.status.state='connecting'; renderGcalStatus();
    if(this.tokenClient) this.tokenClient.requestAccessToken({prompt:'consent'});
    else this.init();
  },
  disconnect(){
    if(this.token&&window.google&&google.accounts) google.accounts.oauth2.revoke(this.token,()=>{});
    this.token=null; this.email=''; this.status={state:'off',error:''};
    renderGcalStatus(); toast('Disconnected from Google Calendar');
  },
  async _fetchEmail(){
    try{
      const r=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+this.token}});
      if(r.ok){ const j=await r.json(); this.email=j.email||''; renderGcalStatus(); }
    }catch(e){}
  },
  async _api(path,opts){
    opts=opts||{};
    const res=await fetch('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(GCAL_CALENDAR_ID)+path,
      Object.assign({},opts,{headers:Object.assign({Authorization:'Bearer '+this.token,'Content-Type':'application/json'},opts.headers||{})}));
    if(res.status===401){ this.token=null; this.status={state:'off',error:''}; renderGcalStatus();
      throw new Error('Google sign-in expired — reconnect in Settings.'); }
    if(!res.ok){ let d=''; try{d=(await res.json()).error.message}catch(e){} throw new Error('Google Calendar error '+res.status+(d?': '+d:'')); }
    if(res.status===204) return null;
    return res.json();
  },
  async upsertEvent(m,it){
    const body={summary:it.summary,description:it.description,
      start:{date:iso(it.date)},end:{date:iso(add(it.date,1))},
      reminders:{useDefault:false,overrides:it.reminders||reminderLadder(it.filing)}};
    m.gcal=m.gcal||{};
    const existingId=m.gcal[it.key];
    if(existingId){
      try{ await this._api('/events/'+encodeURIComponent(existingId),{method:'PATCH',body:JSON.stringify(body)}); return; }
      catch(e){ /* event may have been removed on the calendar directly — fall through and recreate it */ }
    }
    const created=await this._api('/events',{method:'POST',body:JSON.stringify(body)});
    if(created&&created.id) m.gcal[it.key]=created.id;
  },
  /* Corrected 10/1/2026 (found by a live-Calendar staging check, not a
     unit test): this never queued anything, and its only caller
     (syncMatter) bailed out entirely while disconnected — the same bug
     class deleteEventOn's call sites had before the round-2 fix below,
     just never applied here. A trial/DED/arbitration date cleared or
     changed while disconnected left a stale, WRONG event sitting on the
     shared calendar with no durable retry: reconnecting alone did
     nothing for it (drainPendingDeletes only knew about deleteEventOn's
     queue), and only an explicit "Push All" — which recomputes every
     matter's items regardless of what changed — happened to clean it up.
     Now mirrors deleteEventOn exactly: queue unconditionally, attempt
     the live call only if connected, keep m.gcal[key] intact on failure
     so a retry (or an upsert that would otherwise wrongly recreate it)
     has the real state to work from. */
  async deleteEvent(m,key){
    if(!m.gcal||!m.gcal[key]) return;
    const eventId=m.gcal[key];
    this.queueDelete(eventId);
    if(this.status.state!=='connected') return; // queued; drainPendingDeletes() will retry once reconnected
    try{ await this._api('/events/'+encodeURIComponent(eventId),{method:'DELETE'}); }
    catch(e){ if(!this.isAlreadyGoneError(e)) return; } // left queued (and m.gcal[key] intact) for retry
    delete m.gcal[key];
    this.dequeueDelete(eventId);
  },
  /* Generalized pair for records that carry their OWN gcalEventId (tracked
     deadlines, discovery items, records-chase follow-ups) rather than the
     matter-level `m.gcal{key:id}` map above, which only fits the five fixed
     matter fields. Same upsert/delete shape, different id storage. */
  async upsertEventOn(rec,it){
    const body={summary:it.summary,description:it.description,
      start:{date:iso(it.date)},end:{date:iso(add(it.date,1))},
      reminders:{useDefault:false,overrides:it.reminders||reminderLadder(it.filing)}};
    if(rec.gcalEventId){
      try{ await this._api('/events/'+encodeURIComponent(rec.gcalEventId),{method:'PATCH',body:JSON.stringify(body)}); return; }
      catch(e){ /* removed on the calendar directly — recreate below */ }
    }
    const created=await this._api('/events',{method:'POST',body:JSON.stringify(body)});
    if(created&&created.id) rec.gcalEventId=created.id;
  },
  /* Corrected 10/1/2026 (round 2): keeping rec.gcalEventId on a failed
     delete only helps if the SAME record is still around to retry it on.
     Once that record is itself deleted from the DB (the normal next step
     after closing an obligation), the only surviving reference to the
     undeleted Calendar event went with it — permanently orphaning it.
     DB.pendingGcalDeletes is a durable queue, independent of any one
     record, that survives exactly that. It's also populated even when
     not currently connected, so a deletion that happens while signed out
     still gets retried once reconnected instead of never being attempted
     at all (every deleteEventOn call site used to gate the call itself
     behind `if connected`, skipping it — and the queue — entirely). */
  queueDelete(eventId){
    DB.pendingGcalDeletes=DB.pendingGcalDeletes||[];
    if(!DB.pendingGcalDeletes.some(p=>p.eventId===eventId))
      DB.pendingGcalDeletes.push({eventId,at:new Date().toISOString()});
  },
  dequeueDelete(eventId){
    if(DB.pendingGcalDeletes) DB.pendingGcalDeletes=DB.pendingGcalDeletes.filter(p=>p.eventId!==eventId);
  },
  /* Corrected 10/1/2026 (round 3): Google returns 404 for an unknown event
     id, but 410 Gone for one that already existed and was already deleted
     — which is exactly what happens on a second deletion attempt for the
     same event (e.g. drainPendingDeletes succeeded once already but the
     still-live record's own gcalEventId was never cleared — see
     _forgetEventId below). Treating only 404 as "already gone" left a
     410 stuck in the queue forever, retried on every Push All/reconnect
     with no way to ever clear. */
  isAlreadyGoneError(e){ return /\b(404|410)\b/.test(String(e&&e.message)); },
  /* Clears a stale gcalEventId from any STILL-LIVE record that references
     an event the queue just confirmed is gone from the calendar — without
     this, a record whose deletion was queued while offline (or failed)
     keeps re-queuing and re-attempting a delete for an event that no
     longer exists every time something else touches that same record. */
  _forgetEventId(eventId){
    for(const coll of [DB.deadlines,DB.discovery,DB.records])
      for(const r of coll) if(r.gcalEventId===eventId) delete r.gcalEventId;
    for(const m of DB.matters) if(m.gcal)
      for(const k of Object.keys(m.gcal)) if(m.gcal[k]===eventId) delete m.gcal[k];
  },
  async deleteEventOn(rec){
    if(!rec.gcalEventId) return;
    const eventId=rec.gcalEventId;
    this.queueDelete(eventId);
    if(this.status.state!=='connected') return; // queued; drainPendingDeletes() will retry once reconnected
    try{ await this._api('/events/'+encodeURIComponent(eventId),{method:'DELETE'}); }
    catch(e){ if(!this.isAlreadyGoneError(e)) return; } // left queued (and rec.gcalEventId intact) for retry
    delete rec.gcalEventId;
    this.dequeueDelete(eventId);
  },
  async syncMatter(m){
    /* Corrected 10/1/2026: the staleness check (a key no longer in
       matterCalItems(m) means its date was cleared or the matter went
       non-live) now runs regardless of connection state, so a deletion
       gets queued immediately instead of only being discovered the next
       time someone happens to be connected when this matter is saved or
       edited again. The live upsert (create/update) still requires an
       actual connection — there's nothing to push without one. */
    const items=matterCalItems(m), keys=new Set(items.map(i=>i.key));
    if(m.gcal) for(const k of Object.keys(m.gcal)) if(!keys.has(k)) await this.deleteEvent(m,k);
    if(this.status.state!=='connected'){ await save(); return; } // persists the queued deletion above
    try{
      for(const it of items) await this.upsertEvent(m,it);
      touch(m); await save(); SyncFS.scheduleSync();
    }catch(e){ toast('Google Calendar: '+e.message); }
  },
  async syncDeadline(d){
    if(this.status.state!=='connected') return;
    try{
      if(isDeadlineDone(d)){ await this.deleteEventOn(d); touch(d); await save(); SyncFS.scheduleSync(); return; }
      const m=mById(d.matterId); const due=pd(d.due); if(!m||!due) return;
      const prefix=d.filing===true?'FILE WITH COURT':d.filing==='confirm'?'CONFIRM FILING REQ.':'DEADLINE';
      await this.upsertEventOn(d,{date:due,filing:d.filing,
        summary:`${m.owner}: ${m.name} - ${prefix}: ${d.title} - ${m.venue||''}`,
        description:`${d.authority}. Trigger ${fmt(pd(d.trigger))}.${d.notes?' '+d.notes:''}`});
      /* Corrected 10/1/2026: only re-checked array membership (deleted
         while the create was in flight) — missed the much more common
         case of the record staying in the array but reaching a terminal
         STATUS (e.g. filing confirmed) during that same window, which
         left its just-created event stranded on the Calendar. */
      if(!DB.deadlines.includes(d)||isDeadlineDone(d)){ await this.deleteEventOn(d); return; }
      touch(d); await save(); SyncFS.scheduleSync();
    }catch(e){ toast('Google Calendar: '+e.message); }
  },
  async syncDiscoveryItem(x){
    if(this.status.state!=='connected') return;
    try{
      if(x.status==='Complete'){ await this.deleteEventOn(x); touch(x); await save(); SyncFS.scheduleSync(); return; }
      const m=mById(x.matterId); const due=pd(x.dueDate); if(!m||!due) return;
      await this.upsertEventOn(x,{date:due,filing:false,
        summary:`${m.owner}: ${m.name} - ${x.item.toUpperCase()} DUE - ${m.venue||''}`,
        description:`${x.direction}. Served ${fmt(pd(x.served))}. ${x.authority}.`});
      if(!DB.discovery.includes(x)||x.status==='Complete'){ await this.deleteEventOn(x); return; } // deleted/completed while the create was in flight
      touch(x); await save(); SyncFS.scheduleSync();
    }catch(e){ toast('Google Calendar: '+e.message); }
  },
  async syncRecordItem(r){
    if(this.status.state!=='connected') return;
    try{
      if(r.status==='Received'){ await this.deleteEventOn(r); touch(r); await save(); SyncFS.scheduleSync(); return; }
      const m=mById(r.matterId); const due=pd(r.nextFollowUp); if(!m||!due) return;
      await this.upsertEventOn(r,{date:due,filing:false,
        summary:`${m.owner}: ${m.name} - RECORDS FOLLOW-UP ${r.provider} - ${m.venue||''}`,
        description:`Stage ${r.stage}. Requested ${fmt(pd(r.requested))}.`});
      if(!DB.records.includes(r)||r.status==='Received'){ await this.deleteEventOn(r); return; } // deleted/received while the create was in flight
      touch(r); await save(); SyncFS.scheduleSync();
    }catch(e){ toast('Google Calendar: '+e.message); }
  },
  /* Drains DB.pendingGcalDeletes — Calendar deletions that failed, or were
     never attempted because this browser wasn't connected at the time.
     Independent of DB.deadlines/discovery/records, so it still finds and
     retries a deletion for an event whose original record has since been
     removed entirely (see deleteEventOn above). Called from Push All and
     right after a successful (re)connect. */
  async drainPendingDeletes(){
    if(this.status.state!=='connected'||!DB.pendingGcalDeletes||!DB.pendingGcalDeletes.length) return;
    const queue=DB.pendingGcalDeletes.slice();
    for(const p of queue){
      try{ await this._api('/events/'+encodeURIComponent(p.eventId),{method:'DELETE'}); this._forgetEventId(p.eventId); this.dequeueDelete(p.eventId); }
      catch(e){ if(this.isAlreadyGoneError(e)){ this._forgetEventId(p.eventId); this.dequeueDelete(p.eventId); } } // else leave queued for the next drain
    }
    await save();
  },
  async syncAllMatters(){
    if(this.status.state!=='connected') return toast('Connect Google Calendar first.');
    await this.drainPendingDeletes();
    const live=DB.matters.filter(isLive);
    const openDeadlines=DB.deadlines.filter(d=>!isDeadlineDone(d));
    const openDisc=DB.discovery.filter(x=>x.status!=='Complete'&&x.dueDate);
    const openRec=DB.records.filter(r=>r.status!=='Received'&&r.nextFollowUp);
    const total=live.length+openDeadlines.length+openDisc.length+openRec.length;
    toast('Pushing '+total+' calendar items…');
    for(const m of live) await this.syncMatter(m);
    for(const d of openDeadlines) await this.syncDeadline(d);
    for(const x of openDisc) await this.syncDiscoveryItem(x);
    for(const r of openRec) await this.syncRecordItem(r);
    toast('Done — pushed '+total+' items.');
  }
};

/* Calendar reminder ladder — a filing deadline gets escalating follow-up
   popups, not just a single warning, since missing it is the thing this
   whole feature exists to prevent. Non-filing tracked items get a lighter
   touch. Shared by every GCal upsert so the ladder stays one definition.
   28 days, not 30: Google Calendar rejects reminders.overrides[].minutes
   above 40320 (its documented 4-week cap) — 30 days (43200) would silently
   fail the API call for every single filing deadline, the one category
   this feature most needs to land on the Calendar. */
export function reminderLadder(filing){
  const p=CONFIG.reminderProfiles;
  const days = filing===true ? p.filing : filing==='confirm' ? p.confirm : p.standard;
  return days.map(n=>({method:'popup',minutes:n*24*60}));
}

/* Single source of truth for a matter's calendar-worthy dates — shared by
   the .ics export below and by GCal.syncMatter() so the two never drift
   apart. `key` is a stable per-matter-per-date-kind id used by GCal to
   know which Google event to update rather than duplicate. */
export function matterCalItems(m){
  const d=derive(m), init=m.owner||'CJG', v=m.venue||'';
  const items=[];
  if(d.file) items.push({key:'file',date:d.file,filing:true,
    summary:`${init}: ${m.name} - FILE WITH COURT: MOTION TO EXTEND DISCOVERY (ret ${fmt(d.ret)}) - ${v}`,
    description:`DED ${fmt(d.ded)}. Return ${fmt(d.ret)}. R. 1:6-3(a) requires filing and service 16 days before the return date. R. 4:24-1(c) requires the motion be returnable before the discovery period ends.`
      +(d.locked?' CAUTION: a date is already fixed - exceptional circumstances standard applies.':'')
      +` Confirm the return date against the ${v} motion calendar.`});
  if(d.ded) items.push({key:'ded',date:d.ded,filing:false,summary:`${init}: ${m.name} - DED - ${v}`,description:`Discovery end date. Docket ${m.docket}. File ${m.file}.`});
  const a=pd(m.arbitration); if(a) items.push({key:'arbitration',date:a,filing:false,summary:`${init}: ${m.name} - ARBITRATION - ${v}`,description:`Docket ${m.docket}.`});
  const t=pd(m.trial); if(t) items.push({key:'trial',date:t,filing:false,summary:`${init}: ${m.name} - TRIAL - ${v}`,description:`Docket ${m.docket}.`});
  const s=pd(m.sol); if(s) items.push({key:'sol',date:s,filing:true,summary:`${init}: ${m.name} - FILE WITH COURT: COMPLAINT MUST BE FILED (STATUTE OF LIMITATIONS) - ${v}`,description:`Plaintiff matter. File ${m.file}.`});
  return items;
}
