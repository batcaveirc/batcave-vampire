'use strict';
// Dracula goes out into the night and brings someone home.
//
// He sits in channels the owner runs, and occasionally invites one person to
// #batcave. Luna does the same for the other half of the room, so nobody is
// singled out — the split is thematic, and a wrong guess just means the other
// bot would have done it.
//
// THE POOL, NOT THE CLOCK, IS WHAT LIMITS THIS. The bot is identified to the
// FOUNDER account, so a network-level ban would take the channels with it.
// What keeps that from happening is `invited`: nobody is ever asked twice, so
// the eligible pool DRAINS and the loop goes quiet by itself. A one-minute
// gap therefore means a short burst until the room is exhausted, not a
// sustained thousand invites a day. Raise RECRUIT_MIN_GAP_MIN if that burst
// ever draws attention. The remaining guards:
//
//   - random gaps, never a fixed interval (paced by RECRUIT_MIN/MAX_GAP_MIN)
//   - one person at a time, never a sweep
//   - nobody is ever invited twice, so an ignored invite is the end of it
//   - operators, bots, services and anyone already in the room are skipped
//   - only channels the owner has explicitly named
//   - off unless RECRUIT_CHANNELS is set, and killable with !!recruit off

// Owner-set pace: roughly one invitation a minute while there is anyone left
// to invite. That is fast, and it is deliberate — see the note below on why it
// is survivable: `invited` means the pool drains rather than the rate
// sustaining, so this is a short burst that goes quiet on its own.
const MIN_GAP_MS = parseInt(process.env.RECRUIT_MIN_GAP_MIN || '1', 10) * 60000;
const MAX_GAP_MS = parseInt(process.env.RECRUIT_MAX_GAP_MIN || '2', 10) * 60000;
const ANNOUNCE_GAP_MS = parseInt(process.env.RECRUIT_ANNOUNCE_MIN || '240', 10) * 60000;
// The FIRST attempt after startup is deliberately much sooner than the rest.
// The host restarts this bot every six hours, and every restart resets the
// timer — so with a 45-180 minute first gap, a few redeploys in an afternoon
// mean it never fires at all. A short opening interval makes the feature
// survive its own deployment; the long gaps take over from the second firing.
const FIRST_GAP_MS = parseInt(process.env.RECRUIT_FIRST_MIN || '1', 10) * 60000;

// A guess, and a poor one — nicknames are not gender. It only decides WHICH
// bot extends the invitation, so being wrong costs nothing. Extend with
// FEMININE_HINTS rather than editing this list.
const DEFAULT_HINTS = [
    'aditi', 'ananya', 'anjali', 'anu', 'arpita', 'bella', 'chuza', 'diya',
    'divya', 'gauri', 'gudiya', 'isha', 'jaan', 'kiara', 'kritika', 'lily',
    'luna', 'meena', 'minal', 'misha', 'neha', 'nikki', 'pari', 'payal',
    'pooja', 'priya', 'radha', 'riya', 'rose', 'sakhi', 'sana', 'sara',
    'shweta', 'simran', 'sneha', 'sonia', 'sweety', 'tanu', 'tina', 'zara',
    'angel', 'baby', 'barbie', 'doll', 'gudia', 'queen', 'princess', 'ladki',
];

const NEVER = new Set(['chanserv', 'nickserv', 'operserv', 'hostserv', 'memoserv',
    'botserv', 'global', 'chanbot', 'luna1', 'vampire', 'dracula', 'notsobot']);

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const between = (lo, hi) => lo + Math.floor(Math.random() * Math.max(1, hi - lo));

class Recruiter {
    /**
     * @param {{send:Function, say:Function, nick:string}} bot
     * @param {object} deps  membersOf(chan), prefixOf(chan,nick), homeChannel
     */
    constructor(bot, deps) {
        this.bot = bot;
        this.deps = deps;
        this.channels = (process.env.RECRUIT_CHANNELS || '')
            .split(',').map((c) => c.trim()).filter(Boolean)
            .map((c) => (c.startsWith('#') ? c : `#${c}`));
        this.enabled = this.channels.length > 0
            && /^(1|true|yes|on)$/i.test(process.env.RECRUIT_ON || 'on');
        this.hints = DEFAULT_HINTS.concat(
            (process.env.FEMININE_HINTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
        this.invited = new Set();      // nobody is ever asked twice
        this.recent = [];              // last few invites, so !!recruit can show its work
        this.timers = {};             // name -> the ONE live handle for that job
        this.started = false;
    }

    /** Nicknames that look feminine enough for Dracula to take this one. */
    looksFeminine(nick) {
        const n = nick.toLowerCase().replace(/[^a-z]/g, '');
        if (!n) return false;
        return this.hints.some((h) => n.includes(h));
    }

    eligible(chan) {
        const out = [];
        for (const nick of this.deps.membersOf(chan)) {
            const n = nick.toLowerCase();
            if (NEVER.has(n) || n === this.bot.nick.toLowerCase()) continue;
            if (this.invited.has(n)) continue;
            // Never an operator. Being invited by a bot reads as spam to the
            // people most able to act on it, and that is how a bot gets banned.
            if (/[~&@%]/.test(this.deps.prefixOf(chan, nick))) continue;
            // Already home.
            if (this.deps.membersOf(this.deps.homeChannel).some(
                (m) => m.toLowerCase() === n)) continue;
            if (!this.looksFeminine(nick)) continue;
            out.push(nick);
        }
        return out;
    }

    /**
     * Why nothing happened. "Nobody eligible" is true and useless — it cannot
     * distinguish "I am not in that room", "I cannot see its member list",
     * "everyone there is an operator" and "no nickname matched". Each needs a
     * different fix, so each gets counted.
     */
    explain() {
        const lines = [];
        for (const chan of this.channels) {
            const all = this.deps.membersOf(chan);
            if (!all.length) {
                lines.push(`${chan}: NOT IN THE ROOM — cannot see anyone. `
                    + `Check for a ban: /mode ${chan} +b`);
                continue;
            }
            let ops = 0, bots = 0, already = 0, unmatched = 0, asked = 0, ok = 0;
            const home = this.deps.membersOf(this.deps.homeChannel).map((m) => m.toLowerCase());
            for (const nick of all) {
                const n = nick.toLowerCase();
                if (NEVER.has(n) || n === this.bot.nick.toLowerCase()) { bots++; continue; }
                if (this.invited.has(n)) { asked++; continue; }
                if (/[~&@%]/.test(this.deps.prefixOf(chan, nick))) { ops++; continue; }
                if (home.includes(n)) { already++; continue; }
                if (!this.looksFeminine(nick)) { unmatched++; continue; }
                ok++;
            }
            lines.push(`${chan}: ${all.length} present — ${ok} eligible `
                + `(${ops} ops, ${bots} bots, ${already} already home, ${asked} asked before, `
                + `${unmatched} no name match)`);
        }
        return lines.length ? lines : ['no channels configured'];
    }

    /**
     * Try the channels in random order and stop at the first with somebody in
     * it. Picking ONE at random and giving up when it was empty meant a room
     * the bot cannot even enter — #allindiachat.com bans it, so it yields zero
     * every time — silently ate a third of all attempts. Still one invitation
     * per firing; only the search is exhaustive, not the sending.
     */
    inviteOne() {
        if (!this.enabled) return null;
        const order = this.channels.slice().sort(() => Math.random() - 0.5);
        for (const chan of order) {
            const who = this.eligible(chan);
            if (!who.length) continue;
            const target = pick(who);
            this.invited.add(target.toLowerCase());
            this.bot.send(`INVITE ${target} ${this.deps.homeChannel}`);
            // An INVITE is delivered privately to the person invited, so from
            // inside the home channel a working recruiter and a broken one look
            // exactly alike. Keep the last few so !!recruit can show its work.
            this.recent.unshift({ target, chan, at: Date.now() });
            this.recent.length = Math.min(this.recent.length, 8);
            return { target, chan };
        }
        return null;
    }

    announce() {
        if (!this.enabled) return null;
        const chan = pick(this.channels);
        this.bot.say(chan, '\x0304🦇\x03 The BatCave stirs at '
            + `\x02${this.deps.homeChannel}\x02 — the door is open, the night is long, `
            + 'and the company is strange. All welcome.');
        return chan;
    }

    /**
     * Random gaps, never a fixed interval: a metronome is what a bot looks like.
     *
     * The loops ALWAYS run, and each firing asks whether recruiting is on. The
     * previous version returned early when it was off, so the timers were never
     * created — and since the bot boots before anyone types !!recruit on, the
     * toggle flipped a boolean with nothing behind it. It looked enabled and
     * could only ever act when someone typed !!recruit now by hand.
     *
     * State that can be switched at runtime must not decide whether the
     * machinery exists. It decides what the machinery does when it fires.
     */
    start(log) {
        if (this.started) return;                // idempotent
        this.started = true;
        this.log = log;
        log(this.enabled ? 'OK' : 'INFO',
            this.enabled
                ? `Recruiting from ${this.channels.join(', ')} into ${this.deps.homeChannel}.`
                : 'Recruiting is idle (no channels set, or turned off) — the timer is running '
                  + 'and will act the moment it is switched on.');
        this.loop('invite', FIRST_GAP_MS);
        this.loop('announce', FIRST_GAP_MS * 3);
    }

    /**
     * One self-rescheduling timer per job, held by NAME.
     *
     * The previous version pushed every rescheduling onto an array that was
     * only ever emptied by stop(), so a timer that had already fired stayed in
     * the list forever — at a gap of a minute that is 1440 dead handles a day.
     * Keying by name means each job has exactly one live timer, and it can be
     * replaced (see soon()) instead of only ever appended to.
     */
    loop(name, first) {
        const lo = name === 'invite' ? MIN_GAP_MS : ANNOUNCE_GAP_MS;
        const hi = name === 'invite' ? MAX_GAP_MS : ANNOUNCE_GAP_MS * 2;
        const delay = first != null ? first : between(lo, hi);
        clearTimeout(this.timers[name]);
        this.timers[name] = setTimeout(() => {
            try {
                if (name === 'invite') {
                    const r = this.inviteOne();
                    if (r) this.log('INFO', `Invited ${r.target} from ${r.chan}.`);
                } else {
                    const c = this.announce();
                    if (c) this.log('INFO', `Announced in ${c}.`);
                }
            } catch (e) { this.log('ERR', `recruit: ${e.message}`); }
            this.loop(name, null);               // settle into the normal gaps
        }, delay);
        if (name === 'invite') this.nextAt = Date.now() + delay;
    }

    /**
     * Bring the next invitation forward. Switching recruiting ON used to leave
     * whatever gap had been rolled while it was OFF still standing, so someone
     * who turned it on could be told the next attempt was two hours away — the
     * toggle appeared to do nothing. Turning a thing on should make it happen.
     */
    soon() {
        if (!this.started) return;
        this.loop('invite', FIRST_GAP_MS);
    }

    /** Roughly how long until the next attempt, for !!recruit to report. */
    dueIn() {
        if (!this.started) return 'not scheduled';
        if (!this.nextAt) return `up to ${Math.round(MAX_GAP_MS / 60000)}m`;
        const mins = Math.max(0, Math.round((this.nextAt - Date.now()) / 60000));
        return mins < 1 ? 'in under a minute' : `in about ${mins}m`;
    }

    stop() {
        Object.values(this.timers).forEach(clearTimeout);
        this.timers = {};
        this.started = false;
    }
}

module.exports = { Recruiter };
