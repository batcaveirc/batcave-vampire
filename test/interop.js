// Python signs it, JavaScript must accept it.
//
// This is the one test neither side can do alone, and the failure it guards
// against is silent: Luna would keep sending reports, Dracula would keep
// refusing them as forgeries, and the only symptom would be that nobody is ever
// promoted — which is exactly the symptom of the bug this whole feature exists
// to fix. It would look like the feature simply did not work.
//
// So the real Python module signs a real report here, and the real JavaScript
// verifier reads it. No fixtures, no hand-typed signature on either side.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { verifyReport } = require('../attendance.js');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const COG = path.join(__dirname, '..', '..', 'luna-live', 'cogs', 'attendance_cog.py');
if (!fs.existsSync(COG)) {
    console.log('  [SKIP] Luna is not checked out beside this repo');
    process.exit(0);
}

const SECRET = 'both-sides-hold-this';
// Import the cog's signing without importing discord.py, which is not installed
// here: the two functions under test are pure and depend on nothing else.
const py = `
import hashlib, hmac, re, sys, time, json
src = open(${JSON.stringify(COG)}).read()
ns = {}
# Take the two pure functions out of the module rather than importing it, so
# this does not need discord.py present just to check an HMAC.
start = src.index('def _sign(')
end = src.index('class AttendanceCog')
exec('import hashlib, hmac, re, time\\n_NICK_OK = re.compile(r"^[A-Za-z0-9_\\\\[\\\\]{}\\\\\\\\^\`|.-]{1,32}$")\\n' + src[start:end], ns)
days = {'aishwarya': 11, 'khadus': 21, 'driveby': 2}
print(json.dumps({
  'line': ns['encode_report'](${JSON.stringify(SECRET)}, days),
  'stale': ns['encode_report'](${JSON.stringify(SECRET)}, days, int(time.time()*1000) - 3*3600*1000),
  'wrong': ns['encode_report']('not-the-secret', days),
}))
`;
let got;
try {
    got = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
} catch (e) {
    console.log(`  [FAIL] could not run the Python side — ${e.message}`);
    process.exit(1);
}

console.log('— a report signed by the real Python module —');
const ok = verifyReport(got.line, SECRET);
c('is accepted by the real JavaScript verifier', ok.ok,
  `${ok.why} :: ${got.line}`);
c('with the day counts intact',
  ok.days.get('aishwarya') === 11 && ok.days.get('khadus') === 21 && ok.days.get('driveby') === 2,
  JSON.stringify([...ok.days]));

console.log('\n— and the refusals hold across the languages too —');
c('a Python report signed with the wrong secret is refused',
  !verifyReport(got.wrong, SECRET).ok);
c('and one Python dated three hours ago is refused', !verifyReport(got.stale, SECRET).ok,
  verifyReport(got.stale, SECRET).why);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
