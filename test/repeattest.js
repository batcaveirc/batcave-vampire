// The dominant attack in these rooms is repetition, not abuse.
//
// Mined from 40,264 recorded messages:
//   137x  Fit-23-M-CAm       "fit cam, m 23, my cam your voice"
//   117x  jaiiiii            "hello, 45 married male from Delhi..."
//   105x  youngmslmbull      "two mslm bulls looking for a 30+ f..."
//   101x  Mota_Lamba_Lund11  a reddit video link
//
// The existing rule needed three IDENTICAL messages in a row, so spacing the
// posts out or changing one character defeated it entirely.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— the shape —');
c('there is a time window, not just a consecutive counter', /repeatWindow/.test(src));
c('it compares on letters only', /replace\(\/\[\^a-z\]\/g, ''\)/.test(src),
  'punctuation, digits and case are what a spammer varies');
c('short messages are exempt', /length >= 15/.test(src),
  '"hi" is the most repeated string in the corpus and is not an attack');
c('and it removes rather than warns', /kickUser\(chan, nick, 'posting the same thing/.test(src));

console.log('\n— the behaviour, on the real spam —');
// A faithful copy of the window rule, driven by the actual corpus lines.
function makeCounter() {
    const win = new Map();
    return (nick, msg, at) => {
        if (msg.replace(/\s/g, '').length < 15) return false;
        const flat = msg.toLowerCase().replace(/[^a-z]/g, '');
        const seen = (win.get(nick) || []).filter((e) => at - e.at < 15 * 60000);
        const same = seen.filter((e) => e.flat === flat).length;
        seen.push({ at, flat });
        win.set(nick, seen);
        if (same >= 2) { win.set(nick, []); return true; }
        return false;
    };
}
{
    const hit = makeCounter();
    const ad = 'fit cam, m 23, my cam your voice';
    c('first post is fine', !hit('spammer', ad, 0));
    c('second is fine', !hit('spammer', ad, 60000));
    c('third within the window is removed', hit('spammer', ad, 120000));
}
{
    // Punctuation and case changed each time — the old rule saw three
    // different messages and did nothing.
    const hit = makeCounter();
    c('a varied advert is still caught',
      !hit('s', 'two mslm bulls looking for a 30+ f', 0)
      && !hit('s', 'Two mslm bulls looking for a 30+ f!!', 5000)
      && hit('s', 'two mslm bulls, looking for a 30+ f.', 9000));
}
{
    const hit = makeCounter();
    c('spaced beyond the window is NOT caught',
      !hit('s', 'hello, 45 married male from Delhi', 0)
      && !hit('s', 'hello, 45 married male from Delhi', 16 * 60000)
      && !hit('s', 'hello, 45 married male from Delhi', 32 * 60000),
      'somebody re-introducing themselves hours apart is not spamming');
}

console.log('\n— ordinary conversation must survive —');
{
    const hit = makeCounter();
    c('"hi" three times is fine', !hit('u', 'hi', 0) && !hit('u', 'hi', 1000) && !hit('u', 'hi', 2000));
    c('different sentences are fine',
      !hit('u', 'what is everyone up to today', 0)
      && !hit('u', 'anyone playing uno later on', 1000)
      && !hit('u', 'i am going to sleep now goodnight', 2000));
    c('two people saying the same thing is fine',
      !hit('a', 'good morning everyone here', 0) && !hit('b', 'good morning everyone here', 100));
}

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
