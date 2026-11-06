'use strict';
// Proactive idle chat, second half: the bot notices a PERSON, not a silence.
//
// The old trigger asked the room at large ("anyone around?") whenever it had
// been quiet, which is indistinguishable from a connection check. What a
// regular does instead is notice one specific person who has sat there without
// saying anything. That is the behaviour these assertions pin down — including
// who it must never pick.
const fs = require('fs');
const path = require('path');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
const packed = src.replace(/\s+/g, ' ');

const pickAt = src.indexOf('function quietestHere(');
const breakAt = src.indexOf('function maybeProactiveIdleBreak(');
const picker = src.slice(pickAt, breakAt);
const trigger = src.slice(breakAt, src.indexOf('function pruneMemory(', breakAt));

console.log('— there is a picker for the quietest person here —');
c('quietestHere() exists before the idle trigger', pickAt > 0 && breakAt > pickAt,
  pickAt < 0 ? 'missing entirely' : 'defined after its caller');
c('it is bounded by the same idle window as the trigger',
  /quietMs < PROACTIVE_IDLE_MS/.test(picker),
  'a person who spoke a minute ago is not idle, whatever the room is doing');
c('it never picks the bot itself', /n === String\(currentNick\)\.toLowerCase\(\)/.test(picker));
c('it never picks another bot', /isOneOfOurs\(nick\)/.test(picker),
  'the fleet reports status in the room; it must not be chatted up');
c('it only considers people PRESENT in that room',
  /members\.get\(ch\)/.test(picker) && /for \(const nick of/.test(picker));
c('and it reports the longest silence, not the first found',
  /quietMs > best\.quietMs/.test(picker));

console.log('\n— the line is addressed to that person —');
c('the trigger asks the picker for somebody', /const quiet = quietestHere\(home\)/.test(trigger));
c('no quiet person means no line at all',
  /if \(!quiet\) return;/.test(trigger),
  'a generic line in a quiet room is the machine-checking-its-connection tell');
c('the prompt names them explicitly', /Say ONE line TO \$\{quiet\.nick\}/.test(trigger),
  'the model must be told who it is talking to');
c('and forbids the empty greeting the persona rules already reject',
  /not a greeting/.test(trigger));
c('the prompt still says it is ONE line', /ONE line/.test(trigger));

console.log('\n— it goes through the budgeted path —');
c('the idle trigger still spends budget through fireProactive',
  /fireProactive\(ctx, 'idle-person'\)/.test(trigger),
  'bypassing fireProactive bypasses the global gap and the AI budget');
c('and it announces itself under its own source name',
  /'idle-person'/.test(trigger) && !/'idle-break'/.test(trigger),
  'the log must say which trigger fired');
c('the room still has to have people in it',
  /PROACTIVE_IDLE_MIN_PRESENT/.test(trigger));
c('and the whole thing is still behind PROACTIVE_ON',
  /if \(!PROACTIVE_ON\) return;/.test(trigger));
c('the picker is reachable from the source at all', packed.includes('function quietestHere('));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
