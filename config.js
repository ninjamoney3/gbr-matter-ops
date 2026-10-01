"use strict";

/* ══════════════════════════════════════════════════════════════════════
   ══════════ CONFIGURATION — edit values in this block only ══════════
   Everything a firm administrator would ever need to change lives here:
   who's on the letterhead, carrier list, venue names, standing drafting
   rules, court holidays (add next year's every December), the Google
   Calendar identifiers, and the reminder/follow-up timing policy. Nothing
   below this block should need to change to update any of these.

   Google Calendar identifiers are NOT secrets — a browser OAuth Client ID
   is meant to be public; Google enforces access by authorized origin, not
   by hiding the ID. Real client/matter data, API keys, and OAuth tokens
   still never belong here or anywhere in source — those stay per-browser
   only (see Settings → Anthropic API key, and the Confidentiality section
   of the README).

   The rest of the file reads these through the plain constants declared
   right after this block (FIRM, PEOPLE, VENUES, etc.) — those are thin
   aliases into CONFIG, kept so the places that already reference them by
   name don't all need to change for this reorganization. Edit the values
   here; nothing else needs to move. ══════════════════════════════════ */
export const CONFIG={
  firm:{
    name:'GAUL, BARATTA & ROSELLO, LLC', short:'GBR',
    tagline:'ATTORNEYS AT LAW',
    street:'100 HANOVER AVENUE', city:'CEDAR KNOLLS, NJ  07927',
    phone:'(973) 539-5900', fax:'FAX (973) 539-0059',
    respond:'Please respond to Cedar Knolls',
    otherOffices:[
      {label:'JERSEY CITY OFFICE', l1:'239 Washington Street, Suite 303', l2:'Jersey City, NJ  07302'},
      {label:'NEW YORK OFFICE',    l1:'280 Madison Avenue, Suite 810',    l2:'New York, NY  10016'}
    ],
    legend:[
      {m:'*', t:'Certified by the Supreme Court of New Jersey as a Civil Trial Attorney'},
      {m:'\u2020', t:'also admitted in Pennsylvania'},
      {m:'^', t:'also admitted in New York'}
    ]
  },
  /* Order and marks taken verbatim from LETTERHEAD - NEW 01/05/2026.
     RPC 7.4: the Civil Trial Attorney certification belongs to Joseph M.
     Gaul, Jr. alone and is never attributed to Corey or to the firm. */
  people:[
    {i:'JMG',n:'Joseph M. Gaul, Jr.', lh:'JOSEPH M. GAUL, JR.', mark:'*',        r:'Partner',   o:'Certified by the Supreme Court of New Jersey as a Civil Trial Attorney', onLH:true},
    {i:'JAB',n:'Jessica A. Baratta',  lh:'JESSICA A. BARATTA',  mark:'\u2020',   r:'Partner',   o:'Own caseload', onLH:true},
    {i:'LFR',n:'Lawrence F. Rosello', lh:'LAWRENCE F. ROSELLO', mark:'',         r:'Partner',   o:'Own caseload', onLH:true},
    {i:'CJG',n:'Corey J. Gaul',       lh:'COREY J. GAUL',       mark:'^',        r:'Managing partner', o:'Own caseload; trials, strategy, carrier relationships', email:'cgaul@gaul-law.com', onLH:true},
    {i:'SMB',n:'Shannon Burke',       lh:'SHANNON BURKE',       mark:'',         r:'Attorney',  o:'Own caseload', onLH:true},
    {i:'JEZ',n:'Joshua E. Zoeller',   lh:'JOSHUA E. ZOELLER',   mark:'^',        r:'Attorney',  o:'Own caseload', onLH:true},
    {i:'JAD',n:'Jordan A. Davis',     lh:'JORDAN A. DAVIS',     mark:'',         r:'Associate', o:'Discovery and motion practice', onLH:true},
    {i:'JSC',n:'Julie Scalley',       lh:'',                    mark:'',         r:'Legal secretary', o:'Calendaring, intake, correspondence', onLH:false}
  ],
  /* Named claims contacts are relationship data, not firm letterhead — like
     matter data, they don't belong hardcoded into the app everyone gets a
     copy of. Add real contacts locally, or bring them in via a handoff file. */
  carriers:[
    {n:'Travelers',      s:'Panel',    c:''},
    {n:'Liberty Mutual', s:'Panel',    c:''},
    {n:'Hanover',        s:'Pursuing', c:''},
    {n:'AmTrust',        s:'Pursuing', c:''},
    {n:'Hartford',       s:'Pursuing', c:''}
  ],
  venues:{ESX:'Essex',BER:'Bergen',HUD:'Hudson',UNN:'Union',MRS:'Morris',PAS:'Passaic',MID:'Middlesex',
    MON:'Monmouth',OCN:'Ocean',SOM:'Somerset',SSX:'Sussex',WRN:'Warren',HNT:'Hunterdon',CAM:'Camden',
    BUR:'Burlington',MER:'Mercer',CPM:'Cape May',ATL:'Atlantic',GLO:'Gloucester',SAL:'Salem',CUM:'Cumberland',
    NY:'New York (Supreme)',USDC:'U.S. District Court'},
  standingRules:[
    'A time entry is drafted after every billable client-matter task. Timekeeper CJG unless stated otherwise, no UTBMS codes, hours as good-faith estimates. Nothing is drafted for internal firm operations.',
    'Every case law and court rule citation carries a verification flag. No unverified cite is filing-ready without a Westlaw or Lexis check.',
    'Always "IME" — Independent Medical Examination. Never the plaintiff-preferred "DME".',
    'The Civil Trial Attorney certification belongs to Joe Gaul by name. It is never attributed to Corey or to the firm, per RPC 7.4.',
    'Time is recorded in 0.1 increments with defensible, carrier-conscious narratives.',
    'Defense files carry a JMG410 suffix. Plaintiff files end in CJG.'
  ],
  /* 2026–2027 court year checked against the AOC Order, Schedule of 2026-2027
     Legal Holidays and Court Recesses (njcourts.gov), 8/11/2026.
     2027–2028 entries are marked ESTIMATED below. As of this build (9/1/2026)
     it was not possible to confirm from this environment whether the AOC has
     already published the 2027-2028 order — check njcourts.gov directly
     (Attorneys → Calendars & Schedules) before relying on those dates.       */
  courtHolidays:{
   /* 2025–2026 court year, now past */
   '2026-01-01':"New Year's Day",'2026-01-19':'Martin Luther King, Jr. Day','2026-02-16':"Presidents' Day",
   '2026-04-03':'Good Friday','2026-05-25':'Memorial Day','2026-06-19':'Juneteenth',
   /* 2026–2027 court year — verified */
   '2026-07-03':'Independence Day (observed)','2026-09-07':'Labor Day','2026-10-12':'Columbus Day',
   '2026-11-03':'Election Day','2026-11-11':'Veterans Day',
   '2026-11-23':'Statewide Judicial College','2026-11-24':'Statewide Judicial College','2026-11-25':'Statewide Judicial College',
   '2026-11-26':'Thanksgiving','2026-12-25':'Christmas Day',
   '2026-12-28':'Court recess','2026-12-29':'Court recess','2026-12-30':'Court recess','2026-12-31':'Court recess',
   '2027-01-01':"New Year's Day",'2027-01-18':'Martin Luther King, Jr. Day','2027-02-15':"Presidents' Day",
   '2027-03-26':'Good Friday','2027-05-31':'Memorial Day','2027-06-18':'Juneteenth (observed)',
   /* 2027–2028 court year — ESTIMATED, not yet verified */
   '2027-07-05':'Independence Day (observed) — estimated','2027-09-06':'Labor Day — estimated',
   '2027-10-11':'Columbus Day — estimated','2027-11-02':'Election Day — estimated',
   '2027-11-11':'Veterans Day — estimated','2027-11-25':'Thanksgiving — estimated',
   '2027-12-24':'Christmas Day (observed) — estimated'
  },
  /* isClosed()/roll()/rollBack() only know about holidays actually listed
     above. Past HOLIDAYS_ESTIMATED_THROUGH there is no entry at all for
     ANY date — not even an estimate — so a real court holiday in that
     range would silently compute as an ordinary open day. See
     holidayCoverageNote() in dates.js, surfaced on the Deadlines
     calculator and appended to a logged deadline's notes when relevant. */
  HOLIDAYS_VERIFIED_THROUGH:'2027-06-18',
  HOLIDAYS_ESTIMATED_THROUGH:'2027-12-24',
  googleCalendar:{
    /* Optional and off by default — see the README for the one-time Google
       Cloud setup. Until both are set, Calendar sync stays hidden. */
    clientId:'100711203422-437nqc5rvpfdars7bpbee88ilsc10kss.apps.googleusercontent.com',
    calendarId:'o6kpoj73a21f4bkmn6ocq5u3io@group.calendar.google.com' // GBR Discovery Calendar
  },
  /* How far ahead each kind of deadline starts nagging. 'filing' MUST stay
     at or under 28 days — Google Calendar rejects any reminders.overrides
     minutes value above 40320 (its documented 4-week cap); 30 days (43200)
     silently fails the API call for every filing deadline, which is the
     one category this app most needs to land on the Calendar. */
  reminderProfiles:{filing:[28,14,7,3,1], confirm:[21,10,3], standard:[14,7]},
  /* Records-chase follow-up escalation, in days from the original request. */
  recordsChaseLadder:[21,30,45,60]
};

/* ─── Compatibility aliases — the rest of the file reads these, not CONFIG
   directly. Pure plumbing: change values above, not these lines. ─── */
export const FIRM=CONFIG.firm, PEOPLE=CONFIG.people, CARRIERS=CONFIG.carriers, VENUES=CONFIG.venues,
  STANDING=CONFIG.standingRules, HOLIDAYS=CONFIG.courtHolidays,
  HOLIDAYS_VERIFIED_THROUGH=CONFIG.HOLIDAYS_VERIFIED_THROUGH, HOLIDAYS_ESTIMATED_THROUGH=CONFIG.HOLIDAYS_ESTIMATED_THROUGH,
  GCAL_CLIENT_ID=CONFIG.googleCalendar.clientId, GCAL_CALENDAR_ID=CONFIG.googleCalendar.calendarId,
  CHASE=CONFIG.recordsChaseLadder;

export const TRACK_DAYS={I:150,II:300,III:450,IV:450};

/* ══════════ RULES ══════════
   Scope: the Rules Governing the Courts of New Jersey only (R. 1:x, R. 2:x,
   R. 4:x citations) — not N.J.S.A. statutes. Affidavit of merit, Tort
   Claims Act notice/suit timing, and the PI/contract/minor limitations
   periods were deliberately removed from this table on that basis; they
   are still real deadlines a defense file needs tracked (a late AOM or
   TCA notice is a dismissal ground worth moving on), just not ones that
   belong in a table scoped to court rules. Track them elsewhere, or ask
   for a separate statutes table, if that tracking is still needed.
   `v` marks verification state:
     'pub' — a person on the team checked this against the official Rules
             Governing the Courts of New Jersey text directly.
     'sec' — checked 9/1/2026 against secondary legal-research sources
             (search-engine snippets of aggregators, not the official PDF,
             and not a citator) — see note below the table. Treat as a
             strong "probably right" signal, not a substitute for looking
             the rule up before something outcome-determinative rides on it.
     'unv' — not checked in this app at all.
   `filing` marks whether the thing this deadline produces gets FILED WITH
   THE COURT, as opposed to served on an adversary or just tracked:
     true     — a document gets filed with the court by this date.
     false    — service on an adversary, or an internally-tracked date;
                nothing goes to the court itself.
     'confirm'— practice varies by vicinage/judge or the authority doesn't
                squarely say; treat as a filing until someone checks.
   This flag drives the "FILE WITH COURT" calendar-event prefix, the
   auto-created Task for filing deadlines, and the Filing? column below —
   it is a practical flag for routing reminders, not itself researched
   with the same rigor as `v`. Confirm it against the rule text the first
   time it actually matters for a given matter.
   RULES_LAST_REVIEWED (below) drives the summary line and should move
   forward whenever this table gets a fresh pass.                          */
export const RULES_LAST_REVIEWED='10/1/2026';

export const RULES=[
 {k:'answer',      t:'Answer to complaint',                a:'R. 4:6-1(a)',            d:35,  from:'Service of summons and complaint', v:'sec', filing:true},
 {k:'ded',         t:'Discovery end date by track',        a:'R. 4:24-1(a)',           d:null,from:'First defendant answering — or 90 days after the first defendant is served, if earlier', v:'sec', track:true, filing:false,
   note:'The clock runs from whichever of those two triggers comes first — a defendant who delays answering does not push the DED out past the 90-day service trigger.'},
 {k:'rog',         t:'Answers to interrogatories',         a:'R. 4:17-4(b)',           d:60,  from:'Service of interrogatories', v:'sec', filing:false},
 {k:'ntp',         t:'Response to notice to produce',      a:'R. 4:18-1(b)',           d:35,  from:'Service of the notice', v:'sec', filing:false},
 {k:'ntp50',       t:'Response — floor for a served defendant', a:'R. 4:18-1(b)',      d:50,  from:'Service of the summons and complaint on that defendant', v:'sec', filing:false,
   note:'50-day floor runs from that defendant’s own service of process, not specifically from being served "together with" the notice to produce.'},
 {k:'motfile',     t:'Motion — file and serve',            a:'R. 1:6-3(a)',            d:-16, from:'Return date', v:'pub', filing:true},
 {k:'motopp',      t:'Opposition to motion',               a:'R. 1:6-3(a)',            d:-8,  from:'Return date', v:'sec', filing:true},
 {k:'motreply',    t:'Reply on motion',                    a:'R. 1:6-3(a)',            d:-4,  from:'Return date', v:'sec', filing:true,
   note:'Only 4 days of lead time. Corrected 10/1/2026: R. 1:3-1 excludes intervening Saturdays, Sundays, and legal holidays from the count itself for any period under 7 days — this is not the same as counting calendar days and only rolling the final date (that rule applies to periods of 7 days or more). computeRuleDue() now counts business days for this rule; confirm timeliness independently given the short fuse.'},
 {k:'crossmot',    t:'Cross-motion — file and serve',      a:'R. 1:6-3(b)',            d:-8,  from:'Return date', v:'sec', filing:true,
   note:'Corrected 9/1/2026: a cross-motion is filed and served WITH the opposition papers — the same 8-day deadline, not an independent 15-day schedule.'},
 {k:'sjfile',      t:'Summary judgment — file and serve',  a:'R. 4:46-1',              d:-28, from:'Return date', v:'sec', filing:true},
 {k:'sjopp',       t:'Summary judgment — opposition',      a:'R. 4:46-1',              d:-10, from:'Return date', v:'sec', filing:true},
 {k:'sjlast',      t:'Summary judgment — latest return',   a:'R. 4:46-1',              d:-30, from:'Trial date', v:'sec', filing:false,
   note:'This date is a calendar constraint (the last return date the court will hear), not itself a document that gets filed.'},
 {k:'extmotion',   t:'Motion to extend discovery — file',  a:'R. 4:24-1(c) + R. 1:6-3(a)', d:null, from:'Discovery end date', v:'sec', special:'ext', filing:true,
   note:'The day count here is a practice convention (working back from the DED using the ordinary 16-day motion lead time), not a number the rule itself states. The only hard requirement is that the extension motion be filed — and, per case law, decided — before the discovery end date passes.'},
 {k:'consent60',   t:'Consent extension of discovery',     a:'R. 4:24-1(c)',           d:60,  from:'Current discovery end date', v:'pub', filing:'confirm',
   note:'No motion is required, but many vicinages still expect the consent stipulation e-filed for the docket to reflect the new DED — confirm local practice before assuming otherwise.'},
 {k:'denovo',      t:'Trial de novo after arbitration',    a:'R. 4:21A-6(b)(1)',       d:30,  from:'Filing of the arbitration award', v:'sec', filing:true,
   note:'Corrected 10/1/2026: a July 2025 amendment had added a 10-day good-cause grace period after the 30 days runs, but the Supreme Court has since rescinded that amendment and its Official Comment. Treat 30 days as the deadline — do not assume a grace period is available. Route any late-relief question to attorney review rather than relying on this app for one.'},
 {k:'oj',          t:'Offer of judgment — last day to serve & file (if making one)', a:'R. 4:58-1', d:-21, from:'Trial date', v:'sec', filing:true,
   note:'Corrected 10/1/2026: must be served on the adversary AND filed with the court more than 20 days before the actual trial date — exactly 20 days is not enough, so this computes the latest day satisfying "more than 20" (trial date minus 21, rolled earlier off any weekend/holiday). Optional and strategic, not mandatory: available only where the relief sought is exclusively monetary, and not available in matrimonial actions or the Special Civil Part. Confirm applicability and whether to make an offer with the handling attorney before relying on this date.'},
 {k:'appeal',      t:'Notice of appeal as of right',       a:'R. 2:4-1(a)',            d:45,  from:'Entry of final judgment', v:'sec', filing:true},
 {k:'recon',       t:'Motion for reconsideration',         a:'R. 4:49-2',              d:20,  from:'Service of the order with notice of entry', v:'sec', filing:true,
   note:'Applies to final orders/judgments. An interlocutory order is reviewable "at any time" before final judgment under R. 4:42-2, not on this 20-day clock.'},
 {k:'subpoena',    t:'Subpoena duces tecum — compliance',  a:'R. 1:9-2',               d:null,from:'Date stated on the subpoena', v:'sec', filing:false,
   note:'No NJ rule sets a fixed statewide response period; comply by whatever date the subpoena itself states. R. 4:14-7(c) is a related but different rule — it requires a deposition document subpoena to be served at least 10 days before the deposition, which is a service deadline, not a response deadline.'}
];

/* ══════════ OBLIGATION LIFECYCLE ══════════
   A filing-required deadline is an obligation, not just a date: it moves
   Open → Drafting → Ready to File → Filed → Confirmed, and — this is the
   actual docket-control mechanism, not decoration — it CANNOT reach
   Confirmed without either a real filing confirmation (eCourts, a stamped
   copy, a docket entry) or an explicit partner override with a reason on
   the record. A non-filing deadline (tracking only, or still unconfirmed
   whether it's a filing) keeps the simple Open → Done lifecycle; forcing
   the full filing workflow onto a date nobody files anything for would
   just be more clicking for no safety gained. */
export const FILING_STAGES=['Open','Drafting','Ready to File','Filed','Confirmed'];

/* ══════════ DISCOVERY LEDGER ══════════ */
export const DISC_TYPES=[
 {t:'Uniform interrogatories',        d:60, a:'R. 4:17-4(b)'},
 {t:'Supplemental interrogatories',   d:60, a:'R. 4:17-4(b)'},
 /* Corrected 10/1/2026: R. 4:18-1(b)(2)'s 50-day allowance runs from
    service of the summons and complaint ON THAT DEFENDANT — a separate
    date from when the notice itself was served, whenever the two aren't
    served together. The single "(with complaint)" variant this used to
    be assumed they were always the same date; it's gone, replaced with
    an optional second (floor) date so the two can be entered and
    compared instead of guessed at. The due date is whichever of the two
    computed dates is later — a floor is a minimum, not a substitute. */
 {t:'Notice to produce',              d:35, a:'R. 4:18-1(b)(1)',
   floorDays:50, floorAuthority:'R. 4:18-1(b)(2)',
   floorLabel:'Date summons & complaint served on this defendant (only if different from the notice — sets a 50-day floor)'},
 {t:'Requests for admission',         d:30, a:'R. 4:22-1'},
 {t:'Subpoena duces tecum',           d:null, manual:true, a:'R. 1:9-2'},
 /* Corrected 10/1/2026: no NJ rule sets a fixed response period for a
    deficiency demand — the 20 days here was this app's own made-up
    default with no authority behind it. Manual like the subpoena row:
    enter whatever date the demand itself states or the parties agreed
    to, never an auto-computed "deadline". */
 {t:'Deficiency demand',              d:null, manual:true, a:'No fixed NJ rule — enter the date demanded or agreed'}
];

/* ══════════ EVENT-DRIVEN INTAKE — "What happened?" ══════════
   The whole point: an employee picks what happened in plain language and
   answers only the facts that event actually needs. The NJ Court Rule,
   the day-count, the rolling, the filing flag — all of it runs underneath
   via the exact same RULES/computeRuleDue/logDeadline/logDiscoveryItem/
   proposeDateChanges functions the rule-driven forms already use and this
   app has already tested. This is a second front door onto that same
   machinery, not a second set of rules to maintain. The Calculator and
   the rule dropdown in Deadlines stay exactly as they are for anyone who
   already knows which rule they want ("Other" below opens that directly). */
export const WHAT_HAPPENED_EVENTS=[
  {k:'complaint_served',  t:'Complaint served',        h:'Starts the clock on our Answer'},
  {k:'discovery_received',t:'Discovery received',      h:"A demand came in that we must respond to"},
  {k:'discovery_deficiency',t:'Discovery deficiency letter sent',h:'Tracks the cure period before a motion to compel'},
  {k:'motion_received',   t:'Motion received',         h:'Logs our opposition deadline'},
  {k:'motion_filed',      t:'Motion filed',            h:'Logs our reply deadline'},
  {k:'order_entered',     t:'Order entered',           h:'A court order changed something'},
  {k:'discovery_extended',t:'Discovery extended',      h:'New discovery end date'},
  {k:'arbitration_scheduled',t:'Arbitration scheduled',h:'Sets the arbitration date'},
  {k:'arbitration_award',t:'Arbitration award entered',h:'Logs the trial de novo deadline'},
  {k:'trial_scheduled',   t:'Trial scheduled',         h:'Sets the trial date'},
  {k:'ime_scheduled',     t:'IME scheduled',           h:'Independent Medical Examination'},
  {k:'deposition_scheduled',t:'Deposition scheduled',  h:'Sets a prep reminder ahead of it'},
  {k:'other',             t:'Other',                   h:'Pick the NJ Court Rule yourself'}
];

/* ══════════ LETTERS ══════════ */
export const LETTERS=[
 {k:'carrier',  t:'Carrier status report'},
 {k:'hipaaform',t:'HIPAA authorization — the form itself (no letterhead)',form:true},
 {k:'hipaa',    t:'HIPAA authorization packet — cover to plaintiff counsel'},
 {k:'records',  t:'Medical records request to provider'},
 {k:'deficiency',t:'Discovery deficiency letter'},
 {k:'consent',  t:'R. 4:24-1(c) consent to extend discovery'},
 {k:'adjourn',  t:'Request to adjourn'},
 {k:'ack',      t:'Acknowledgment of correspondence'},
 {k:'deadlinenotice', t:'Internal notice — upcoming court deadline(s)'}
];

/* ══════════ BILLING SCRUB ══════════ */
export const SCRUB=[
 {n:'Vague narrative',      re:/\b(attend to same|review file|work on|handle|address|various|as needed|miscellaneous|follow up$)\b/i,
  why:'Carrier guidelines require a narrative that identifies the task and the document. "Review file" tells an auditor nothing.'},
 {n:'Block billing',        test:e=>(e.narr.match(/;|,\s*(and\s+)?(review|draft|prepare|attend|confer|analyze|revise)/gi)||[]).length>=2&&e.hours>=1.0,
  why:'Multiple discrete tasks in one entry. Travelers and most panels require them itemized separately.'},
 {n:'Clerical task',        re:/\b(scan|file(?!\s+a\b)|photocopy|copy|mail|fax|calendar|organize|bates|upload|download|print)\b/i,
  why:'Clerical work is overhead, not billable. Auditors cut these on sight.'},
 {n:'Intra-office conference', re:/\b(conference|call|meeting|discuss|confer)\b.*\b(with|w\/)\s*(CJG|JAD|JEZ|JMG|SMB|JAB|LFR|JSC)\b/i,
  why:'Most panel guidelines bar billing more than one timekeeper for the same internal conference, and some bar it entirely.'},
 {n:'Excessive block of time', test:e=>e.hours>=8.0,
  why:'Any single entry at or above 8.0 hours draws scrutiny. Break the day into discrete tasks.'},
 {n:'Not in tenth increments', test:e=>Math.abs(e.hours*10-Math.round(e.hours*10))>1e-9,
  why:'Firm standard is 0.1 increments.'},
 {n:'Uses "DME"',           re:/\bDME\b/,
  why:'House rule — always "IME," the plaintiff-preferred "DME" never appears in GBR work product.'},
 {n:'Travel billed full',   re:/\btravel\b/i,
  why:'Many panels reimburse travel at half rate or not at all. Confirm before submitting.'},
 {n:'Legal research, no issue', test:e=>/research/i.test(e.narr)&&!/\bre:?\s|\bregarding\b|\bwhether\b/i.test(e.narr),
  why:'Research entries must name the issue researched.'}
];

/* ══════════ INTAKE ══════════ */
export const SCHEMA=`{
"documentType":"track assignment notice | order extending discovery | arbitration notice | trial notice | notice of motion | complaint | medical providers chart | other",
"caseName":"Plaintiff v. Defendant, short form, surnames only",
"docketNumber":"exactly as printed, e.g. ESX-L-000839-24",
"venue":"county abbreviation: ESX BER HUD UNN MRS PAS MID MON OCN SOM SSX WRN HNT CAM BUR MER CPM ATL GLO SAL CUM, or NY or USDC",
"ourFileNumber":"GBR file number if printed, else null",
"track":"I, II, III, IV or null",
"discoveryEndDate":"YYYY-MM-DD or null",
"arbitrationDate":"YYYY-MM-DD or null",
"trialDate":"YYYY-MM-DD or null",
"dateOfService":"only for a complaint — the date the summons and complaint were served on this defendant, if printed (e.g. on a proof of service or affidavit of service attached), else null",
"motionReturnDate":"only for a notice of motion — the return date printed on the notice, else null",
"judge":"judge surname or null",
"patientName":"only for a medical providers chart — the patient/plaintiff name printed at the top, else null",
"providers":"only for a medical providers chart — array of {name, address, requestSentDate (YYYY-MM-DD or null), requestSentMethod (Mail, Fax, E-mail, or null)}, one per non-blank provider row, else null",
"uncertain":["field names you guessed or could not read"],
"summary":"one sentence on what this document does"
}`;

export const READABLE_TYPES=['application/pdf','image/png','image/jpeg'];

/* ══════════ DATE CONFLICT DETECTION ══════════
   The one job this exists to do: intake NEVER silently overwrites a
   material docket date again. A PDF read proposes a change; a human
   accepts it. Nothing here mutates existing.currentDED/arbitration/trial —
   it only appends to existing.pendingDateChanges for the matter modal to
   show and resolve. See acceptDateChange/keepCurrentDate/reviewPendingDate
   below for where mutation (and history logging) actually happens. */
export const DATE_PROPOSAL_FIELDS=[
  {field:'currentDED',  label:'Discovery End Date', extractKey:'discoveryEndDate', onlyFromOrder:true},
  {field:'arbitration', label:'Arbitration Date',    extractKey:'arbitrationDate'},
  {field:'trial',       label:'Trial Date',          extractKey:'trialDate'}
];
