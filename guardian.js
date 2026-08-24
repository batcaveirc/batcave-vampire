'use strict';
// When one of ours is the target, hand them the keys.
//
// The bot already punishes the abuser. This is the second half: the person
// being attacked is given operator status for a few minutes so they can end it
// themselves — kick, ban, whatever they judge right — instead of waiting on a
// bot's ladder or on a moderator who may be asleep.
//
// The reasoning is that being abused and being powerless are two different
// injuries, and the bot only ever addressed the first. A regular who can act is
// not a victim. It also scales: the room has one owner and a handful of mods
// across every timezone, but the person being targeted is by definition present.
//
// Deliberately narrow, because handing out ops is the most consequential thing
// this bot does:
//   - only for someone the whitelist already trusts
//   - only when the abuser is NOT trusted, so it can never be used between
//     regulars in an argument
//   - only when the abusive message actually NAMES them
//   - never to someone who already holds a prefix, and never to a bot
//   - always time-limited, and revoked early if they leave

/**
 * Who was this abuse aimed at?
 *
 * Deterministic on purpose. The AI already decided the message was abusive;
 * asking it a second question costs another call against a daily budget and
 * introduces a second thing that can be wrong. A name in the text is enough,
 * and IRC convention puts the target's nick first ("bob you are ...").
 *
 * @param {string} message   the offending text
 * @param {string} attacker  who said it
 * @param {Iterable<string>} present   everyone in the room
 * @param {(n:string)=>boolean} isTrusted
 * @returns {string|null} the nick to protect
 */
function victimOf(message, attacker, present, isTrusted) {
    if (!message) return null;
    const from = (attacker || '').toLowerCase();
    // Longest names first: "bob" must not win over "bobby" when both are here.
    const candidates = [...present].sort((a, b) => b.length - a.length);
    for (const nick of candidates) {
        const n = nick.toLowerCase();
        if (n === from) continue;              // not themselves
        if (!isTrusted(nick)) continue;        // only people we already protect
        // Word-boundary match, so "pooja" does not hit inside another word and
        // a nick that happens to be a common word needs to stand alone.
        const re = new RegExp(`(^|[^a-z0-9_\\[\\]{}\\\\|^-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_\\[\\]{}\\\\|^-]|$)`, 'i');
        if (re.test(message)) return nick;
    }
    return null;
}

class Guardian {
    /**
     * @param {{minutes:number, enabled:boolean}} opts
     */
    constructor(opts = {}) {
        this.enabled = opts.enabled !== false;
        this.minutes = opts.minutes || 10;
        // key -> {chan, nick, until}. The pair is STORED rather than encoded
        // into the key and parsed back: IRC nicks may legally contain '|'
        // ("john|away" is everywhere), so splitting the key mis-parsed exactly
        // the nicks most likely to appear in a busy room.
        this.active = new Map();
    }

    /** Already holding the keys? Then this is a no-op rather than a re-grant. */
    isActive(chan, nick) {
        const rec = this.active.get(`${chan}|${nick.toLowerCase()}`);
        return Boolean(rec && Date.now() < rec.until);
    }

    /**
     * Do we still owe this person a de-op?
     *
     * NOT the same question as isActive(), and conflating them is why the
     * grant never expired: the expiry timer fires at exactly `until`, by which
     * point isActive() is already false, so a handler guarded on it returned
     * before removing the ops it was scheduled to remove. Somebody kept
     * operator status permanently. Presence in the map is the right test —
     * it means "granted and not yet taken back", regardless of the clock.
     */
    owes(chan, nick) {
        return this.active.has(`${chan}|${nick.toLowerCase()}`);
    }

    /** Grants whose time is up, as [chan, nick] pairs. */
    due() {
        const out = [];
        for (const rec of this.active.values()) {
            if (Date.now() >= rec.until) out.push([rec.chan, rec.nick]);
        }
        return out;
    }

    /**
     * Should this person be given temporary ops right now?
     * Returns the reason it would be refused, or null to go ahead.
     */
    refuse(chan, victim, attackerTier, hasPrefix) {
        if (!this.enabled) return 'disabled';
        // Between two trusted people this must never trigger: an argument
        // between regulars is not an attack, and arming one side of it would
        // be the single worst thing this feature could do.
        if (['trusted', 'mod', 'staff'].includes(attackerTier)) return 'attacker is one of ours';
        if (hasPrefix) return 'already has status';
        if (this.isActive(chan, victim)) return 'already guarding';
        return null;
    }

    grant(chan, victim) {
        this.active.set(`${chan}|${victim.toLowerCase()}`,
            { chan, nick: victim, until: Date.now() + this.minutes * 60000 });
    }

    release(chan, victim) {
        this.active.delete(`${chan}|${victim.toLowerCase()}`);
    }
}

module.exports = { Guardian, victimOf };
