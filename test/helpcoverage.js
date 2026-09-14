// Everything the bot can DO must be findable in !!help.
//
// everycommand.js checks the other direction — that nothing advertised is dead.
// This is the direction that actually bit: the owner went looking for FindIt and
// it was not in the help at all. "Built but unadvertised" and "advertised but
// dead" are the same bug twice, and a command only findable by reading the source
// is not discoverable by anybody in the room.
//
// There are THREE dispatch surfaces, which is how this drifted: the main switch,
// fun.handle(), and game.handle() in findit.js. Help was written against the
// first one and nobody noticed the other two.
const fs = require('fs');
const path = require('path');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'action-bot.js'), 'utf8');
const funSrc = fs.readFileSync(path.join(root, 'fun.js'), 'utf8');
const gameSrc = fs.readFileSync(path.join(root, 'findit.js'), 'utf8');

// ── every command the bot answers ───────────────────────────────────────────
const orderAt = src.indexOf('function handleOrder(');
const cmdAt = src.indexOf('function handleCommand(');
const fromSwitch = new Set([...src.slice(cmdAt).matchAll(/^\s+case '([a-z0-9]+)':/gm)]
    .map((m) => m[1]));
// The spoken verbs: "Dracula kick bob". A whole interface that was documented
// nowhere until the owner went looking for a command and could not find one.
const spokenVerbs = new Set([...src.slice(orderAt, cmdAt).matchAll(/^\s+case '([a-z0-9]+)':/gm)]
    .map((m) => m[1]));
const funList = (funSrc.match(/const commands = \[([\s\S]*?)\];/) || [, ''])[1];
const fromFun = new Set([...funList.matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]));
const fromGame = new Set([...gameSrc.matchAll(/cmd === '([a-z0-9]+)'|case '([a-z0-9]+)':/g)]
    .map((m) => m[1] || m[2]));

// ── what !!help advertises ──────────────────────────────────────────────────
const helpBody = src.slice(src.indexOf("case 'help': {"), src.indexOf("case 'seen': {"));
const advertised = new Set([...helpBody.matchAll(/!!([a-z0-9]+)/g)].map((m) => m[1]));

// Deliberately not advertised, each with a reason. Anything NOT on this list and
// not in help is a failure — that is the point.
const UNLISTED = new Map([
    ['help', 'it is the help itself'],
    ['whitelist', 'a deprecation notice that points at !!trust; advertising it twice is noise'],
    ['endgame', 'an operator ending a round; reachable but not worth a line'],
    // findit.js drives a round once it has started, and the round announces
    // these itself as it goes. Listing thirteen of them would bury everything.
    ['go', 'announced by the round in progress'],
    ['tasks', 'announced by the round in progress'],
    ['report', 'announced by the round in progress'],
    ['meeting', 'announced by the round in progress'],
    ['vote', 'announced by the round in progress'],
    ['kill', 'announced by the round in progress'],
    ['fix', 'announced by the round in progress'],
    ['break', 'announced by the round in progress'],
    ['players', 'announced by the round in progress'],
    ['start', 'announced by the round in progress'],
]);

const all = new Set([...fromSwitch, ...fromFun, ...fromGame]);
console.log(`— ${all.size} commands across ${[fromSwitch.size, fromFun.size, fromGame.size].join(' + ')} surfaces —`);

const missing = [...all].filter((cmd) => !advertised.has(cmd) && !UNLISTED.has(cmd)).sort();
c('every command the bot answers is in !!help',
  missing.length === 0,
  `not advertised: ${missing.map((m) => '!!' + m).join(' ')}`);

// The reverse, so help cannot advertise something that does not exist. This is
// what everycommand.js drives live; here it is the cheap static half.
const ghosts = [...advertised].filter((cmd) => !all.has(cmd)).sort();
c('and nothing in !!help is missing a handler',
  ghosts.length === 0, `advertised with no handler: ${ghosts.map((g) => '!!' + g).join(' ')}`);

console.log('\n— the spoken orders are documented too —');
// These take no "!!", so they cannot be found by searching help for one.
const helpText = helpBody.replace(/\s+/g, ' ');
const undocumented = [...spokenVerbs].filter((v) => !new RegExp(`\\b${v}\\b`).test(helpText)).sort();
c('every spoken verb appears in !!help', undocumented.length === 0,
  `not documented: ${undocumented.join(' ')}`);
c('and help says they need no !!', /no !!|Plain English/i.test(helpText),
  'somebody reading help will otherwise type !!kick, which does not exist');
c('none of them is advertised WITH a !!',
  ![...spokenVerbs].some((v) => advertised.has(v)),
  [...spokenVerbs].filter((v) => advertised.has(v)).map((v) => '!!' + v).join(' ')
    + ' — advertised and dead is the bug this file exists to prevent');

console.log('\n— the three surfaces are all still there —');
c('the main switch has commands', fromSwitch.size > 20, String(fromSwitch.size));
c('fun.js still exposes its list', fromFun.size >= 10, String(fromFun.size));
c('findit.js still exposes its list', fromGame.size >= 8, String(fromGame.size));
c('FindIt itself is advertised', advertised.has('findit'),
  'the owner went looking for it and it was not there');

console.log('\n— help stays readable —');
// IRC drops a line past ~512 bytes and the bot chunks at 380, so a help line
// that grows without limit arrives in pieces mid-word.
const lines = [...helpBody.matchAll(/reply\(([\s\S]*?)\);/g)].map((m) => m[1]);
const longest = Math.max(...lines.map((l) => l.replace(/[^\x20-\x7e]/g, '').length));
c('no single help line is absurdly long', longest < 900, `longest ${longest} chars`);

console.log('\n— answers are private, and help says so —');
// Settled by the owner after both were tried live: "this should appear as notice
// it shouldnt be seen by other users." The reason it had looked broken was never
// the destination — it was that nothing said where the answers go. So they stay
// private and the bot says so, in the topic and in help's own first line.
const cmdFn = src.slice(cmdAt, src.indexOf('function ', cmdAt + 40));
c('a command answers the person, not the room',
  /const reply = \(m\) => \(toChannel \? say\(chan, m\) : notice\(nick, m\)\)/.test(cmdFn),
  'a help listing pasted into the channel makes every command an interruption');
c('and CMD_REPLY can flip it for a room that wants them visible',
  /CMD_REPLY/.test(cmdFn));
c('help says where its own answer went',
  /answer commands .*here, privately/.test(helpBody),
  'silence with no explanation was reported as a broken bot, twice');
c('and the topic says it too, for anyone who never runs help',
  /private notice, not in the room/.test(src),
  'one permanent place to say it, rather than a line after every command');

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
