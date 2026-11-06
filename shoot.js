'use strict';
// !!shoot — somebody's nick appears as the target, and the room shoots at it.
//
// The owner's shape: a name goes up, "shoot" knocks it down, and the target
// either dies or dodges. A dodge is a MISS, and a miss costs the room — one
// person chosen at random is told they lost a game they were not playing and is
// removed for as long as it takes to type their nick again.
//
// Every kick here goes through the bot's own kickUser(), because a game must
// not have a second, weaker way to remove somebody: the ops check, the
// "already acted on this person" guard and the parting notice all live there.
// `eligible()` is the extra gate on top — staff, our own fleet, anyone the
// owner protects and anyone this game kicked in the last day are never chosen.
//
// The other half is mercy, and it is not decoration. A miss announces the loser
// and gives the room SHOOT_KICK_GRACE_SECS to type "!!shoot spare <nick>". A
// joke that cannot be called off is just a removal with a punchline.
//
// No timers in this file on purpose. The bot already sweeps every couple of
// seconds, and a game that spawns its own intervals keeps running after the
// thing that owns it is gone.

const chanKey = (c) => String(c || '').trim().toLowerCase();
const on = (v, dflt) => (v == null || v === '' ? dflt : /^(1|true|yes|on)$/i.test(String(v)));

const ENABLED = on(process.env.SHOOT_ON, true);
const KICK_ON = on(process.env.SHOOT_KICK_ON, true);
const ROUND_MS = Math.max(3000, Number(process.env.SHOOT_ROUND_SECS || 20) * 1000);
const COOLDOWN_MS = Math.max(0, Number(process.env.SHOOT_COOLDOWN_MS || 4000));
const RESPAWN_MS = Math.max(0, Number(process.env.SHOOT_RESPAWN_SECS || 8) * 1000);
const GRACE_MS = Math.max(0, Number(process.env.SHOOT_KICK_GRACE_SECS || 12) * 1000);
const KICK_PER_HOUR = Math.max(1, Number(process.env.SHOOT_KICK_PER_HOUR || 2));
const KICK_GAP_MS = Math.max(60000, Number(process.env.SHOOT_KICK_GAP_MIN || 6) * 60000);
const KICKED_TTL_MS = 24 * 60 * 60 * 1000;

// Read literally rather than through a helper: test/envaudit.js only recognises
// a static process.env.NAME, and a name it cannot see is reported as
// configuration the workflow passes into the void.
const DODGE = (() => {
    const n = Number(process.env.SHOOT_DODGE_CHANCE);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.35;
})();                                               // the target slips the shot
const HEADSHOT = 0.12;                              // flavour only, same outcome

const KILL_LINES = [
    'Down before they saw it.',
    'Straight through the heart. 🩸',
    'Textbook.',
    'That one is not getting up.',
    'No notes.',
];
const DODGE_LINES = [
    'sidesteps it',
    'ducks at the last second',
    'is already somewhere else',
    'steps behind the bar',
    'was never really there',
];

const pick = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];

class Shoot {
    /**
     * @param {{send:Function, say:Function, notice:Function, nick:string}} bot
     * @param {{enabled?:boolean, kickOn?:boolean, now?:Function, random?:Function,
     *          present?:Function, eligible?:Function, isOurs?:Function,
     *          mayMod?:Function, kick?:Function, notice?:Function}} opts
     */
    constructor(bot, opts = {}) {
        this.bot = bot;
        this.enabled = opts.enabled == null ? ENABLED : !!opts.enabled;
        this.kickOn = opts.kickOn == null ? KICK_ON : !!opts.kickOn;
        this.now = opts.now || (() => Date.now());
        this.random = opts.random || Math.random;
        this.present = opts.present || (() => []);
        this.eligible = opts.eligible || (() => true);
        this.isOurs = opts.isOurs || (() => false);
        this.mayMod = opts.mayMod || (() => false);
        this.kick = opts.kick || (() => {});
        // Did the OTHER bot already action this person? Two bots punishing one
        // incident reads as the room ganging up, not as a game.
        this.peerActed = opts.peerActed || null;
        this.noticeTo = opts.notice || ((nick, m) => this.bot.notice(nick, m));

        this.round = null;          // { chan, target, by, at, until }
        this.pending = null;        // { chan, victim, by, due }
        this.stats = new Map();     // nick(lower) -> {nick, shots, kills, misses, streak, best, lastShot}
        this.kickAt = [];           // when this game removed somebody, for the hourly cap
        this.kicked = new Map();    // nick(lower) -> last time this game removed them
        this.respawnAt = 0;         // when to put the next target up
        this.respawnChan = '';
        this.lastShotAt = 0;        // a target is only respawned while the game is warm
    }

    say(chan, msg) { try { this.bot.say(chan, msg); } catch (e) { /* the pacer reports its own */ } }

    notice(nick, msg) { try { this.noticeTo(nick, msg); } catch (e) { /* best effort */ } }

    stat(nick) {
        const k = String(nick).toLowerCase();
        let s = this.stats.get(k);
        if (!s) {
            s = { nick: String(nick), shots: 0, kills: 0, misses: 0, streak: 0, best: 0, lastShot: 0 };
            this.stats.set(k, s);
        }
        s.nick = String(nick);
        return s;
    }

    ours(nick) {
        try { return !!this.isOurs(nick); } catch (e) { return false; }
    }

    /** Somebody to put in the crosshairs: present, not us, not another bot. */
    pickTarget(chan) {
        const me = String(this.bot.nick || '').toLowerCase();
        const pool = (this.present(chan) || [])
            .filter((n) => n && String(n).toLowerCase() !== me)
            .filter((n) => !this.ours(n));
        if (!pool.length) return '';
        return pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))];
    }

    openRound(chan, by) {
        const target = this.pickTarget(chan);
        if (!target) {
            this.say(chan, 'Nobody here to aim at — I need somebody besides me in the room.');
            return false;
        }
        const now = this.now();
        this.round = { chan, target, by, at: now, until: now + ROUND_MS };
        this.respawnAt = 0;
        this.say(chan, `\x02🎯 TARGET:\x02 \x02${target}\x02 — type \x02shoot\x02 to fire `
            + `(${Math.round(ROUND_MS / 1000)}s).`);
        return true;
    }

    /** One shot. Opens a round when there is nothing to shoot at yet. */
    fire(nick, chan) {
        const now = this.now();
        const st = this.stat(nick);

        if (!this.round || chanKey(this.round.chan) !== chanKey(chan) || now > this.round.until) {
            this.round = null;
            this.openRound(chan, nick);
            return true;
        }
        if (now - (st.lastShot || 0) < COOLDOWN_MS) {
            this.notice(nick, `Reloading — one shot every ${Math.round(COOLDOWN_MS / 1000)}s.`);
            return true;
        }

        const r = this.round;
        st.lastShot = now;
        this.lastShotAt = now;      // only a real shot arms the respawn
        st.shots += 1;

        if (this.random() < DODGE) {
            st.misses += 1;
            st.streak = 0;
            this.round = null;
            this.say(chan, `\x02${r.target}\x02 ${pick(DODGE_LINES, this.random())} — `
                + `\x02${nick}\x02 missed.`);
            this.punish(chan, nick, r.target);
            return true;
        }

        st.kills += 1;
        st.streak += 1;
        st.best = Math.max(st.best, st.streak);
        this.round = null;
        this.respawnAt = now + RESPAWN_MS;
        this.respawnChan = chan;
        const head = this.random() < HEADSHOT;
        this.say(chan, `${head ? '\x02HEADSHOT\x02 — ' : ''}\x02${nick}\x02 drops `
            + `\x02${r.target}\x02. ${pick(KILL_LINES, this.random())}`);
        if (st.streak >= 3) this.say(chan, `\x02${nick}\x02 is on \x02${st.streak}\x02 in a row. 🩸`);
        return true;
    }

    /** Who may be told they lost: present, not protected, not recently punished. */
    losers(chan) {
        const now = this.now();
        const me = String(this.bot.nick || '').toLowerCase();
        return (this.present(chan) || []).filter((n) => {
            const k = String(n || '').toLowerCase();
            if (!k || k === me) return false;
            if (this.ours(n)) return false;
            let ok = true;
            try { ok = !!this.eligible(n); } catch (e) { ok = false; }
            if (!ok) return false;
            // Missing means never, not epoch zero. Treating an absent entry as
            // time 0 filters EVERYBODY out until the process has been up a day
            // — which is how this pool came back empty in its own test.
            const lastKick = this.kicked.get(k);
            if (lastKick && now - lastKick < KICKED_TTL_MS) return false;
            // The partner removed them for something else minutes ago. Picking
            // them again is the same person paying twice for one evening.
            try { if (this.peerActed && this.peerActed(n)) return false; } catch (e) { /* never block the pool */ }
            return true;
        });
    }

    /**
     * A miss has to cost somebody something, or the dodge is just a word.
     * The caps are the difference between a game and a grudge: two removals an
     * hour, six minutes apart, and nobody twice in a day.
     */
    punish(chan, shooter, target) {
        const now = this.now();
        if (!this.kickOn) {
            this.say(chan, `\x02${shooter}\x02 lost that one. No kicking tonight — `
                + `${target} lives to be aimed at again.`);
            return;
        }
        this.kickAt = this.kickAt.filter((t) => now - t < 60 * 60 * 1000);
        if (this.kickAt.length >= KICK_PER_HOUR) return;
        if (this.kickAt.length && now - this.kickAt[this.kickAt.length - 1] < KICK_GAP_MS) return;

        const pool = this.losers(chan);
        if (!pool.length) {
            this.say(chan, `\x02${shooter}\x02 missed. Nobody here is eligible to lose, `
                + 'which is lucky for everybody.');
            return;
        }
        const victim = pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))];
        this.pending = { chan, victim, by: shooter, due: now + GRACE_MS };
        const secs = Math.round(GRACE_MS / 1000);
        if (secs <= 0) return;                       // tick() collects it immediately
        this.say(chan, `\x02${victim}\x02 loses by association — ${secs}s to be spared: `
            + `\x02!!shoot spare ${victim}\x02.`);
    }

    spare(nick, chan, who) {
        const p = this.pending;
        if (!p || chanKey(p.chan) !== chanKey(chan)) {
            this.notice(nick, 'Nobody is waiting to be spared.');
            return;
        }
        const wanted = String(p.victim).toLowerCase();
        if (who && String(who).toLowerCase() !== wanted) {
            this.notice(nick, `${p.victim} is the one on the block, not ${who}.`);
            return;
        }
        if (!this.mayMod(nick, chan)) {
            this.notice(nick, 'Only a moderator can spare somebody.');
            return;
        }
        this.pending = null;
        this.say(chan, `\x02${p.victim}\x02 is spared. The room is merciful today.`);
    }

    stop(nick, chan) {
        if (!this.mayMod(nick, chan)) {
            this.notice(nick, 'Only a moderator can end the game.');
            return;
        }
        const had = !!this.round || !!this.pending;
        this.round = null;
        this.pending = null;
        this.respawnAt = 0;
        this.say(chan, had ? 'Shooting stopped. Nobody else gets hurt.' : 'The game was not running.');
    }

    board(nick) {
        if (!this.stats.size) {
            this.notice(nick, 'Nobody has fired yet. Type shoot when a target appears.');
            return;
        }
        const rows = [...this.stats.values()]
            .sort((a, b) => b.kills - a.kills || b.shots - a.shots)
            .slice(0, 5)
            .map((s, i) => `${i + 1}. ${s.nick} ${s.kills} down / ${s.misses} missed (best ${s.best})`);
        this.notice(nick, `Shooting board — ${rows.join(' · ')}`);
    }

    /** An !! command. Returns true if this game claimed it. */
    handle(nick, chan, cmd, args) {
        if (!this.enabled) return false;
        if (cmd === 'endshoot') { this.stop(nick, chan); return true; }
        if (cmd === 'shootstats') { this.board(nick); return true; }
        if (cmd === 'shoot') {
            const sub = String((args && args[0]) || '').toLowerCase();
            if (sub === 'spare') { this.spare(nick, chan, (args || [])[1]); return true; }
            if (sub === 'end' || sub === 'stop') { this.stop(nick, chan); return true; }
            this.fire(nick, chan);
            return true;
        }
        return false;
    }

    /**
     * A bare "shoot" in the room, which is how people actually play. Only
     * consumed while a target is up in THAT room — otherwise the word is
     * ordinary chat and this must not swallow it.
     */
    onMessage(nick, chan, text) {
        if (!this.enabled) return false;
        if (!/^shoot[.!]*$/i.test(String(text || '').trim())) return false;
        if (!this.round || chanKey(this.round.chan) !== chanKey(chan)) return false;
        this.fire(nick, chan);
        return true;
    }

    /** Called on the bot's sweep: expire the target, pay out a pending removal. */
    tick(at) {
        if (!this.enabled) return;
        const now = at == null ? this.now() : at;

        if (this.round && now > this.round.until) {
            const { chan, target } = this.round;
            this.round = null;
            this.say(chan, `The target got away — \x02${target}\x02 slipped out.`);
            this.respawnAt = now + RESPAWN_MS;
            this.respawnChan = chan;
        }

        // Respawn only while the game is warm. Without the window a quiet room
        // would get a fresh target every half minute, forever, from one person
        // who fired once — an announcement loop nobody asked for.
        if (!this.round && this.respawnAt && now >= this.respawnAt && this.respawnChan
                && now - this.lastShotAt < 5 * 60 * 1000) {
            this.respawnAt = 0;
            this.openRound(this.respawnChan, 'the room');
        }

        if (this.pending && now >= this.pending.due) {
            const p = this.pending;
            this.pending = null;
            this.kickAt.push(now);
            this.kicked.set(String(p.victim).toLowerCase(), now);
            this.notice(p.victim, `You lost a game you were not playing — ${p.by} missed. `
                + 'Type your nick again to come back.');
            try { this.kick(p.chan, p.victim, 'lost the shooting game'); } catch (e) { /* kickUser logs */ }
            this.say(p.chan, `\x02${p.victim}\x02 lost the shooting game. 🎯`);
        }
    }
}

module.exports = { Shoot };
