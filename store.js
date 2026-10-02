"use strict";
import {DATE_PROPOSAL_FIELDS} from './config.js';
import {iso, sod} from './dates.js';
import {$, esc, isLive, norm, toast} from './util.js';
import {renderAll, renderSyncStatus} from './app.js';
import {maybeLogOJForTrial} from './workflows.js';

export const K_DATA='gbr-ops-v1', K_KEY='gbr-ops-key', K_WHO='gbr-ops-who';

/* `deleted` holds tombstones {id, at} per collection so a sync merge never
   resurrects something someone deleted — see mergeDB() below. */
export let DB={matters:[],discovery:[],records:[],tasks:[],letters:[],deadlines:[],log:[],
  deleted:{matters:[],discovery:[],records:[],tasks:[],letters:[],deadlines:[]},
  pendingGcalDeletes:[]};

export let APIKEY='', WHO='CJG';

/* Corrected 10/1/2026: TODAY used to be a const fixed at page load, so a
   browser tab left open overnight kept computing "days from today" and
   defaulting new date fields against yesterday's date indefinitely.
   refreshTodayIfStale() (wired to a periodic check and tab-refocus in
   app.js) catches the rollover; TODAY itself is still only ever changed
   here, never reassigned from another module. */
export let TODAY=sod(new Date());
export function refreshTodayIfStale(){
  const now=sod(new Date());
  if(iso(now)===iso(TODAY)) return false;
  TODAY=now;
  return true;
}

/* ══════════ SEED ROSTER ══════════
   Intentionally empty in the version distributed firm-wide. Real matter
   data must never live in this file or in git — it loads only into each
   person's own browser, by hand or via Settings → Open handoff file.
   See matters/README.md and matter-ops/README.md for the handoff workflow. */
export function seed(){
 return [];
}

export function uid(){return 'x'+Math.random().toString(36).slice(2,10);}

/* Sync bookkeeping: every record gets a real timestamp (not the day-only
   `lastActivity` field used for the stale-file display) so a folder sync
   can tell whose copy of a record is newer. Deleting a record leaves a
   tombstone instead of just vanishing, so a sync doesn't bring it back. */
export function touch(rec){ rec._updatedAt=new Date().toISOString(); return rec; }

export function tomb(coll,id){ (DB.deleted[coll]=DB.deleted[coll]||[]).push({id,at:new Date().toISOString()}); }

/* Whole-record last-write-wins merge, keyed by docket for matters (so two
   machines that each added "the same" new matter before ever syncing
   converge onto one record) and by id for everything else. Tombstones are
   unioned so a delete on one machine sticks even if a stale copy of the
   same record arrives later from a machine that hadn't synced yet. Used by
   both the manual handoff-file import and the automatic folder sync, so
   the two behave identically. */
export const MERGE_COLLS=['matters','discovery','records','tasks','letters','deadlines'];

export function mergeKey(coll,rec){ return coll==='matters' ? (norm(rec.docket)||rec.file||rec.id) : rec.id; }

/* Corrected 10/1/2026: when two matters collapse onto one record (same
   docket, two different ids — e.g. two people each created "the same"
   matter before ever syncing), the loser's id used to just vanish with no
   record of where its data went. field-level merge below also prevents a
   later, unrelated-field edit (notes) on a stale copy from silently
   reverting a material date another copy already had accepted — see
   fieldUpdatedAt, written by acceptDateChange() and the matter editor's
   manual-edit path, which is more trustworthy for THIS PURPOSE than the
   whole record's _updatedAt. */
function mergeMatterRecord(cur,rec){
  const newer=((rec._updatedAt||'')>(cur._updatedAt||''))?rec:cur;
  const merged=Object.assign({},newer,{id:cur.id});
  const dhSeen=new Set(), dh=[];
  [...(cur.dateHistory||[]),...(rec.dateHistory||[])].forEach(h=>{
    const key=[h.field,h.kind||'',h.from,h.to,h.proposed,h.at].join('|');
    if(dhSeen.has(key)) return; dhSeen.add(key); dh.push(h);
  });
  merged.dateHistory=dh;
  /* Corrected 10/1/2026: a proposal one copy already resolved (accepted,
     kept, dropped as stale, or rejected as an invalid date) used to come
     right back as "pending" the moment a stale copy that never saw that
     resolution got merged in — keepCurrentDate()'s local removal, dropped
     with nothing else checking for it on the other side. Every resolution
     path now tags its dateHistory entry with the original proposal's id
     (see acceptDateChange/keepCurrentDate), so any proposal already
     resolved on EITHER side is excluded here regardless of which copy
     still happens to be carrying it as pending. */
  const resolvedProposalIds=new Set(dh.filter(h=>h.proposalId).map(h=>h.proposalId));
  const pdcMap=new Map();
  [...(cur.pendingDateChanges||[]),...(rec.pendingDateChanges||[])].forEach(p=>{
    if(resolvedProposalIds.has(p.id)) return;
    pdcMap.set(p.id,p);
  });
  merged.pendingDateChanges=[...pdcMap.values()];
  /* Built field-by-field below, never via a blind Object.assign of the two
     fieldUpdatedAt maps — that would let whichever side happens to be
     `rec` win a field's timestamp outright even when `cur`'s is newer,
     the moment the two sides agree on the field's current VALUE (the
     per-field comparison below is only reached when values differ, so an
     agreeing-value field's timestamp has to be resolved here instead). */
  merged.fieldUpdatedAt={};
  DATE_PROPOSAL_FIELDS.forEach(c=>{
    const aV=cur[c.field]||'', bV=rec[c.field]||'';
    const aT=(cur.fieldUpdatedAt&&cur.fieldUpdatedAt[c.field])||'';
    const bT=(rec.fieldUpdatedAt&&rec.fieldUpdatedAt[c.field])||'';
    if(aV===bV){
      // Same value either way — still keep the more recent of the two
      // known field-timestamps (if either exists) so a later three-way
      // merge can't mistake an older copy's coincidentally-matching value
      // for the authoritative one.
      if(aT||bT) merged.fieldUpdatedAt[c.field]=bT>aT?bT:aT;
      return;
    }
    if(aT||bT){
      // At least one copy knows exactly when IT last changed this field —
      // trust that over the whole-record timestamp, which an edit to some
      // unrelated field (notes) could otherwise win on by accident.
      const bWins=bT>aT;
      merged[c.field]=bWins?bV:aV;
      merged.fieldUpdatedAt[c.field]=bWins?bT:aT;
      return;
    }
    // Neither copy ever recorded a field-level timestamp (pre-migration
    // data) — don't guess which value is right; flag it for review
    // instead of letting the whole-record merge pick one silently.
    if(!merged.pendingDateChanges.some(p=>p.field===c.field)){
      merged.pendingDateChanges.push({id:uid(),field:c.field,label:c.label,
        current:merged[c.field]||'',proposed:merged[c.field]===aV?bV:aV,
        source:'Shared-folder merge — two copies disagreed on this field and neither recorded when it changed',
        confidence:'Review',at:new Date().toISOString()});
    }
  });
  return merged;
}

export function mergeDB(local,incoming){
  const TOMB_TTL_DAYS=400, cutoff=new Date(Date.now()-TOMB_TTL_DAYS*864e5).toISOString();
  const out={matters:[],discovery:[],records:[],tasks:[],letters:[],deadlines:[],log:local.log||[],
    deleted:{matters:[],discovery:[],records:[],tasks:[],letters:[],deadlines:[]}};
  const matterIdRemap=new Map(); // oldId -> survivingId, built while merging 'matters' (which runs first)
  MERGE_COLLS.forEach(coll=>{
    const delMap=new Map();
    [...((local.deleted&&local.deleted[coll])||[]),...((incoming.deleted&&incoming.deleted[coll])||[])]
      .forEach(t=>{ const cur=delMap.get(t.id); if(!cur||t.at>cur) delMap.set(t.id,t.at); });
    const byKey=new Map();
    const consider=rec=>{
      if(coll!=='matters' && rec.matterId && matterIdRemap.has(rec.matterId))
        rec=Object.assign({},rec,{matterId:matterIdRemap.get(rec.matterId)});
      const k=mergeKey(coll,rec), cur=byKey.get(k);
      if(!cur){ byKey.set(k,rec); return; }
      if(coll==='matters'){
        if(rec.id!==cur.id) matterIdRemap.set(rec.id,cur.id);
        byKey.set(k,mergeMatterRecord(cur,rec));
      } else if((rec._updatedAt||'')>(cur._updatedAt||'')){
        byKey.set(k,Object.assign({},rec,{id:cur.id}));
      }
    };
    (local[coll]||[]).forEach(consider);
    (incoming[coll]||[]).forEach(consider);
    byKey.forEach(rec=>{
      const delAt=delMap.get(rec.id);
      if(delAt && delAt>=(rec._updatedAt||'')) return; // still deleted
      out[coll].push(rec);
    });
    out.deleted[coll]=[...delMap.entries()].map(([id,at])=>({id,at})).filter(t=>t.at>=cutoff);
  });
  return out;
}

/* ══════════ STORAGE ══════════ */
export const Store={
 async get(k){ if(window.storage){try{const r=await window.storage.get(k);return r?r.value:null}catch(e){}}
   try{return localStorage.getItem(k)}catch(e){return null} },
 async set(k,v){ if(window.storage){try{await window.storage.set(k,v);return true}catch(e){}}
   try{localStorage.setItem(k,v);return true}catch(e){return false} }
};

/* ══════════ SHARED FOLDER SYNC ══════════
   Optional: connect a folder (e.g. on the firm's S: drive) and this browser
   keeps one JSON file there in sync with matters/discovery/records/tasks/
   letters — on every local change (debounced) and on a slow poll, so you
   also pick up other people's edits without touching anything. Chrome/Edge
   only (File System Access API). Always merges via mergeDB() above rather
   than overwriting, so it can't silently clobber a newer edit or bring
   back something someone deleted — and it's always best-effort: a slow or
   disconnected drive never blocks local saving, it just retries later. */
export const SYNC_FILE='gbr-ops-sync.json';

export const IDB={
  _db:null,
  open(){ if(this._db) return Promise.resolve(this._db);
    return new Promise((res,rej)=>{
      const rq=indexedDB.open('gbr-ops-fs',1);
      rq.onupgradeneeded=()=>rq.result.createObjectStore('kv');
      rq.onsuccess=()=>{ this._db=rq.result; res(this._db); };
      rq.onerror=()=>rej(rq.error);
    });
  },
  async get(k){ const db=await this.open(); return new Promise((res,rej)=>{
    const tx=db.transaction('kv','readonly'), rq=tx.objectStore('kv').get(k);
    rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error);
  });},
  async set(k,v){ const db=await this.open(); return new Promise((res,rej)=>{
    const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(v,k);
    tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error);
  });},
  async del(k){ const db=await this.open(); return new Promise((res,rej)=>{
    const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').delete(k);
    tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error);
  });}
};

export const SyncFS={
  supported: typeof window.showDirectoryPicker==='function',
  handle:null,
  status:{state:'off',name:'',lastSyncedAt:null,error:''}, // off | needs-permission | syncing | synced | error
  _debounce:null, _timer:null,

  async init(){
    if(!this.supported) return;
    let h; try{ h=await IDB.get('dir'); }catch(e){ return; }
    if(!h) return;
    this.handle=h; this.status.name=h.name;
    try{
      const perm=await h.queryPermission({mode:'readwrite'});
      if(perm==='granted'){ await this.sync(); this._startTimer(); }
      else{ this.status.state='needs-permission'; renderSyncStatus(); }
    }catch(e){ this.status.state='needs-permission'; renderSyncStatus(); }
  },
  async connect(){
    if(!this.supported) return toast('Folder sync needs Chrome or Edge.');
    let h; try{ h=await window.showDirectoryPicker({mode:'readwrite'}); }
    catch(e){ return; } // user cancelled the picker
    this.handle=h; this.status.name=h.name;
    await IDB.set('dir',h);
    await this.sync();
    this._startTimer();
  },
  async resume(){
    if(!this.handle) return this.connect();
    try{
      const perm=await this.handle.requestPermission({mode:'readwrite'});
      if(perm!=='granted'){ this.status.state='needs-permission'; renderSyncStatus(); return; }
      await this.sync(); this._startTimer();
    }catch(e){ this.status.state='error'; this.status.error=String((e&&e.message)||e); renderSyncStatus(); }
  },
  async disconnect(){
    this._stopTimer();
    this.handle=null; this.status={state:'off',name:'',lastSyncedAt:null,error:''};
    try{ await IDB.del('dir'); }catch(e){}
    renderSyncStatus();
    toast('Disconnected — this browser stops syncing to that folder (the file itself is untouched)');
  },
  scheduleSync(){
    if(!this.handle || this.status.state==='needs-permission') return;
    clearTimeout(this._debounce);
    this._debounce=setTimeout(()=>this.sync(),900);
  },
  _startTimer(){ this._stopTimer(); this._timer=setInterval(()=>this.sync(),120000); },
  _stopTimer(){ if(this._timer) clearInterval(this._timer); this._timer=null; },
  async sync(){
    if(!this.handle) return;
    try{
      const perm=await this.handle.queryPermission({mode:'readwrite'});
      if(perm!=='granted'){ this.status.state='needs-permission'; renderSyncStatus(); return; }
      this.status.state='syncing'; renderSyncStatus();
      const fh=await this.handle.getFileHandle(SYNC_FILE,{create:true});
      const text=await (await fh.getFile()).text();
      let incoming={matters:[],discovery:[],records:[],tasks:[],letters:[],deadlines:[],deleted:{}};
      if(text.trim()){ try{ incoming=JSON.parse(text).db||incoming; }catch(e){} }
      const merged=mergeDB(DB,incoming);
      DB.matters=merged.matters; DB.discovery=merged.discovery; DB.records=merged.records;
      DB.tasks=merged.tasks; DB.letters=merged.letters; DB.deadlines=merged.deadlines; DB.deleted=merged.deleted;
      await save();
      const w=await fh.createWritable();
      await w.write(JSON.stringify({app:'GBR Matter Ops',saved:new Date().toISOString(),db:merged},null,2));
      await w.close();
      /* Corrected 10/1/2026: a trial date arriving through this merge (from
         a teammate's copy) used to just sit there — any Offer of Judgment
         deadline logged against the OLD trial, or a review card already
         flagged against some earlier intermediate value, stayed stale
         until someone happened to re-save the matter by hand.
         maybeLogOJForTrial() already no-ops cheaply when nothing is
         actually mismatched, so running it for every matter here is safe. */
      for(const m of DB.matters) await maybeLogOJForTrial(m.id,m.trial);
      this.status={state:'synced',name:this.handle.name,lastSyncedAt:new Date(),error:''};
      renderAll();
    }catch(e){
      this.status.state='error'; this.status.error=String((e&&e.message)||e);
    }
    renderSyncStatus();
  }
};

export function normalizeDeleted(){
  DB.deleted=DB.deleted||{};
  MERGE_COLLS.forEach(c=>{ DB.deleted[c]=DB.deleted[c]||[]; });
}

/* Corrected 10/1/2026: used to return nothing, so even the highest-stakes
   callers (logging a new legal deadline or drafting obligation) had no
   way to tell a persistence failure from success — they'd show their own
   "Logged"/"Saved" toast right after this one's failure toast, announcing
   success for a record that never actually made it to storage. Now
   returns the result so a caller that cares can check it. */
export async function save(){ const ok=await Store.set(K_DATA,JSON.stringify(DB));
  if(!ok) toast('Could not save in this browser — use Save handoff file');
  return ok; }

/* These four exist only because ES modules can't let another module
   reassign DB/APIKEY/WHO directly (an imported binding can be mutated in
   place but not rebound) — every place that used to write `DB=...`,
   `APIKEY=...`, or `WHO=...` from outside this file now calls one of
   these instead. Behavior is unchanged from the single-file version. */
export async function loadDB(){
  const raw=await Store.get(K_DATA);
  if(raw){ try{ DB=Object.assign(DB,JSON.parse(raw)); }catch(e){} }
  if(!DB.matters) DB.matters=seed();
  normalizeDeleted();
}
export async function loadSettings(){
  APIKEY=(await Store.get(K_KEY))||'';
  WHO=(await Store.get(K_WHO))||'CJG';
}
export function setWho(v){ WHO=v; }
export function setApiKey(v){ APIKEY=v; }
export function resetDB(){
  // pendingGcalDeletes deliberately survives a wipe: those are real
  // Calendar events that still need to actually be deleted, independent
  // of whatever local matter data is being erased.
  const keepPendingGcalDeletes=DB.pendingGcalDeletes||[];
  DB={matters:[],discovery:[],records:[],tasks:[],letters:[],deadlines:[],log:[],
    deleted:{matters:[],discovery:[],records:[],tasks:[],letters:[],deadlines:[]},
    pendingGcalDeletes:keepPendingGcalDeletes};
}

export function mById(id){ return DB.matters.find(m=>m.id===id); }

export function fillMatterSelect(sel,live){
  const el=$(sel); if(!el) return;
  const cur=el.value;
  const list=DB.matters.filter(m=>!live||isLive(m)).sort((a,b)=>a.name.localeCompare(b.name));
  el.innerHTML='<option value="">Select a matter…</option>'+list.map(m=>`<option value="${m.id}">${esc(m.name)} · ${esc(m.file)}</option>`).join('');
  if(cur) el.value=cur;
}
