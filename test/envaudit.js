// Config that is never passed is config that does nothing.
//
// CHORUS_CHANNEL was read in three places — the WHO sweep, a room's topic
// text, and which room counts as the way in — and the workflow never passed
// it. All three quietly fell back to empty, and the worst of them would have
// signposted the OPEN room as "Invite-only", which is the opposite of true.
// Nothing failed; it was simply wrong, which is the shape of fault that
// survives longest here.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const read = new Set();
for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) read.add(m[1]);
    // Dynamic reads: process.env[name], with the names as literals nearby.
    // Missing these reported eight live FINDIT_* settings as dead config —
    // an audit that invents dead code is worse than no audit.
    if (/process\.env\[/.test(src)) {
        for (const m of src.matchAll(/\b(?:num|str|flag|onOff)\('([A-Z][A-Z0-9_]{3,})'/g)) read.add(m[1]);
    }
}

const wfDir = path.join(root, '.github', 'workflows');
const yml = fs.readdirSync(wfDir).map((f) => fs.readFileSync(path.join(wfDir, f), 'utf8')).join('\n');
const passed = new Set();
for (const m of yml.matchAll(/^\s{8,}([A-Z0-9_]+):\s/gm)) passed.add(m[1]);

console.log('— nothing is passed that nobody reads —');
const unused = [...passed].filter((n) => !read.has(n)).sort();
c('no dead configuration in the workflow', unused.length === 0, unused.join(', '));

console.log('— everything the bot cannot work without IS passed —');
// Not every name: most have a sensible in-code default and are meant to be
// left alone. These are the ones where the default is WRONG rather than
// merely unset.
for (const n of ['IRC_CHANNEL', 'NICKSERV_PASS', 'OWNERS', 'CHORUS_MARK', 'CHORUS_CHANNEL', 'TRUST_CHANNEL']) {
    if (!read.has(n)) continue;                 // not used by this bot any more
    c(`${n} reaches the process`, passed.has(n),
      'read in the code, absent from the workflow — it silently becomes empty');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
