// The daily budget must actually stop spending, and must reset at UTC midnight.
const fs = require('fs');
const src = fs.readFileSync('../action-bot.js','utf8');
const fn  = src.match(/function aiRateOk\(\)[\s\S]*?\n}/)[0];
const left= src.match(/function aiBudgetLeft\(\)[\s\S]*?\n}/)[0];

function build(perDay, perMin, clock) {
  const ctx = { config:{aiMaxPerDay:perDay, aiMaxPerMin:perMin}, aiCalls:[], aiDayCount:0, aiDayKey:'' };
  const f = new Function('ctx','Date', `
    let {config} = ctx; let aiCalls = ctx.aiCalls, aiDayCount = ctx.aiDayCount, aiDayKey = ctx.aiDayKey;
    ${fn}
    ${left}
    return { ok: aiRateOk, left: aiBudgetLeft, peek: () => aiDayCount };
  `);
  return f(ctx, clock);
}
let fails = 0;
const c = (n, ok, d='') => { if(!ok) fails++; console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`); };

// A clock we control, so "midnight" is testable.
let nowMs = Date.parse('2026-08-22T10:00:00Z');
class FakeDate extends Date { constructor(...a){ super(...(a.length?a:[nowMs])); } static now(){ return nowMs; } }

let api = build(5, 100, FakeDate);
let allowed = 0;
for (let i = 0; i < 20; i++) if (api.ok()) allowed++;
c(`the daily cap stops spending (allowed ${allowed} of 20, cap 5)`, allowed === 5, `allowed ${allowed}`);
c('and reports what is left', /0\/5 left today/.test(api.left()), api.left());

// Roll past UTC midnight -> fresh allowance.
nowMs = Date.parse('2026-08-23T00:00:01Z');
c('the budget resets at UTC midnight', api.ok() === true);
c('and the count restarts', /4\/5 left today/.test(api.left()), api.left());

// Per-minute cap still independently applies.
nowMs = Date.parse('2026-08-23T01:00:00Z');
api = build(1000, 3, FakeDate);
allowed = 0;
for (let i = 0; i < 10; i++) if (api.ok()) allowed++;
c(`the per-minute cap still bites (allowed ${allowed} of 10, cap 3)`, allowed === 3, `allowed ${allowed}`);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails?1:0);
