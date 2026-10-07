// Owner-authored pushback pool: automatic trigger on an abuser's first slur
// strike. The whole point of this feature is the guards — the pool must be
// validated, the trigger must be scoped, the rate must be capped. If any one
// of these regresses, the feature becomes something I would not have shipped.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');

let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— structural wiring —');
c('DISS_ON env knob (defaults off)',
  /const DISS_ON = \/\^.*on.*process\.env\.DISS_ON \|\| 'off'/.test(src));
c('validateDissLine function exists',
  /function validateDissLine\(line\)/.test(src));
c('pool parse logs rejected lines (so owner can fix)',
  /\[DISS\] dropped pool line/.test(src));
c('maybeDissAbuser is defined',
  /function maybeDissAbuser\(chan, nick\)/.test(src));
c('hook fires on first strike only (reputation.strikes === 1)',
  /reputation\.strikes\(nick\) === 1/.test(src));
c('hook is called from the SEVERE_WORDS badword path',
  /maybeDissAbuser\(chan, nick\)/.test(src));
c('hook is called inside the strikes===1 branch, AFTER reputation.offended',
  // The hook sits inside a block that gates on reputation.strikes(nick)===1.
  // Use that specific gate as the anchor to find the CALL site (not the
  // function definition elsewhere in the file).
  /reputation\.strikes\(nick\) === 1\)[\s\S]{0,200}maybeDissAbuser\(chan, nick\)/.test(src));

console.log('\n— the three guards that keep this from turning into something else —');
c('home-channel gate (chanKey comparison to config.channels[0])',
  /chanKey\(home\)/.test(src) && /config\.channels\[0\]/.test(src));
c('owner/admin/trusted/bot targets are REFUSED by the diss path',
  /isOwner\(nick\)/.test(src) && /isAdmin\(nick\)/.test(src)
  && /isTrusted\(nick\)/.test(src) && /isOneOfOurs/.test(src));
c('rate-limit (DISS_MIN_GAP_MS, default 5 min)',
  /DISS_MIN_GAP_MS/.test(src) && /now - lastDissAt < DISS_MIN_GAP_MS/.test(src));

console.log('\n— validator: slurs are refused, threats are refused —');
// Execute validateDissLine in a sandbox against known slur and threat strings.
// Mock just enough: a severeWords Set containing one marker word, and the
// normalize() the real file uses. The validator imports those from closure.
const vm = require('vm');
function slice(name) {
    const re = new RegExp(`function ${name}\\(([^)]*?)\\)\\s*\\{`);
    const start = src.search(re);
    if (start < 0) throw new Error(`cannot find ${name}`);
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error('unbalanced');
}
const script = `
    const severeWords = new Set(['slurword']);
    const normalize = (s) => String(s).toLowerCase().replace(/[0-9@]/g, (c) => ({'0':'o','@':'a'}[c] || c));
    ${slice('validateDissLine')}
    validateDissLine;
`;
const vfn = vm.runInNewContext(script, {});
c('empty line rejected', !vfn('').ok);
c('plain sharp line accepted', vfn('your typing has the energy of a wet sock.').ok);
c('line containing the slur list is REJECTED',
  !vfn('what a slurword comment that was').ok);
c('leet-form of the slur still rejected (via normalize)',
  !vfn('that was a slurw0rd thing to type').ok);
c('explicit threat is rejected: "I will kill you"',
  !vfn('oh, i will kill you for that').ok);
c('"beat you" threat rejected',
  !vfn('go beat you with a shoe').ok);
c('rape pattern rejected', !vfn('a rape joke, really?').ok);
c('"die slow" rejected', !vfn('go die slow').ok);
c('over-220-char line rejected (would bloat IRC)',
  !vfn('x'.repeat(221)).ok);
c('crude is OK (not a slur or threat): "you type like you lost a bet"',
  vfn('you type like you lost a bet with a thesaurus.').ok);

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
