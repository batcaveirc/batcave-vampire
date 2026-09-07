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
const body = src.slice(src.indexOf('function isReply'), src.indexOf('function send(data)'));
c('MODE changes are coalesced', body.length > 200 && /targets\.join\(' '\)/.test(body));

const outQueue = [
    'MODE #batcave +v a', 'MODE #batcave +v b', 'MODE #batcave +v c',
    'MODE #batcave +v d', 'MODE #batcave +v e',
    'MODE #batcave -v f', 'PRIVMSG #x :hi', 'MODE #other +v g',
];
const takeNextLine = new Function('outQueue', body + '; return takeNextLine;')(outQueue);
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

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
