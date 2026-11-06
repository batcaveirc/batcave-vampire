'use strict';
// The server said we flooded it. What happens next has to be gentler than what
// got us killed, or the reconnect is just the same burst with a new address.
const { isFloodComplaint, reconnectDelayMs, refillMultiplier, penaltyMs } = require('../floodguard');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— the complaint is recognised, and ordinary lines are not —');
for (const line of [
    'ERROR :Closing Link: Dracula[~d@host] (RecvQ exceeded)',
    'ERROR :Closing Link: (Excess Flood)',
    ':server NOTICE Dracula :*** You are flooding (5 lines/sec)',
    'ERROR :Closing Link: throttled',
]) c(`flood: ${line.slice(0, 46)}`, isFloodComplaint(line));

for (const line of [
    'ERROR :Closing Link: Dracula[~d@host] (Ping timeout)',
    'PING :srv',
    ':nora!u@h PRIVMSG #batcave :the room is flooding with memes',
    'ERROR :Closing Link: (Banned)',
]) c(`not a kill for OUR flooding: ${line.slice(0, 40)}`, !isFloodComplaint(line));

console.log('\n— the reconnect backs off, and keeps backing off —');
const first = reconnectDelayMs(1);
const second = reconnectDelayMs(2);
const third = reconnectDelayMs(3);
c('one complaint waits before rejoining', first >= 5000, `${first}ms`);
c('a second waits longer than the first', second > first, `${first} → ${second}`);
c('a third longer again', third > second, `${second} → ${third}`);
c('and it is capped rather than growing forever', reconnectDelayMs(50) <= 10 * 60 * 1000,
  `${reconnectDelayMs(50)}ms`);
c('a nonsense count is treated as none, not as NaN seconds',
  Number.isFinite(reconnectDelayMs('x')) && reconnectDelayMs('x') <= 5000,
  String(reconnectDelayMs('x')));

console.log('\n— the pace slows while on notice, but never stops —');
c('no complaints leaves the pace alone', refillMultiplier(0) === 1);
c('one complaint halves it', refillMultiplier(1) === 2, String(refillMultiplier(1)));
c('two thirds it', refillMultiplier(2) === 3);
c('but it is capped so the bot still answers', refillMultiplier(99) === 4, String(refillMultiplier(99)));

console.log('\n— the penalty expires rather than lasting forever —');
c('it is at least a quarter of an hour', penaltyMs(1) >= 15 * 60 * 1000, String(penaltyMs(1)));
c('repeated kills extend it', penaltyMs(2) > penaltyMs(1));
c('and it tops out at an hour', penaltyMs(99) <= 60 * 60 * 1000, String(penaltyMs(99)));

console.log('\n— and the bot actually acts on it —');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
const wired = src.slice(src.indexOf('function registerFloodComplaint'),
                        src.indexOf('function takeNextLine'));
c('a server complaint is recognised where ERROR lines are handled',
  /if \(isFloodComplaint\(line\)\) registerFloodComplaint\(line\)/.test(src));
c('the refill slows while on notice', /refillTick % floodMultiplier\(\)/.test(src));
c('the reconnect uses the flood backoff as a floor',
  /Math\.max\(backoff, reconnectDelayMs\(floodComplaints\)\)/.test(src),
  'an immediate reconnect is the same burst at a fresh connection');
c('a reconnect does not reopen with a full burst',
  /tokens = inFloodPenalty\(\) \? 1 : BURST/.test(src));
c('the bulk queue is dropped when the server objects',
  /outQueue\.length = 0/.test(wired));
c('a complaint never exits the process', !/process\.exit/.test(wired),
  'a kill is not a reason to quit — exiting is how the room loses its bot');
c('the escalation is forgiven after a clean session',
  /floodComplaints = 0/.test(src) && /clean ten-minute session/.test(src));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
