"use strict";
import {HOLIDAYS, HOLIDAYS_ESTIMATED_THROUGH, HOLIDAYS_VERIFIED_THROUGH} from './config.js';

/* ══════════ DATES ══════════ */
export function sod(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}

/* Strict: JS's Date constructor silently normalizes an invalid calendar
   date (2026-02-31 becomes March 3) instead of rejecting it. Round-trip
   the parsed components back through the constructed Date and reject any
   mismatch, so a typo never turns into a wrong-but-plausible deadline. */
export function pd(s){
  if(!s) return null;
  const m=String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  const y=+m[1], mo=+m[2], da=+m[3];
  if(mo<1||mo>12||da<1||da>31) return null;
  const d=new Date(y,mo-1,da);
  if(isNaN(d)||d.getFullYear()!==y||d.getMonth()!==mo-1||d.getDate()!==da) return null;
  return d;
}

export function iso(d){return d?d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'):'';}

export function fmt(d){return d?String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')+'/'+String(d.getFullYear()).slice(2):'—';}

export function fmtLong(d){if(!d)return '';const M=['January','February','March','April','May','June','July','August','September','October','November','December'];return M[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();}

export function add(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}

/* Calendar-year/month arithmetic — NOT the same as adding a fixed day count.
   A statute of limitations measured in "2 years" or "6 months" must land on
   the same month/day N years or months later; a fixed-day approximation
   (e.g. 730 days for "2 years") silently drifts a day off whenever a leap
   day falls inside the span. Always use these for statutory periods. */
export function addYears(d,n){const x=new Date(d);x.setFullYear(x.getFullYear()+n);return x;}

export function addMonths(d,n){const x=new Date(d);x.setMonth(x.getMonth()+n);return x;}

export function diff(a,b){return Math.round((sod(b)-sod(a))/864e5);}

export function isClosed(d){return d.getDay()===0||d.getDay()===6||!!HOLIDAYS[iso(d)];}

/* HOLIDAYS only has entries through HOLIDAYS_ESTIMATED_THROUGH, and
   everything after HOLIDAYS_VERIFIED_THROUGH is an estimate, not a
   confirmed court closure — isClosed()/roll()/rollBack() use the table
   silently, so a date in either range needs its own visible flag rather
   than being treated like an ordinary verified computation. Returns ''
   when the date needs no caveat. */
export function holidayCoverageNote(d){
  if(!d) return '';
  const i=iso(d);
  if(i>HOLIDAYS_ESTIMATED_THROUGH) return `No court holiday data at all past ${HOLIDAYS_ESTIMATED_THROUGH} — this date could silently fall on an actual court holiday without being flagged. Confirm the court's calendar manually.`;
  if(i>HOLIDAYS_VERIFIED_THROUGH) return `Falls in a court year where holidays are estimated, not yet officially confirmed (coverage verified only through ${HOLIDAYS_VERIFIED_THROUGH}) — verify against the court's actual calendar before relying on this date.`;
  return '';
}

/* R. 1:3-1 — a period ending on a weekend or court holiday runs to the next business day */
export function roll(d){let x=new Date(d),g=0;while(isClosed(x)&&g++<40)x=add(x,1);return x;}

/* Backward-computed dates (motion filing) move EARLIER, never later */
export function rollBack(d){let x=new Date(d),g=0;while(isClosed(x)&&g++<40)x=add(x,-1);return x;}

/* Motions are returnable on Fridays; skip Fridays the courts are closed */
export function returnDate(ded){if(!ded)return null;let x=add(ded,-1),g=0;while((x.getDay()!==5||HOLIDAYS[iso(x)])&&g++<400)x=add(x,-1);return x;}

/* N actual business days before a date — NOT the same as "subtract N
   calendar days, then roll if it lands on a closed day" (rollBack only
   nudges the landing spot; it doesn't count weekends/holidays inside the
   span). Used for the GBR-internal nag buffer, which promises N real
   working days of lead time. */
export function subtractBusinessDays(d,n){let x=new Date(d),count=0,g=0;while(count<n&&g++<400){x=add(x,-1);if(!isClosed(x))count++;}return x;}

/* N actual business days after a date — the forward counterpart to
   subtractBusinessDays, needed for R. 1:3-1's short-period rule (below). */
export function addBusinessDays(d,n){let x=new Date(d),count=0,g=0;while(count<n&&g++<400){x=add(x,1);if(!isClosed(x))count++;}return x;}
