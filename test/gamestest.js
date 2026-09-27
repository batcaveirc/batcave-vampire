'use strict';
// The party games (numguess to start), hosted in the games room.
//
// The one behaviour that matters beyond the game logic: a game command used
// OUTSIDE the games room must not start a game talking to an empty room — it
// invites the caller to the games room instead. And a plain guess must only be
// consumed in the games room, or it would eat ordinary chat elsewhere.
process.env.FINDIT_ROOM = '#batcave-games';
const { Games } = require('../games');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

function fakeBot() {
    const sent = [], said = [];
    return {
        sent, said,
        send: (l) => sent.push(l),
        say: (chan, m) => said.push([chan, m]),
        notice: (nick, m) => sent.push(`NOTICE ${nick} :${m}`),
        get nick() { return 'Dracula'; },
    };
}

console.log('— a game command outside the games room invites you there —');
let bot = fakeBot();
let g = new Games(bot);
let took = g.handle('vikram', '#batcave', 'numguess', []);
c('it is handled', took);
c('it INVITEs the caller to the games room, not start a game in #batcave',
  bot.sent.some((l) => l.startsWith('INVITE vikram #batcave-games')), JSON.stringify(bot.sent));
c('and starts no game in the wrong room', bot.said.length === 0, JSON.stringify(bot.said));

console.log('\n— in the games room it starts, and guesses get higher/lower —');
bot = fakeBot();
g = new Games(bot);
g.handle('vikram', '#batcave-games', 'numguess', []);
c('it announces the game in the room', bot.said.some(([ch]) => ch === '#batcave-games'));
// Reach into state to make the test deterministic.
const st = g.numguess.get('#batcave-games');
c('a game is now live', !!st);
st.answer = 50;
bot.said.length = 0;
g.onMessage('nora', '#batcave-games', '25');
c('a low guess says Higher', bot.said.some(([, m]) => /Higher/.test(m)), JSON.stringify(bot.said));
bot.said.length = 0;
g.onMessage('nora', '#batcave-games', '75');
c('a high guess says Lower', bot.said.some(([, m]) => /Lower/.test(m)));
bot.said.length = 0;
const won = g.onMessage('nora', '#batcave-games', '50');
c('the exact answer wins and names the winner',
  won && bot.said.some(([, m]) => /nora/.test(m) && /50/.test(m)), JSON.stringify(bot.said));
c('and the game is cleared after a win', !g.numguess.has('#batcave-games'));

console.log('\n— guesses are only consumed in the games room, and only if numeric —');
bot = fakeBot();
g = new Games(bot);
g.handle('vikram', '#batcave-games', 'numguess', []);
c('a bare number is consumed (returns true)', g.onMessage('x', '#batcave-games', '42') === true);
c('ordinary chat is NOT consumed', g.onMessage('x', '#batcave-games', 'hello there') === false);
c('a number in a DIFFERENT room is ignored', g.onMessage('x', '#batcave', '42') === false,
  'onMessage must not eat chat outside the games room');

console.log('\n— endgame stops it —');
bot = fakeBot();
g = new Games(bot);
g.handle('vikram', '#batcave-games', 'numguess', []);
c('endgame in the games room stops the game',
  g.handle('vikram', '#batcave-games', 'endgame', []) && !g.numguess.has('#batcave-games'));
c('endgame elsewhere is not ours', g.handle('vikram', '#batcave', 'endgame', []) === false);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
