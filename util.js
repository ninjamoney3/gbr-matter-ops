"use strict";

export const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

export function tone(n){ if(n===null||n===undefined) return 'grey'; if(n<0) return 'red'; if(n<=14) return 'amber'; return 'green'; }

export function isLive(m){ return m.status!=='Settled'&&m.status!=='Dismissed'; }

export function norm(s){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').split('-')
  .filter(Boolean).map(p=>/^\d+$/.test(p)?String(parseInt(p,10)):p).join(''); }

export function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

export function toast(m){ const t=document.createElement('div');t.className='toast';t.textContent=m;
  document.body.appendChild(t);setTimeout(()=>t.remove(),2600); }
