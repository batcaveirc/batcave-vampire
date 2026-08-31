'use strict';
// Hearing the attack being organised, before it arrives.
//
// The raid on 2026-08-24 did not begin in #batcave. Somebody cloned a regular's
// name in another room, advertised the channel to a crowd, and the arrivals
// followed. By the time the first abusive line was typed at home the room was
// already full of them. Everything else the bot does is a response; this is the
// only part that can act while there is still nothing to respond to.
//
// TWO RULES SHAPE THIS ENTIRELY:
//
// 1. Observe abroad, act at home. Dracula sits in other people's rooms as a
//    guest. Moderating there would be presumptuous, would get it banned from
//    the very rooms it watches, and is not its business. It never speaks or
//    sets a mode outside its own channels — it only listens and remembers.
//
// 2. Mentioning our channel is NOT suspicious. Recruiting posts the channel
//    name in those same rooms; the owner does; regulars invite friends. A
//    mention alone must never be evidence, or the bot flags its own advertising
//    and everyone who ever recommended the place. What marks an attack is the
//    mention arriving WITH abuse, or hammered repeatedly the way spam is.

// Spam shape: the same channel named several times in one line, which is what
// "#batcave #batcave #batcave 💦💦" is and what an invitation never is.
const REPEAT_THRESHOLD = 3;

// How long a sighting stays interesting. Long enough to cover "advertise, then
// bring them over", short enough that a week-old mention is not held against
// somebody who turns up innocently later.
const MEMORY_MS = 45 * 60 * 1000;

class Watch {
    /**
     * @param {{enabled?:boolean, homes:string[]}} opts
     */
    constructor(opts = {}) {
        this.enabled = opts.enabled !== false;
        this.homes = (opts.homes || []).map((c) => c.toLowerCase());
        this.sightings = new Map();     // nick(lower) -> [{at, chan, why}]
    }

    /** Does this line name one of our rooms, and how many times? */
    mentions(message) {
        if (!message) return 0;
        const low = message.toLowerCase();
        let n = 0;
        for (const home of this.homes) {
            // Count every occurrence, not just whether one exists.
            const bare = home.replace(/^#/, '');
            if (!bare) continue;
            const re = new RegExp(`#${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
            n += (low.match(re) || []).length;
        }
        return n;
    }

    /**
     * What did we just hear, and does it warrant anything?
     *
     * @param {string} chan     the FOREIGN room this was said in
     * @param {string} nick     who said it
     * @param {string} message  what they said
     * @param {{trusted:boolean, abusive:boolean, badNick:boolean}} about
     * @returns {{level:'none'|'watch'|'alert', why:string, count:number}}
     */
    hear(chan, nick, message, about = {}) {
        const none = { level: 'none', why: '', count: 0 };
        if (!this.enabled) return none;
        const count = this.mentions(message);
        if (!count) return none;
        // Our own people advertising the room is the point, not a threat.
        if (about.trusted) return none;

        const spammed = count >= REPEAT_THRESHOLD;
        const nasty = Boolean(about.abusive || about.badNick);
        if (!spammed && !nasty) {
            // Someone simply named the channel. Remember it — a pattern across
            // several rooms is meaningful even when each mention is not — but
            // say nothing.
            this.remember(nick, chan, 'mentioned the room');
            return { level: 'watch', why: 'mentioned the room', count };
        }

        const why = nasty && spammed ? 'spamming the room name alongside abuse'
            : nasty ? 'naming the room while being abusive'
                : `named the room ${count}x in one line`;
        this.remember(nick, chan, why, message);
        return { level: 'alert', why, count };
    }

    remember(nick, chan, why, text) {
        const k = nick.toLowerCase();
        const now = Date.now();
        const hist = (this.sightings.get(k) || []).filter((s) => now - s.at < MEMORY_MS);
        // Keep WHAT was said, not only that something was.
        //
        // A moderator was told "bonddd just arrived — heard advertising this
        // room in #allindiachat.com. Muted for 30m." and had no way to see the
        // line, so no way to tell a raid from somebody recommending the place
        // to a friend. A verdict nobody can check is a verdict nobody can
        // overturn, and this one mutes a new arrival for half an hour.
        hist.push({ at: now, chan, why, text: String(text || '').slice(0, 160) });
        this.sightings.set(k, hist);
    }

    /** The lines we actually heard, most recent first. */
    heardFrom(nick) {
        const now = Date.now();
        return (this.sightings.get(String(nick).toLowerCase()) || [])
            .filter((s) => now - s.at < MEMORY_MS && s.text)
            .sort((a, b) => b.at - a.at)
            .map((s) => ({ chan: s.chan, why: s.why, text: s.text, at: s.at }));
    }

    /** Rooms we have heard this nick advertise us in, recently. */
    seenIn(nick) {
        const now = Date.now();
        const hist = (this.sightings.get(nick.toLowerCase()) || [])
            .filter((s) => now - s.at < MEMORY_MS);
        return [...new Set(hist.map((s) => s.chan))];
    }

    /** Have we heard this nick recently enough to greet them differently? */
    isFlagged(nick) {
        return this.seenIn(nick).length > 0;
    }

    forget(nick) {
        this.sightings.delete(nick.toLowerCase());
    }
}

module.exports = { Watch, REPEAT_THRESHOLD, MEMORY_MS };
