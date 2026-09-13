// The regulars feed, attacked rather than demonstrated.
//
// "Here is the list of people you should trust" is the most useful message an
// attacker on this network could forge, so most of this file is attempts to
// forge one. The happy path is three lines at the top; everything after it is
// the refusals, which are the part that has to be right.
const {
    Attendance, encodeReport, verifyReport, sign, MAX_DAYS,
} = require('../attendance.js');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const SECRET = 'a-shared-secret';
const days = new Map([['aishwarya', 9], ['khadus', 21], ['driveby', 1]]);

console.log('— a genuine report —');
const line = encodeReport(SECRET, days);
const got = verifyReport(line, SECRET);
c('is accepted', got.ok, got.why);
c('and carries the day counts', got.days.get('aishwarya') === 9 && got.days.get('khadus') === 21,
  JSON.stringify([...got.days]));
c('lowercased, because a relay sees whatever case they typed',
  verifyReport(encodeReport(SECRET, new Map([['AishWarya', 4]])), SECRET).days.get('aishwarya') === 4);

console.log('\n— forgeries —');
c('an unsigned list is refused',
  !verifyReport('REGULARS 1 aishwarya:99 ' + '0'.repeat(32), SECRET).ok);
c('a list signed with the WRONG secret is refused',
  !verifyReport(encodeReport('not-the-secret', days), SECRET).ok,
  'this is the whole point of the signature');
c('and the refusal says why', /signature/.test(verifyReport(encodeReport('nope', days), SECRET).why));
// The body is signed WITH the timestamp in it, so neither half can be changed.
const tampered = line.replace('aishwarya:9', 'aishwarya:99');
c('editing a count after signing is refused', !verifyReport(tampered, SECRET).ok,
  'the count is inside the signed body');
const [, ts, payload, sig] = line.match(/^REGULARS (\d+) (\S*) ([0-9a-f]{32})$/);
c('moving a good signature onto a different timestamp is refused',
  !verifyReport(`REGULARS ${Number(ts) + 1} ${payload} ${sig}`, SECRET).ok);

console.log('\n— replay —');
const old = encodeReport(SECRET, days, Date.now() - 3 * 3600 * 1000);
c('a report captured hours ago is refused today', !verifyReport(old, SECRET).ok, verifyReport(old, SECRET).why);
c('and so is one dated in the FUTURE',
  !verifyReport(encodeReport(SECRET, days, Date.now() + 3 * 3600 * 1000), SECRET).ok,
  'a clock-skewed or hand-rolled timestamp widens the replay window');

console.log('\n— no secret at all —');
// The dangerous default. An empty secret must mean "trust nothing", never
// "skip the check" — an empty allow-list secret silently disabling an auth
// check has already happened twice in this project.
c('with no secret configured, nothing is accepted',
  !verifyReport(line, '').ok && !verifyReport(line, []).ok,
  'an empty secret must never mean "skip the check"');
c('and it says so rather than failing silently',
  /no PEER_SECRET/.test(verifyReport(line, '').why));

console.log('\n— rubbish in the payload —');
const weird = new Map([['ok_one', 5], ['has space', 9], ['sneaky:colon', 3], ['', 2]]);
const w = verifyReport(encodeReport(SECRET, weird), SECRET);
c('a valid nick still arrives', w.ok && w.days.get('ok_one') === 5, JSON.stringify([...w.days]));
c('a nick with a space is dropped, not defaulted', !w.days.has('has space'));
c('and an empty nick is dropped', !w.days.has(''));
c('counts are bounded',
  verifyReport(encodeReport(SECRET, new Map([['x', 99999]])), SECRET).days.get('x') === MAX_DAYS,
  'an unbounded count is a promotion waiting to happen');
c('a negative count cannot arrive',
  verifyReport(encodeReport(SECRET, new Map([['x', -5]])), SECRET).days.get('x') === 0);

console.log('\n— secret rotation —');
// The two bots restart independently, so a rotation always leaves a window
// where each is certain the other is an impostor. Accepting the previous key
// is what makes rotation survivable instead of an outage.
const withPrev = verifyReport(encodeReport('old-secret', days), ['new-secret', 'old-secret']);
c('the PREVIOUS secret is still accepted during a rotation', withPrev.ok, withPrev.why);
c('but an unrelated secret is not',
  !verifyReport(encodeReport('third-party', days), ['new-secret', 'old-secret']).ok);

console.log('\n— what the receiver keeps —');
const a = new Attendance();
c('it starts knowing nothing', a.size === 0 && a.daysFor('aishwarya') === 0);
c('an empty report does NOT wipe what we have',
  a.absorb(got.days) && !a.absorb(new Map()) && a.daysFor('khadus') === 21,
  'a partial or failed report silently demoting everybody is worse than no report');
c('and a fresh one replaces it wholesale',
  a.absorb(new Map([['aishwarya', 12]])) && a.daysFor('aishwarya') === 12 && a.daysFor('khadus') === 0);
c('it knows when it last heard anything', a.fresh() && !a.fresh(Date.now() + 48 * 3600 * 1000));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
