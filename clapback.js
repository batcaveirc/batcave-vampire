'use strict';
// Clapback — the room's answer when somebody turns on one of ours.
//
// Two jobs, and the second is the one that keeps this usable:
//
//   1. Answer OUT LOUD and immediately, so the room sees a regular defended
//      instead of only seeing them removed three minutes later by a log line.
//      Silence reads as "the bot did not notice"; a reply reads as "that was
//      seen, and it was not clever".
//
//   2. Answer IN PROPORTION. "shut up" is not a threat. A bot that escalates
//      every insult to a kick is a bot nobody can joke around, and the regulars
//      it is protecting are the first people to notice.
//
// Severity comes from WHAT was said, not from who said it:
//
//   1  mild    — a cutting line. No punishment.
//   2  abuse   — the line, then a warning through the bot's ordinary ladder.
//   3  threat  — the line, then the ordinary moderation path (warn → kick).
//
// The bot never answers a protected person, never answers itself, and never
// answers twice a minute for the same nick: a clapback farm is worse than no
// clapback at all.
//
// In an NSFW room the reply may swear, because the room has said it wants that
// register. The one word it never uses is a slur. The bot kicks people for
// those, and a network that sees one in OUR line does not read intent — it
// bans the client and takes the channel with it.

const MILD = /\b(?:idiot|stupid|dumb|moron|loser|clown|trash|ugly|fat|nobody|cringe|beggar|peasant|worthless|pathetic|shut\s*up|stfu|gtfo|get\s*lost|nobody\s+asked)\b/i;
const ABUSE = /\b(?:bitch|whore|slut|bastard|asshole|arsehole|dickhead|motherfucker|piece\s+of\s+shit|scum|vermin|pig|dog|randi|chutiya|chutiye|madarchod|bhosdi\w*|haramkhor|kutta|kamina)\b/i;
const THREAT = /\b(?:kill|murder|rape|acid|dox|doxx|stab|shoot\s+you|beat\s+you|find\s+you|hunt\s+you|break\s+your|slit|hang\s+you)\b/i;
const SEVERE = /\b(?:fuck\s+you|f+u+c+k+|fucking|fuckin|shit)\b/i;

const POOLS = {
    1: {
        clean: [
            '{who} is one of mine. Take the attitude somewhere that grades on effort.',
            'Say it to {who} again and the room will remember it longer than you will.',
            'Careful — {who} has friends in here. You are talking to all of us.',
            'That was a swing at {who}. It landed on the room\'s patience instead.',
        ],
        nsfw: [
            'Talk shit about {who} somewhere I can\'t hear you. I hear everything.',
            '{who} is under this roof, {nick}. Pick a softer target or a shorter visit.',
            'That mouth is brave for somebody standing in front of {who}\'s friends.',
        ],
    },
    2: {
        clean: [
            'That is enough. {who} is not your punching bag, and I am not your audience.',
            'One more line like that at {who} and you can explain it to the door.',
            'You came in swinging at {who}. The room noticed. So did I.',
        ],
        nsfw: [
            'Say that about {who} again and the door will be the fucking least of your problems.',
            'That was a pathetic swing at {who}. Try it once more and find out how fast I move.',
            'You are embarrassing yourself at {who}\'s expense, and I am done being polite about it.',
        ],
    },
    3: {
        clean: [
            'Threats are not banter. {who} stays, you go.',
            'You just threatened one of mine. That is the whole conversation.',
        ],
        nsfw: [
            'Threaten {who} one more time and you will not finish the sentence.',
            'That was a threat at {who}. Enjoy the door — it is the only thing here that listens to you.',
        ],
    },
};

const REASON = {
    1: 'attacking a regular',
    2: 'abusing a regular',
    3: 'threatening a regular',
};

/** Which severity a line is, 0 for none. Threat beats abuse beats mild. */
function tierOf(text, severe) {
    const t = String(text || '');
    if (!t) return 0;
    if (THREAT.test(t)) return 3;
    if (ABUSE.test(t) || SEVERE.test(t)) return 2;
    // The operator's own severe list is the room's definition of beyond the
    // pale, so it counts here too — one list, not two.
    if (severe && typeof severe.has === 'function') {
        const words = (t.toLowerCase().match(/[a-z]+/g) || []);
        if (words.some((w) => severe.has(w))) return 2;
    }
    if (MILD.test(t)) return 1;
    return 0;
}

/** Every nick-looking token in a line, prefixes stripped, lowercase. */
function tokens(text) {
    return String(text || '')
        .split(/[\s,.:;!?()\[\]"'<>|]+/)
        .map((t) => t.replace(/^[@+~&%]+/, '').trim().toLowerCase())
        .filter((t) => t.length >= 2);
}

const pick = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];

class Clapback {
    /**
     * @param {{enabled?:boolean, cooldownMs?:number, random?:Function, now?:Function}} opts
     */
    constructor(opts = {}) {
        this.enabled = opts.enabled !== false;
        this.cooldownMs = Math.max(10000, Number(opts.cooldownMs) || 60000);
        this.random = opts.random || Math.random;
        this.now = opts.now || (() => Date.now());
        this.last = new Map();          // nick(lower) -> last time we answered
    }

    /**
     * The reply to an attack on a protected person, or null.
     *
     * @param {string} msg      what was said
     * @param {string} speaker  who said it
     * @param {{isProtected?:Function, nsfw?:boolean, severe?:Set<string>}} opts
     * @returns {null|{tier:number, who:string, line:string, reason:string}}
     */
    check(msg, speaker, opts = {}) {
        if (!this.enabled) return null;
        const isProtected = typeof opts.isProtected === 'function' ? opts.isProtected : () => false;
        const me = String(speaker || '').toLowerCase();
        if (!me) return null;
        // Never answer one of ours. Regulars rib each other constantly, and a
        // bot policing that is a bot the room turns off.
        try { if (isProtected(speaker)) return null; } catch (e) { return null; }
        const tier = tierOf(msg, opts.severe);
        if (!tier) return null;
        // Aimed at somebody: the line must NAME a protected person. An insult
        // about nobody in particular is the moderation ladder's business, not
        // this file's.
        let who = '';
        for (const tok of tokens(msg)) {
            if (tok === me) continue;
            try { if (isProtected(tok)) { who = tok; break; } } catch (e) { /* keep looking */ }
        }
        if (!who) return null;
        const now = this.now();
        // "Never" is not "at time 0": an absent entry must pass, or a bot whose
        // clock starts low never answers anyone at all.
        const prev = this.last.get(me);
        if (prev !== undefined && now - prev < this.cooldownMs) return null;
        this.last.set(me, now);
        if (this.last.size > 500) {
            for (const [k, ts] of this.last) if (now - ts > 3600000) this.last.delete(k);
        }
        const pool = POOLS[tier][opts.nsfw ? 'nsfw' : 'clean'];
        const line = pick(pool, this.random()).replace(/\{who\}/g, who).replace(/\{nick\}/g, speaker);
        return { tier, who, line, reason: REASON[tier] };
    }
}

module.exports = { Clapback, tierOf, tokens };
