// Outbound pacing — why the bot kept being killed and reconnecting.
//
//   ← Dracula has left (RecvQ exceeded)
//   → Dracula has joined
//
// RecvQ is the SERVER's buffer of what we have sent it. That kill means the
// bot outran the server, not that the network dropped — and it was happening
// repeatedly, in front of the room.
//
// The bucket allowed a burst of 10 and refilled every 200ms: five lines a
// second, sustained, which is around five times what an ircd accepts from a
// client. It also explains the OTHER complaint — moderation feeling slow —
// because a voice sweep of twenty arrivals was twenty separate lines queued
// behind each other.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— the rate an ircd will accept —');
const burst = /const BURST = (\d+);/.exec(src);
const refill = /const REFILL_MS = (\d+);/.exec(src);
c('there is a declared burst and refill', !!burst && !!refill);
const b = burst ? Number(burst[1]) : 99;
const r = refill ? Number(refill[1]) : 0;
// Two a second, not one. One was safe and made the bot feel broken: thirty
// commands answered in sequence left the last person waiting fifteen seconds.
// The safety now comes from three levers, not one — this rate, MODE lines
// merged four-to-a-line below, and answers jumping ahead of sweeps — so the
// bot sends far less than the five a second that got it killed while replying
// to a person faster than it used to.
c('sustained rate is well under the five/sec that got it killed', r >= 400,
  `a token every ${r}ms = ${(1000 / r).toFixed(1)}/sec`);
c('but not so slow that answers crawl', r <= 800, `${r}ms between lines`);
c('the burst stays small', b <= 8, `burst ${b}`);
c('keepalives still bypass the queue entirely', /\^\(PONG\|PING\|QUIT\)/.test(src),
  'a PONG stuck behind a voice sweep is a four-minute ping timeout');

console.log('— fewer lines, not just slower ones —');
// From isReply, not takeNextLine: takeNextLine CALLS isReply, and slicing
// from the later of the two extracted a function whose dependency was missing.
// ...and the same trap again, one dependency further back: isReply now consults a
// const declared ABOVE it, so slicing from the function left that undefined. Start
// from the first thing the extracted code needs, not from the function under test.
const from = src.indexOf('const UNSOLICITED') >= 0
    ? src.indexOf('const UNSOLICITED') : src.indexOf('function isReply');
const body = src.slice(from, src.indexOf('function send(data)'));
c('MODE changes are coalesced', body.length > 200 && /targets\.join\(' '\)/.test(body));

const outQueue = [
    'MODE #batcave +v a', 'MODE #batcave +v b', 'MODE #batcave +v c',
    'MODE #batcave +v d', 'MODE #batcave +v e',
    'MODE #batcave -v f', 'PRIVMSG #x :hi', 'MODE #other +v g',
];
const outUrgent = [];
const takeNextLine = new Function('outQueue', 'outUrgent',
    body + '; return takeNextLine;')(outQueue, outUrgent);
const got = [];
while (outQueue.length) got.push(takeNextLine());

c('twenty voices become five lines, not twenty',
  got.includes('MODE #batcave +vvvv a b c d'), got.join(' | '));

console.log('— and a person never waits behind bookkeeping —');
c('the reply is drained FIRST, ahead of the sweeps it was queued behind',
  got[0] === 'PRIVMSG #x :hi',
  got.join(' | ') + ' — this is why answers got faster while total traffic fell');
c('it stops at a change of sign', got.some((l) => l === 'MODE #batcave -v f'), got.join(' | '));
c('it stops at a different channel', got.some((l) => l === 'MODE #other +v g'), got.join(' | '));
c('and never merges anything that is not a MODE', got.includes('PRIVMSG #x :hi'), got.join(' | '));
c('no line exceeds four targets',
  !got.some((l) => (l.match(/^MODE \S+ [+-](\w+)/) || [, ''])[1].length > 4), got.join(' | '));

console.log('\n— what jumps the queue, and what must not —');
// The bug this pins: a moderator asked for a kick and it arrived 1.6s later,
// behind two notices and a line to the room. MODE was not in the priority set at
// all, so every announcement outranked the mode change it was announcing — the
// room saw "troll42 de-voiced" a full second before the -v that did it.
const isReply2 = new Function(body + '; return isReply;')();
c('a kick ranks as something somebody is waiting for', isReply2('KICK #batcave troll42 :reason'));
c('and an answer to a person', isReply2('NOTICE boss :here you go'));
// A MODE is deliberately NOT ranked by its text: a bulk voice sweep is a MODE
// too, and ranking them all as answers let routine housekeeping outrank
// somebody's question. Urgency is set by the CALL instead.
c('a bare mode change does not rank by its text', !isReply2('MODE #batcave +v somebody'),
  'a voice sweep must not outrank a question');
c('sendFirst exists for the actions that do', /function sendFirst/.test(src));
c('and a kick uses it', /sendFirst\(`KICK \$\{chan\} \$\{nick\}/.test(src),
  'measured: a kick a moderator asked for arrived 1.6s late, behind its own notices');
c('as does an ordered devoice', /case 'devoice': sendFirst/.test(src));

// The property that made all of this necessary: an urgent action is drained
// before a reply already sitting in the ordinary queue. Front-inserting was not
// enough — the answers-first promotion searched for the first reply-like line and
// moved it to index 0, stepping straight over the mode change beneath it.
outQueue.length = 0;
outQueue.push('PRIVMSG #x :announcing the devoice', 'WHO #x');
outUrgent.push('MODE #x -v troll42');
c('an action jumps a reply that was already queued',
  takeNextLine() === 'MODE #x -v troll42',
  'the room must not read about an action before the action happens');
// The other half: reports we send because something happened, not because anybody
// asked, must not be promoted ahead of real moderation.
c('an unsolicited report does NOT jump the queue',
  !isReply2('NOTICE boss :\x0307[HOLD]\x03 somebody is unvoiced'),
  'a batch of these jumped ahead of a kick a moderator had just asked for');
c('nor a trust report', !isReply2('NOTICE boss :\x0306[TRUST]\x03 promoted somebody'));
c('but a plain notice to a person still does', isReply2('NOTICE boss :the answer is 4'));

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
