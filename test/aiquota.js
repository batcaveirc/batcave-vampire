// Per-person AI limit: answer, then ONE joke, then quiet until the window frees.
const { AiQuota, overuseLine } = require('../aiquota');

let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

let t = 0;
const q = new AiQuota({ per10m: 3, perDay: 5, now: () => t });
const seq = [];
for (let i = 0; i < 6; i++) { seq.push(q.check('Ayaan')); t += 1000; }
c('the first three in ten minutes are answered', seq.slice(0, 3).every((s) => s === 'ok'), seq.join(','));
c('the fourth gets ONE joke', seq[3] === 'joke', seq.join(','));
c('and after that, silence — not a joke every time', seq.slice(4).every((s) => s === 'quiet'), seq.join(','));
c('someone else is unaffected', q.check('Pinno') === 'ok');
c('nick case does not matter', q.check('AYAAN') === 'quiet');

t += 11 * 60000;
c('ten minutes later they can ask again', q.check('Ayaan') === 'ok');
c('the daily cap holds across windows', (() => {
    q.check('Ayaan');                       // 5th of the day
    t += 11 * 60000;
    return q.check('Ayaan') === 'joke';     // 6th: over the day, even in a fresh window
})());
t += 25 * 3600000;
c('a new day resets it', q.check('Ayaan') === 'ok');

const line = overuseLine('Ayaan', () => 0);
c('the joke names the person', line.includes('Ayaan') && !line.includes('{n}'), line);

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
