'use strict';
// Dracula goes out into the night and brings someone home.
//
// He sits in channels the owner runs, and occasionally invites one person to
// #batcave. Luna does the same for the other half of the room, so nobody is
// singled out — the split is thematic, and a wrong guess just means the other
// bot would have done it.
//
// THE RATE IS THE WHOLE DESIGN. A channel operator inviting someone now and
// then is ordinary; the same act on a loop is a drone, and this bot is
// identified to the FOUNDER account — a network-level ban would take the
// channels with it. So every guard here exists to keep it looking like a
// person being friendly rather than software harvesting a room:
//
//   - long random gaps, never a fixed interval
//   - one person at a time, never a sweep
//   - nobody is ever invited twice, so an ignored invite is the end of it
//   - operators, bots, services and anyone already in the room are skipped
//   - only channels the owner has explicitly named
//   - off unless RECRUIT_CHANNELS is set, and killable with !!recruit off

const MIN_GAP_MS = parseInt(process.env.RECRUIT_MIN_GAP_MIN || '45', 10) * 60000;
const MAX_GAP_MS = parseInt(process.env.RECRUIT_MAX_GAP_MIN || '180', 10) * 60000;
const ANNOUNCE_GAP_MS = parseInt(process.env.RECRUIT_ANNOUNCE_MIN || '240', 10) * 60000;

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
        this.timers = [];
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

    inviteOne() {
        if (!this.enabled) return null;
        const chan = pick(this.channels);
        const who = this.eligible(chan);
        if (!who.length) return null;
        const target = pick(who);
        this.invited.add(target.toLowerCase());
        this.bot.send(`INVITE ${target} ${this.deps.homeChannel}`);
        return { target, chan };
    }

    announce() {
        if (!this.enabled) return null;
        const chan = pick(this.channels);
        this.bot.say(chan, '\x0304🦇\x03 The BatCave stirs at '
            + `\x02${this.deps.homeChannel}\x02 — the door is open, the night is long, `
            + 'and the company is strange. All welcome.');
        return chan;
    }

    /** Random gaps, never a fixed interval: a metronome is what a bot looks like. */
    start(log) {
        if (!this.enabled) {
            log('INFO', 'Recruiting is off (set RECRUIT_CHANNELS to enable).');
            return;
        }
        log('OK', `Recruiting from ${this.channels.join(', ')} into ${this.deps.homeChannel}.`);
        const loop = (fn, lo, hi) => {
            const t = setTimeout(() => {
                try { fn(); } catch (e) { log('ERR', `recruit: ${e.message}`); }
                loop(fn, lo, hi);
            }, between(lo, hi));
            this.timers.push(t);
        };
        loop(() => {
            const r = this.inviteOne();
            if (r) log('INFO', `Invited ${r.target} from ${r.chan}.`);
        }, MIN_GAP_MS, MAX_GAP_MS);
        loop(() => { const c = this.announce(); if (c) log('INFO', `Announced in ${c}.`); },
            ANNOUNCE_GAP_MS, ANNOUNCE_GAP_MS * 2);
    }

    stop() {
        this.timers.forEach(clearTimeout);
        this.timers = [];
    }
}

module.exports = { Recruiter };
