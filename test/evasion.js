// The evasion pass must not glue ordinary words into an insult.
//
// Live: UME said "Bas apki smile mein kami na aani chahiye" — "may your smile
// never fade" — and was devoiced for "watch your language". Removing every
// space turned "kami na aani" into "kaminaaani", which contains "kamina". He
// asked the room what he had said. Nobody could tell him, because he had not
// said it.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— the shape of the fix —');
c('no path joins across a space', !/norm\.replace\(\/\\s\+\/g, ''\)/.test(src),
  'that is what fused two innocent words into an insult');
c('and distinctHits was fixed too', /depunct !== norm && depunct\.includes/.test(src),
  'it decides "three slurs = ban", so the same glue could produce a ban');
c('punctuation evasion is still handled', /const depunct = normalizeGlue\(msg\)/.test(src));
c('single-letter runs are still handled', /\{3,\}\[a-z0-9\]/.test(src));

// Lifted from the source at run time rather than reimplemented, because a
// hand-copy drifts: this test passed against its own stale copy of the very
// bug it exists to catch.
const words = new Set(['kamina', 'chutiya', 'madarchod', 'bhosdike', 'gaandu']);
const body = src.slice(src.indexOf('function wordHit'), src.indexOf('\n}', src.indexOf('function wordHit')) + 2);
const glueBody = src.slice(src.indexOf('function normalizeGlue'), src.indexOf('\n}', src.indexOf('function normalizeGlue')) + 2);
const nAt = src.indexOf('function normalize(t)');
const normBody = src.slice(nAt, src.indexOf('\n}', nAt) + 2);
// eslint-disable-next-line no-eval
eval(glueBody + '\n' + normBody + '\n' + body);
const hit = (msg) => wordHit(words, msg);

console.log('\n— ordinary sentences that must survive —');
for (const s of ['Bas apki smile mein kami na aani chahiye', 'kami na aani',
                 'hello, kami na aani chahiye', 'wow! kami na aani',
                 'tum kamaal ho yaar', 'na aani chahiye', 'kami hai thodi si',
                 'gaana suno', 'chai piyo'])
  c(`clean: ${s.slice(0, 38)}`, hit(s) === null, `flagged as "${hit(s)}"`);

console.log('\n— deliberate evasion that must still be caught —');
for (const s of ['ch.utiya', 'k a m i n a', 'm-a-d-a-r-c-h-o-d', 'you chutiya',
                 'b.h.o.s.d.i.k.e'])
  c(`caught: ${s}`, hit(s) !== null);

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
