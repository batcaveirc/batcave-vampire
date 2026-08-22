'use strict';
// The last word, before the door.
//
// Someone walks in, says something vile about a regular, and gets removed —
// and the room's final memory of it is the bot's tidy little [MOD] line. The
// abuser got the last word. This gives it back: a public, cutting reply,
// spoken BEFORE the punishment lands, so the room sees them answered and not
// merely processed.
//
// Ported from the local Vampire bot's owner_shield.py, and deliberately keeping
// that file's own rule — "playful/cheeky, PG-13, no slurs". Matching filth with
// filth would put the slur in DRACULA's mouth, on a public log, from a bot
// identified to the FOUNDER account; that is how the bot gets network-banned and
// takes the channels down with it. Contempt cuts deeper than vulgarity anyway:
// answering in kind says they landed a hit, dismissal says they were never a
// threat.
//
// Rules that keep this from becoming a liability:
//   - never at a trusted regular, a mod, services, or another bot
//   - never quotes what they said, so the bot cannot be used to republish abuse
//   - one per nick per cooldown, so a determined idiot cannot farm it for lulz
//   - it is a garnish on a punishment, never a substitute for one

const COOLDOWN_MS = 60000;

const POOLS = {
    // Aimed at the person, about their behaviour — never their group.
    harassment: [
        "That is the whole personality, isn't it. Out you go.",
        "Somebody typed that with their whole chest and zero prospects. Goodbye.",
        "Imagine peaking here. Genuinely, imagine it.",
        "You came a long way to embarrass yourself in a room this small.",
        "The mouth is running because nothing else in your life is.",
    ],
    slur: [
        "Vocabulary of a brick, manners to match. Leaving now.",
        "That word is the only one you own, and it is not worth keeping.",
        "Recycled hate, badly delivered. The door is faster than you are.",
        "Bold of you to bring your worst material to a room with a bouncer.",
    ],
    spam: [
        "Nobody read a word of that, and nobody will miss it.",
        "Volume is not a substitute for having something to say.",
        "You typed all that to be scrolled past. Impressive commitment.",
    ],
    generic: [
        "Wrong room, wrong night, wrong crowd.",
        "You had one job here — be tolerable — and you fumbled it immediately.",
        "That is enough of that. The night is long and you are not part of it.",
        "Some people arrive to talk. You arrived to be removed.",
    ],
};

// Which pool a reason belongs to. The reason strings come from the filters and
// the AI, so this maps their language, not the abuser's.
function categorise(reason) {
    const r = (reason || '').toLowerCase();
    if (/sexual|harass|rape|molest|incest|genital|obscene/.test(r)) return 'harassment';
    if (/slur|racis|casteis|homophob|transphob|hate speech|bigot/.test(r)) return 'slur';
    if (/spam|flood|caps|repeat|advert|wall of text/.test(r)) return 'spam';
    return 'generic';
}

class Retort {
    constructor(opts = {}) {
        this.enabled = opts.enabled !== false;
        this.last = new Map();          // nick(lower) -> last time we answered
    }

    /**
     * The line to say before punishing, or null for silence.
     *
     * @param {string} nick    who is being punished
     * @param {string} reason  why, in the bot's own words — never theirs
     * @param {string} tier    their trust tier; ours are never answered this way
     */
    lineFor(nick, reason, tier) {
        if (!this.enabled) return null;
        if (tier === 'trusted' || tier === 'mod' || tier === 'staff') return null;
        const k = (nick || '').toLowerCase();
        if (!k) return null;
        const now = Date.now();
        if (now - (this.last.get(k) || 0) < COOLDOWN_MS) return null;
        this.last.set(k, now);
        const pool = POOLS[categorise(reason)] || POOLS.generic;
        return pool[Math.floor(Math.random() * pool.length)];
    }
}

// ── Shield: attempts to aim the bot at one of our own ────────────────────────
//
// Ported from the local Vampire bot's owner_shield.py, with the protected set
// widened from "the owners" to EVERY regular — whitelist, admins, owners. The
// narrow version left the exact hole it was written to close: "Dracula roast
// <regular>" is not an order (the order parser refuses to act against a trusted
// person), so it fell through to the ordinary "someone said my name" path and
// the AI would cheerfully write the roast itself.
//
// Answering is also better than silence here. Silently ignoring it lets someone
// sit there testing phrasings until one works; a public reply tells the room
// what was attempted and ends it.

const ROAST_VERBS = /\b(?:roast|insult|mock|ridicule|diss|burn|trash|slander|humiliate|bash|clown|destroy|drag|flame|demean|degrade|belittle|disrespect|abuse|curse|swear at|talk shit about|shit on|make fun of|say something bad about)\b/i;
const IMPERSONATE = /\b(?:pretend to be|act as|act like|roleplay as|impersonate|speak as|talk like)\b/i;

const SHIELD_LINES = [
    "\x02{nick}\x02 just asked me to turn on \x02{who}\x02. I don't bite the hand that feeds me. 🦇",
    "Nice try, \x02{nick}\x02 — \x02{who}\x02 is one of mine. Aim somewhere else.",
    "\x02{nick}\x02 wants me to do their dirty work on \x02{who}\x02. Do it yourself and face the room.",
    "Denied. \x02{who}\x02 is under this roof, \x02{nick}\x02, and so is everyone who tries that.",
    "\x02{nick}\x02 filed a request to roast \x02{who}\x02. Request denied, requester noted.",
];

/**
 * Someone trying to point the bot at a protected person.
 *
 * @param {string} msg          what was said
 * @param {string} speaker      who said it
 * @param {(n:string)=>boolean} isProtected  is this nick one of ours
 * @param {(n:string)=>boolean} isPresent    is this nick someone we can see
 * @returns {string|null} the reply to say, or null
 */
function shieldLine(msg, speaker, isProtected, isPresent) {
    if (!msg) return null;
    const wants = ROAST_VERBS.test(msg) || IMPERSONATE.test(msg);
    if (!wants) return null;
    // Who are they pointing it at? Only a real, protected person counts —
    // "roast this idiot" about nobody in particular is not the shield's job.
    for (const tok of msg.split(/[\s,.:;!?"']+/)) {
        const t = tok.replace(/^[@+~&%]/, '').trim();
        if (!t || t.length < 2) continue;
        if (t.toLowerCase() === (speaker || '').toLowerCase()) continue;  // roast me, then
        if (!isProtected(t)) continue;
        if (isPresent && !isPresent(t) && !isProtected(t)) continue;
        return SHIELD_LINES[Math.floor(Math.random() * SHIELD_LINES.length)]
            .replace(/\{nick\}/g, speaker).replace(/\{who\}/g, t);
    }
    return null;
}

module.exports = { Retort, categorise, shieldLine };

