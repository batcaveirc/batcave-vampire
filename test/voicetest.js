// The tells, each one asserted.
//
// The owner asked for the bot to read as a person. The failure was not tone: the
// chat path sent one message with no history, so every line was answered cold and
// a follow-up question met a bot that had already forgotten the first one.
const {
    transcript, needsName, typingDelay, deRobot, isRepeat,
} = require('../voice.js');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
const now = Date.now();
const L = (nick, msg, agoMs = 0) => ({ at: now - agoMs, nick, msg });

console.log('— it can see the conversation —');
const log = [
    L('meds', 'tu suna kuch unique', 60000),
    L('Dracula', 'nothing worth repeating', 55000),
    L('mesme', 'chalo na vc chale', 50000),
    L('meds', 'kaun aayega', 20000),
];
const t = transcript(log, { me: 'dracula', now });
c('oldest line first, because that is the order it happened',
  t.indexOf('tu suna') < t.indexOf('kaun aayega'), t);
c('our own lines are labelled as ours, so it does not repeat them',
  /^you: nothing worth repeating$/m.test(t), t);
c('and other people keep their names', /meds: kaun aayega/.test(t), t);

console.log('\n— and only the recent part of it —');
c('a line from an hour ago is not context',
  !transcript([L('old', 'ancient history', 3600000), L('meds', 'now', 0)],
              { me: 'd', now }).includes('ancient'),
  'stale context makes it answer a question nobody asked any more');
c('it stays within a token budget, keeping the NEWEST lines',
  (() => {
      const many = Array.from({ length: 40 }, (_, i) => L('p', `line ${i} ${'x'.repeat(60)}`, 1000));
      const got = transcript(many, { me: 'd', now, limit: 8, budget: 400 });
      return got.length <= 400 && got.includes('line 39');
  })(), 'trimming the newest lines would drop the part that matters');
c('an empty log is empty, not a crash', transcript([], { me: 'd' }) === ''
  && transcript(null, { me: 'd' }) === '');

console.log('\n— "nick:" in front of every line —');
c('not needed in a two-person exchange',
  !needsName([L('meds', 'and?', 0)], 'meds'),
  'nobody types the other person’s name every line');
c('but needed once somebody else has spoken',
  needsName([L('meds', 'and?', 0), L('king', 'oye', 0)], 'meds'),
  'otherwise the room cannot tell who is being answered');
c('and safe with nothing to go on', !needsName([], 'meds') && !needsName(null, 'meds'));

console.log('\n— it does not answer in 400ms every time —');
const d1 = typingDelay('haan', () => 0.5);
const d2 = typingDelay('x'.repeat(200), () => 0.5);
c('a longer reply takes longer', d2 > d1, `${d1} vs ${d2}`);
c('never instant', typingDelay('k', () => 0) >= 600, String(typingDelay('k', () => 0)));
c('never a stall', typingDelay('x'.repeat(2000), () => 1) <= 5200,
  String(typingDelay('x'.repeat(2000), () => 1)));
c('and it varies', typingDelay('hello there', () => 0.1) !== typingDelay('hello there', () => 0.9));
// The ceiling is configurable. It was a fixed 5.2s, which is a fine value for a
// room and an impossible one for a test — nobotchat.js waits 2.5s and so failed
// about one run in three, on an assertion about something else entirely.
c('the ceiling can be lowered', typingDelay('x'.repeat(400), () => 1, 800) === 800,
  String(typingDelay('x'.repeat(400), () => 1, 800)));
c('and switched off entirely', typingDelay('hello', () => 0.5, 0) === 0,
  'a room that wants instant answers should be able to have them');
c('a cap below the floor still wins', typingDelay('k', () => 0, 50) <= 50,
  String(typingDelay('k', () => 0, 50)));

console.log('\n— the document polish comes off —');
c('stage directions go', deRobot('*smiles darkly* haan bol', () => 1) === 'haan bol',
  deRobot('*smiles darkly* haan bol', () => 1));
c('a name the model echoed at the front goes',
  deRobot('Meds: kuch nahi yaar', () => 1) === 'kuch nahi yaar',
  deRobot('Meds: kuch nahi yaar', () => 1));
// Only the colon form. Matching "word, " too meant ordinary speech lost its
// first word: "haan, bol" became "bol".
c('but a comma opener is left alone — that is how people talk',
  deRobot('haan, bol kya hua', () => 1) === 'haan, bol kya hua',
  deRobot('haan, bol kya hua', () => 1));
c('em dashes become something people type',
  deRobot('yes — of course', () => 1) === 'yes - of course',
  deRobot('yes — of course', () => 1));
c('a short line loses its full stop', deRobot('bilkul nahi.', () => 1) === 'bilkul nahi',
  deRobot('bilkul nahi.', () => 1));
c('a long one keeps it',
  deRobot('that is a long sentence with rather a lot of words in it.', () => 1).endsWith('.'));
c('"Ah," openers are usually dropped', deRobot('Ah, interesting', () => 0.1) === 'interesting',
  deRobot('Ah, interesting', () => 0.1));
c('but not always, or that becomes its own pattern',
  deRobot('Ah, interesting', () => 0.99).startsWith('Ah'),
  deRobot('Ah, interesting', () => 0.99));
c('empty in, empty out', deRobot('', () => 1) === '' && deRobot(null, () => 1) === '');

console.log('\n— repeating itself is the loudest tell —');
const ours = ['the night is long and you are not part of it', 'haan'];
c('the same line twice is caught',
  isRepeat('The night is long and you are not part of it.', ours));
c('and a lightly reshuffled version too',
  isRepeat('you are not part of it, the night is long', ours),
  'the same clever line twice is worse than a dull one once');
c('a genuinely different line is fine',
  !isRepeat('kal milte hain phir', ours));
c('short replies are not policed — "haan" twice is normal speech',
  !isRepeat('haan', ours) && !isRepeat('ok', ours),
  'people do repeat themselves in small words; that is not the tell');

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
