"use strict";
import {CHASE, READABLE_TYPES, SCHEMA} from './config.js';
import {add, fmt, iso, pd, roll} from './dates.js';
import {$, $$, esc, isLive, norm, toast} from './util.js';
import {APIKEY, DB, SyncFS, TODAY, WHO, fillMatterSelect, save, touch, uid} from './store.js';
import {proposeDateChanges, suggestDeadlineFromExtract} from './workflows.js';
import {openMatter, renderAll} from './app.js';

export function blockFor(b64,mime){
  const isPdf=mime==='application/pdf';
  return isPdf?{type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}}
              :{type:'image',source:{type:'base64',media_type:mime,data:b64}};
}

export async function callReader(block,prompt){
  const body=JSON.stringify({model:'claude-sonnet-5',max_tokens:1000,
    messages:[{role:'user',content:[block,{type:'text',text:prompt}]}]});
  const headers=APIKEY
    ?{'Content-Type':'application/json','x-api-key':APIKEY,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'}
    :{'Content-Type':'application/json'};
  let res;
  try{ res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers,body}); }
  catch(e){ throw new Error(APIKEY?'Could not reach the reading service. Check the connection.'
    :'Reading needs an API key when this runs from a file on your computer. Open Settings and add one, or use Add matter by hand.'); }
  if(res.status===401||res.status===403) throw new Error('That API key was rejected. Check it in Settings.');
  if(res.status===429) throw new Error('Rate limited. Wait a moment and try again.');
  if(!res.ok){ let d='';try{d=(await res.json()).error.message}catch(e){} throw new Error('Reading service error '+res.status+(d?': '+d:'')); }
  const data=await res.json();
  const txt=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
  const c=txt.replace(/^```(?:json)?/,'').replace(/```$/,'').trim();
  const a=c.indexOf('{'), z=c.lastIndexOf('}');
  if(a<0||z<0) throw new Error('Could not read a result from this document');
  return JSON.parse(c.slice(a,z+1));
}

export async function extract(b64,mime){
  const prompt=`You are reading a document for a New Jersey civil defense firm's docketing system. It is either a
Superior Court document, or a medical-providers tracking chart the firm's own staff fills in when chasing a
plaintiff's medical records (a table headed by a patient name, with rows of provider name/address and a "date
and how sent" request column).

Extract these fields and respond with ONLY a JSON object — no markdown fences, no preamble:
${SCHEMA}

Rules:
- Dates as YYYY-MM-DD. If a date is not printed, use null. Never infer or calculate a date.
- "discoveryEndDate" is the DED. On an order extending discovery, use the NEW end date.
- If this is a medical providers chart: set documentType to "medical providers chart", fill patientName and
  providers, and leave the court-document fields (caseName, docketNumber, etc.) null. Skip template rows with
  no provider name filled in. requestSentDate/requestSentMethod are null for a row that hasn't been sent yet.
- List anything you are unsure about in "uncertain" so a human checks it.
- "dateOfService" (complaint only) and "motionReturnDate" (notice of motion only) follow the same rule as every
  other date here: only the date actually printed on the document, never a computed or assumed one.
- If this is neither a court document nor a medical providers chart, set documentType to "other" and leave
  every other field null.`;
  return callReader(blockFor(b64,mime),prompt);
}

/* Used by the Records-tab drop zone, where the document is always a chart by
   context — no need to ask the model to first decide what kind of document
   it's looking at, which is a more reliable path than routing off of how
   extract() above happens to phrase documentType (see reviewExtract, which
   routes off the presence of real provider rows instead, for the same
   robustness reason when a chart lands in the general Intake drop zone). */
export async function extractProvidersChart(b64,mime){
  const prompt=`You are reading a medical-providers tracking chart: a law firm's own form for chasing a
plaintiff's medical records, headed by a patient name, with rows of provider name/address and a "date and how
sent" request column.

Respond with ONLY a JSON object — no markdown fences, no preamble:
{
"patientName":"the patient/plaintiff name printed at the top, or null",
"providers":[{"name":"provider or facility name","address":"street, city, state, zip as printed, or null","requestSentDate":"YYYY-MM-DD or null","requestSentMethod":"Mail, Fax, E-mail, or null"}],
"uncertain":["anything you were unsure about"]
}

Rules:
- Skip template/blank rows with no provider name filled in.
- Dates as YYYY-MM-DD. Never infer or calculate a date that isn't printed.
- requestSentDate and requestSentMethod are both null for a row that hasn't been sent yet.`;
  return callReader(blockFor(b64,mime),prompt);
}

export function toB64(f){return new Promise((res,rej)=>{const r=new FileReader();
  r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=()=>rej(new Error('Could not read this file'));r.readAsDataURL(f);});}

export async function handleFiles(files,opts){
  opts=opts||{};
  const queueSel=opts.queue||'#queue', extractor=opts.extractor||extract, onResult=opts.onResult||reviewExtract;
  for(const f of files){
    const id='j'+Math.random().toString(36).slice(2,8);
    const d=document.createElement('div');d.className='job';d.id=id;
    d.innerHTML='<div class="spin"></div><div class="nm"></div><div class="st"></div>';
    d.querySelector('.nm').textContent=f.name;d.querySelector('.st').textContent='Reading…';
    $(queueSel).appendChild(d);
    if(f.type && !READABLE_TYPES.includes(f.type)){
      d.classList.add('err'); const s=d.querySelector('.spin'); if(s)s.remove();
      d.querySelector('.st').textContent='Not a supported format — save or print this as a PDF first (Word, Excel, etc. can\'t be read directly).';
      const b=document.createElement('button');b.className='sm ghost';b.textContent='Dismiss';b.onclick=()=>d.remove();d.appendChild(b);
      continue;
    }
    try{
      const b64=await toB64(f);
      d.querySelector('.st').textContent='Extracting dates…';
      const out=await extractor(b64,f.type||'application/pdf');
      d.remove(); onResult(out,f.name);
    }catch(err){
      d.classList.add('err'); const s=d.querySelector('.spin'); if(s)s.remove();
      d.querySelector('.st').textContent=err.message;
      const b=document.createElement('button');b.className='sm ghost';b.textContent='Dismiss';b.onclick=()=>d.remove();d.appendChild(b);
    }
  }
}

export function guessMatterForPatient(name){
  if(!name) return '';
  const last=name.trim().split(/\s+/).pop().toLowerCase();
  if(!last) return '';
  const hit=DB.matters.find(m=>isLive(m)&&m.name.toLowerCase().includes(last));
  return hit?hit.id:'';
}

export function reviewProvidersExtract(x,src){
  const providers=(x.providers||[]).filter(p=>p&&p.name&&p.name.trim());
  if(!providers.length){ toast('No providers found on that chart'); return; }
  const guess=guessMatterForPatient(x.patientName);
  $('#modalHost').innerHTML=`<div class="scrim" id="sc"><div class="modal" style="max-width:640px">
    <div class="mh"><h3>Medical providers chart</h3>
      <div class="s">${esc(x.patientName||'Patient not read from the chart')} · ${esc(src)}</div></div>
    <div class="mb">
      <div class="full"><label>Matter</label><select class="t" id="pc_matter"></select></div>
      <p class="note" style="margin:8px 0 4px">Uncheck any row you don't want added. Requested date defaults to today when the chart didn't have one filled in yet.</p>
      <div id="pc_rows" style="border:1px solid var(--rule);border-radius:6px;margin-top:6px;max-height:320px;overflow:auto"></div>
    </div>
    <div class="mf"><button id="pc_cancel">Cancel</button><button class="primary" id="pc_save">Add to Records chase</button></div>
  </div></div>`;
  fillMatterSelect('#pc_matter',true);
  if(guess) $('#pc_matter').value=guess;
  $('#pc_rows').innerHTML=providers.map((p,i)=>`
    <div class="row" style="padding:8px 12px;border-bottom:1px solid var(--rule2);align-items:flex-start">
      <input type="checkbox" data-pc="${i}" ${p.requestSentDate?'checked':''} style="width:auto;margin-top:3px">
      <div style="flex:1">
        <div style="font-weight:500">${esc(p.name)}</div>
        <div class="meta">${esc(p.address||'')}</div>
        <div class="meta mono">${p.requestSentDate?fmt(pd(p.requestSentDate)):'no date on chart — defaults to today'}${p.requestSentMethod?' · '+esc(p.requestSentMethod):''}</div>
      </div>
    </div>`).join('');
  $('#pc_cancel').onclick=()=>$('#modalHost').innerHTML='';
  $('#sc').onclick=e=>{if(e.target.id==='sc')$('#modalHost').innerHTML='';};
  $('#pc_save').onclick=async()=>{
    const mid=$('#pc_matter').value; if(!mid) return toast('Pick a matter first');
    let n=0;
    $$('[data-pc]').forEach(cb=>{
      if(!cb.checked) return;
      const p=providers[+cb.dataset.pc];
      const req=p.requestSentDate||iso(TODAY);
      DB.records.push(touch({id:uid(),matterId:mid,
        provider:p.address?`${p.name} — ${p.address}`:p.name,
        requested:req,auth:'Yes',stage:0,nextFollowUp:iso(roll(add(pd(req),CHASE[0]))),status:'Outstanding'}));
      n++;
    });
    if(!n){ toast('Nothing checked'); return; }
    await save();SyncFS.scheduleSync();renderAll();$('#modalHost').innerHTML='';
    toast(`${n} provider${n>1?'s':''} added to Records chase`);
  };
}

export function reviewExtract(x,src){
  const hasProviders=Array.isArray(x.providers)&&x.providers.some(p=>p&&p.name&&p.name.trim());
  if(hasProviders||x.documentType==='medical providers chart'){ reviewProvidersExtract(x,src); return; }
  const existing=x.docketNumber?DB.matters.find(m=>norm(m.docket)===norm(x.docketNumber)):null;
  const suggestion=suggestDeadlineFromExtract(x);
  if(existing){
    const proposed=proposeDateChanges(existing,x,src); // never mutates currentDED/arbitration/trial directly — see above
    if(x.judge&&!existing.judge) existing.judge=x.judge; // text field, blank-only fill — not a material date, no conflict risk
    existing.lastActivity=iso(TODAY);
    existing.notes=(existing.notes?existing.notes+' ':'')+`[${fmt(TODAY)} ${src}: ${x.summary||x.documentType}]`
      +(suggestion?` ${suggestion}`:'');
    openMatter(existing);
    if(suggestion) setTimeout(()=>{const el=document.getElementById('e_notes'); if(el) el.classList.add('flagme');},30);
    toast(proposed?`Matched an existing matter — ${proposed} date change${proposed>1?'s':''} need${proposed>1?'':'s'} your review`
      :(suggestion?'Matched an existing matter — a deadline needs logging':'Matched an existing matter — review the update'));
    return;
  }
  const m={id:uid(),side:'defense',name:x.caseName||'',docket:x.docketNumber||'',venue:(x.venue||'').toUpperCase(),
    file:x.ourFileNumber||'',status:'Active',owner:WHO,carrier:'',claim:'',adjuster:'',judge:x.judge||'',
    track:x.track||'II',originalDED:x.discoveryEndDate||'',currentDED:'',sol:'',
    consent:'',motion:'',records:'',depo:'',ime:'',arbitration:x.arbitrationDate||'',trial:x.trialDate||'',
    notes:`[${fmt(TODAY)} ${src}: ${x.summary||x.documentType}]`+(suggestion?` ${suggestion}`:''),lastActivity:iso(TODAY)};
  openMatter(null);
  setTimeout(()=>{
    $('#e_name').value=m.name;$('#e_docket').value=m.docket;$('#e_venue').value=m.venue;
    $('#e_file').value=m.file;$('#e_judge').value=m.judge;$('#e_track').value=m.track||'II';
    $('#e_oded').value=m.originalDED;$('#e_arb').value=m.arbitration;$('#e_trial').value=m.trial;
    $('#e_notes').value=m.notes;
    (x.uncertain||[]).forEach(k=>{
      const map={caseName:'e_name',docketNumber:'e_docket',venue:'e_venue',discoveryEndDate:'e_oded',
        arbitrationDate:'e_arb',trialDate:'e_trial',ourFileNumber:'e_file',judge:'e_judge',track:'e_track'};
      const el=document.getElementById(map[k]); if(el) el.classList.add('flagme');
    });
    if(suggestion) $('#e_notes').classList.add('flagme');
    $('#e_oded').dispatchEvent(new Event('input'));
  },30);
}
