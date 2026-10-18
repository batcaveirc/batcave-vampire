'use strict';
// How much AI one person may spend (owner request 2026-10-18: "dont let users
// over use the ai ... redirect them in a humorous way instead").
//
// The daily AI budget is shared by the whole room, and moderation draws on the
// same pool. One person asking question after question can empty it for
// everybody, and then the abuse checks go quiet too.
//
// check(nick) returns:
//   'ok'    — answer them; the use is recorded
//   'joke'  — over the limit; say ONE redirect line
//   'quiet' — over the limit and already told; say nothing (a joke on every
//             message would just be a flood of a different kind)

class AiQuota {
    constructor({ per10m = 5, perDay = 25, now = () => Date.now() } = {}) {
        this.per10m = per10m;
        this.perDay = perDay;
        this.now = now;
        this.uses = new Map();     // nick -> [timestamps within 24h]
        this.toldAt = new Map();   // nick -> when we last made the joke
    }

    check(nick) {
        const k = String(nick || '').toLowerCase();
        const t = this.now();
        const day = (this.uses.get(k) || []).filter((x) => t - x < 86400000);
        this.uses.set(k, day);
        const recent = day.filter((x) => t - x < 600000).length;
        if (recent < this.per10m && day.length < this.perDay) {
            day.push(t);
            this.toldAt.delete(k);
            this._prune();
            return 'ok';
        }
        if (!this.toldAt.has(k) || t - this.toldAt.get(k) > 600000) {
            this.toldAt.set(k, t);
            return 'joke';
        }
        return 'quiet';
    }

    _prune() {
        if (this.uses.size < 2000) return;
        const t = this.now();
        for (const [k, arr] of this.uses) {
            if (!arr.length || t - arr[arr.length - 1] > 86400000) this.uses.delete(k);
        }
    }
}

const OVERUSE_LINES = Object.freeze([
    "{n}, you've drained me dry — let someone else have a sip. back in a bit 🦇",
    '{n}, even vampires need a breather between bites. talk to the room for a while?',
    "that's your share of my wisdom for now, {n}. the humans here are free, ask them.",
    "{n}, I've answered more questions than a census. coffin nap, then more.",
    '{n}, my fangs are tired. go charm somebody else and come back later 😏',
    "four hundred years old and you still out-talked me, {n}. give me a few minutes.",
]);

function overuseLine(nick, rnd = Math.random) {
    return OVERUSE_LINES[Math.floor(rnd() * OVERUSE_LINES.length)].split('{n}').join(nick);
}

module.exports = { AiQuota, overuseLine, OVERUSE_LINES };
