'use strict';
// !!shoot — a nick goes up as the target and the room types "shoot" at it.
//
// What matters here is not the flavour text. It is that the game cannot remove
// somebody it should not: no self, no fleet, no staff, nobody twice in a day,
// and never without the spare window having passed. A kick is a kick even when
// it arrives with a punchline, and the rails are the whole feature.
//
// The clock and the dice are injected, so every roll below is a number in this
// file rather than a race against a timer.
const { Shoot } = require('../shoot');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

function rig(opts = {}) {
    const said = [];
    const notices = [];
    const kicks = [];
    let t = 1_000_000;
    const rolls = (opts.rolls || []).slice();
    let ri = 0;
    const bot = {
        nick: 'Dracula',
        say: (chan, m) => said.push([chan, m]),
        notice: (nick, m) => notices.push([nick, m]),
        send: () => {},
    };
    const game = new Shoot(bot, {
        enabled: opts.enabled,
        kickOn: opts.kickOn,
        now: () => t,
        random: () => (ri < rolls.length ? rolls[ri++] : 0.99),
        present: () => opts.present || ['Dracula', 'vikram', 'nora', 'samosa'],
        // The owner is protected, exactly as the wiring protects OWNERS/ADMINS.
        eligible: (n) => !/^vikram$/i.test(n),
        isOurs: (n) => /^(luna1|carmilla)$/i.test(n),
        mayMod: () => true,
        kick: (chan, nick, reason) => kicks.push([chan, nick, reason]),
        notice: (nick, m) => notices.push([nick, m]),
    });
    return { game, said, notices, kicks, at: () => t, advance: (ms) => { t += ms; return t; } };
}

console.log('— a target goes up, and never wears our own name —');
{
    const r = rig({ rolls: [0.99] });
    c('!!shoot with nothing up puts a target up', r.game.handle('nora', '#batcave', 'shoot', []) === true);
    c('the room is told what to type', r.said.some(([, m]) => /TARGET/.test(m) && /shoot/.test(m)),
      JSON.stringify(r.said));
    c('the bot is not its own target', r.game.round && r.game.round.target !== 'Dracula');
    c('the target is somebody in the room', ['vikram', 'nora', 'samosa'].includes(r.game.round.target));

    const fleet = rig({ present: ['Dracula', 'luna1', 'nora'], rolls: [0] });
    fleet.game.handle('nora', '#batcave', 'shoot', []);
    c('a standby is never the target', fleet.game.round.target === 'nora',
      `picked ${fleet.game.round && fleet.game.round.target}`);
}

console.log('\n— a hit kills the target and counts —');
{
    const r = rig({ rolls: [0.99, 0.99, 0.99, 0] });
    r.game.handle('nora', '#batcave', 'shoot', []);          // opens the round
    const victim = r.game.round.target;
    r.said.length = 0;
    r.game.handle('nora', '#batcave', 'shoot', []);          // fires
    c('the kill is announced with both names',
      r.said.some(([, m]) => m.includes(victim) && m.includes('nora')), JSON.stringify(r.said));
    c('the round is over', r.game.round === null);
    const st = r.game.stats.get('nora');
    c('it counts as one shot and one kill', st.shots === 1 && st.kills === 1, JSON.stringify(st));
    c('and one in a row', st.streak === 1 && st.best === 1);
}

console.log('\n— a dodge is a miss, and a miss costs the room —');
{
    const r = rig({ rolls: [0.99, 0, 0, 0] });               // target pick, dodge, line, victim
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.said.length = 0;
    r.game.handle('nora', '#batcave', 'shoot', []);
    c('the dodge names the target that slipped', r.said.some(([, m]) => /missed/.test(m)), JSON.stringify(r.said));
    const st = r.game.stats.get('nora');
    c('the miss is recorded and the streak is gone', st.misses === 1 && st.streak === 0, JSON.stringify(st));
    c('somebody is nominated to lose', !!r.game.pending, 'no penalty was scheduled at all');
    c('the nominee is a real, unprotected person', r.game.pending.victim === 'nora' || r.game.pending.victim === 'samosa',
      `chose ${r.game.pending && r.game.pending.victim}`);
    c('the room is told how to spare them',
      r.said.some(([, m]) => /spare/.test(m) && /!!shoot spare/.test(m)), JSON.stringify(r.said));

    r.advance(12_000);
    r.game.tick();
    c('after the grace window the removal happens once', r.kicks.length === 1, JSON.stringify(r.kicks));
    c('and it is a real kick with a reason', /lost the shooting game/.test(r.kicks[0][2]), JSON.stringify(r.kicks));
    r.game.tick();
    c('a second sweep does not kick twice', r.kicks.length === 1);
}

console.log('\n— the spare window is mercy, not decoration —');
{
    const r = rig({ rolls: [0.99, 0, 0, 0] });
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.game.handle('nora', '#batcave', 'shoot', []);
    const victim = r.game.pending.victim;
    r.game.handle('vikram', '#batcave', 'shoot', ['spare', victim]);
    c('a moderator can cancel it', r.game.pending === null, 'the pending removal survived a spare');
    r.advance(60_000);
    r.game.tick();
    c('and nobody is kicked after being spared', r.kicks.length === 0, JSON.stringify(r.kicks));
    c('the room is told', r.said.some(([, m]) => /spared/.test(m)), JSON.stringify(r.said));
}

console.log('\n— protected people are never chosen, and the caps hold —');
{
    const r = rig({ present: ['Dracula', 'vikram'], rolls: [0.99, 0, 0] });
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.game.handle('nora', '#batcave', 'shoot', []);
    c('with only staff present nobody is nominated', r.game.pending === null, JSON.stringify(r.game.pending));
    r.advance(60_000);
    r.game.tick();
    c('and nobody is kicked', r.kicks.length === 0);
    c('the room is told why nothing happened', r.said.some(([, m]) => /eligible|lucky/i.test(m)),
      JSON.stringify(r.said));
}

{
    // One removal already happened a moment ago: the gap must refuse the next.
    const r = rig({ rolls: [0.99, 0, 0, 0, 0.99, 0, 0, 0] });
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.advance(12_000);
    r.game.tick();
    c('the first removal lands', r.kicks.length === 1);
    r.advance(30_000);                        // well under the six-minute gap
    r.game.handle('samosa', '#batcave', 'shoot', []);   // opens a fresh round
    r.game.handle('samosa', '#batcave', 'shoot', []);
    c('a second miss inside the gap nominates nobody', r.game.pending === null,
      JSON.stringify(r.game.pending));
}

{
    const r = rig({ kickOn: false, rolls: [0.99, 0, 0] });
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.game.handle('nora', '#batcave', 'shoot', []);
    c('SHOOT_KICK_ON=off schedules no removal', r.game.pending === null);
    c('but the miss still has a consequence in the room', r.said.some(([, m]) => /lost|No kicking/i.test(m)),
      JSON.stringify(r.said));
}

console.log('\n— the bare word, the board, and stopping —');
{
    const r = rig({ rolls: [0.99] });
    r.game.handle('nora', '#batcave', 'shoot', []);
    c('"shoot" is consumed while a target is up', r.game.onMessage('samosa', '#batcave', 'shoot') === true);
    c('ordinary chat is not consumed', r.game.onMessage('samosa', '#batcave', 'hello there') === false);
    const r2 = rig({ rolls: [0.99] });
    r2.game.handle('nora', '#batcave', 'shoot', []);
    c('the word in ANOTHER room is not consumed', r2.game.onMessage('x', '#elsewhere', 'shoot') === false);
    c('and with no round up it is just a word', (() => {
        const r3 = rig();
        return r3.game.onMessage('x', '#batcave', 'shoot') === false;
    })());
}
{
    const r = rig({ rolls: [0.99, 0.99, 0.99, 0] });
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.game.handle('nora', '#batcave', 'shootstats', []);
    c('!!shootstats answers the person privately', r.notices.some(([n, m]) => n === 'nora' && /nora/.test(m)),
      JSON.stringify(r.notices));
    c('and it reports the kill', r.notices.some(([, m]) => /1 down/.test(m)), JSON.stringify(r.notices));
}
{
    const r = rig({ rolls: [0.99] });
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.game.handle('vikram', '#batcave', 'endshoot', []);
    c('a moderator can stop the game', r.game.round === null);
    c('and the room is told', r.said.some(([, m]) => /stopped/i.test(m)), JSON.stringify(r.said));
}

console.log('\n— the target does not respawn forever in an empty room —');
{
    const r = rig({ rolls: [0.99] });
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.advance(21_000);
    r.game.tick();
    c('an expired target is announced as gone', r.said.some(([, m]) => /got away/.test(m)), JSON.stringify(r.said));
    r.advance(9_000);
    r.game.tick();
    c('and a room that never fired gets no replacement target', r.game.round === null);
}
{
    const r = rig({ rolls: [0.99, 0.99, 0.99, 0] });
    r.game.handle('nora', '#batcave', 'shoot', []);
    r.game.handle('nora', '#batcave', 'shoot', []);      // a kill sets the respawn
    r.advance(9_000);
    r.game.tick();
    c('a game somebody is actually playing gets the next target', r.game.round !== null,
      'the round never came back after a kill');
}

console.log('\n— switched off means switched off —');
{
    const r = rig({ enabled: false });
    c('!!shoot is not ours when SHOOT_ON=off', r.game.handle('nora', '#batcave', 'shoot', []) === false);
    c('and it eats no chat', r.game.onMessage('nora', '#batcave', 'shoot') === false);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
