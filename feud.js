'use strict';
// Two regulars going at each other, and what to do about it.
//
// The owner's problem, in his words: when whitelisted regulars fight, he does
// not want the rest of the room watching it — and separately, people were being
// punished for typing "stupid" and "idiot", which in this room are not abuse at
// all. Those two complaints have the same root. The filter judged WORDS, and a
// fight is not a word. It is a shape: two people, back and forth, quickly,
// aimed at each other.
//
// So this looks at the shape instead, and the ladder he asked for is:
//
//   1. a private NOTICE to both, first, before anything visible happens
//   2. if they carry on, devoice both — the one who STARTED it for longer
//
// The instigator serving more time is the whole point. Devoicing both equally
// punishes the person who was provoked exactly as much as the person who
// provoked them, which the room can see is unfair and which teaches nothing.
//
// WHAT IS NOT A FIGHT, deliberately:
//   - light words on their own. "stupid", "idiot", "pagal", "gadha" are this
//     room's ordinary register between friends. They never start a feud and
//     they never escalate one.
//   - one person swearing about the cricket. Nobody is being aimed at.
//   - a reply that is not aggressive. Being insulted and answering calmly
//     leaves you out of it entirely.

// Words that read as abuse in a list and as affection in this room. Kept
// separate rather than deleted from the filter, because three of them in one
// sentence at one person is still someone being unpleasant — it is only the
// single casual use that must not be punished.
const LIGHT = new Set([
    'stupid', 'idiot', 'moron', 'dumb', 'fool', 'silly', 'noob', 'loser',
    'pagal', 'gadha', 'ullu', 'nautanki', 'bewakoof', 'bewkoof', 'chutiya',
    'kamina', 'kamine', 'harami', 'churail', 'chudail', 'pagli',
]);

/**
 * Hostility that is affection in this room.
 *
 * Observed: "libu ek baat bolni apko.. i hate u so much" between two friends,
 * answered by the target with "johnny hatesss me whenever i come online" — a
 * running joke of theirs. The bot read it as harassment, handed the "victim"
 * operator status and devoiced the joker. The owner said so in the room:
 * "lol johnny masti kar rha".
 *
 * And "Hum usko gayab kardenge" — Hindi for offering to make somebody's
 * problem disappear, said protectively about a friend — was read as a threat
 * and got one of the room's three most active regulars kicked. He rejoined,
 * was answered in customer-service English, and left.
 *
 * These are matched as PHRASES, not words, because the words alone ("hate",
 * "kill") are exactly the ones that carry real menace elsewhere.
 */
const BANTER = [
    /\bi\s+hate\s+(u|you|yew|yu)\b/i,
    /\bhate\s+(u|you)\s+(so\s+much|too|na|yaar|bhai)\b/i,
    /\b(gayab|gaayab)\s+kar\s?denge?\b/i,          // "we'll make them disappear"
    /\bdekh\s+lenge\b/i,                            // "we'll see about that"
    /\b(maar|maro|maardunga)\s+(dunga|denge)?\s*(tujhe|tumhe)?\b.{0,12}\b(yaar|bhai|lol|haha|😂|🤣)/i,
    /\bkill(ing)?\s+(me|myself)\b/i,                  // "this weather is killing me"
];

/**
 * Laughter, which is the strongest banter signal there is and was going unread.
 *
 * "GirlInSpecs_: this is room where we abuse poke harass bully others 😄" — a
 * welcome joke to a newcomer, devoiced as "encouraging harassment" while the
 * owner was typing "they joking" one line below. The emoji was right there.
 *
 * Deliberately NOT an excuse for everything. Someone can put 🤣 after a slur,
 * and people do. Laughter softens the categories that turn on INTENT —
 * harassment, threats, insults, where a joke and an attack use the same words
 * — and does nothing at all for slurs, sexual content or doxxing, which are
 * the same act whether or not the person found it funny.
 */
const LAUGHTER = /(\u{1F602}|\u{1F923}|\u{1F604}|\u{1F605}|\u{1F606}|\u{1F61C}|\u{1F643}|\u{1F62D}|\bl+o+l+\b|\bl+m+a+o+\b|\bha(ha)+\b|\bhe(he)+\b|\brofl\b|:\)|:-\)|:D\b|xD\b)/iu;

/**
 * Hinglish that reads vulgar to a model and means something ordinary here.
 *
 * "bkchodi" is idle chat. A newcomer said "just friendships and bkchodi" in
 * her first two minutes and was kicked for a SLUR — while the owner, exempt,
 * was typing "we like doing bkchodi" in the same conversation. A regular said
 * what everyone was thinking: "Gyi ab nahi aaye gyi vo" — she's gone, she
 * won't come back.
 *
 * These share a root with something coarse and are not used that way. They
 * are matched as whole tokens, so a genuine use of the root word is untouched.
 */
const HINGLISH_BENIGN = new Set([
    'bakchodi', 'bakchod', 'bakchodhi', 'bkchodi', 'bkchod', 'bakchodi',
    'bakwas', 'bakwaas', 'faltu', 'timepass', 'jugaad', 'chaman', 'chapri',
    'bhasad', 'jhandu', 'nalla', 'ghanta', 'bakait', 'bakaiti',
]);

/**
 * Is the only questionable thing here ordinary Hinglish?
 *
 * Used to drop an AI verdict whose evidence is one of these and nothing else.
 * It deliberately does NOT look at the whole message — a real slur sitting
 * beside "bakchodi" must still count.
 */
function isBenignHinglish(quote) {
    const toks = String(quote || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (!toks.length) return false;
    return toks.every((t) => HINGLISH_BENIGN.has(t) || LIGHT.has(t) || t.length < 3);
}

/** Did they laugh while saying it? */
function hasLaughter(text) { return LAUGHTER.test(String(text || '')); }

/** Is the whole line just this room's affectionate hostility? */
function isBanter(text) {
    return BANTER.some((re) => re.test(String(text || '')));
}

const WINDOW_MS = 90000;        // how long a fight stays "in progress"
const START_AT = 2;             // aggressive lines before the private nudge
const ESCALATE_AT = 2;          // further lines AFTER the nudge before devoicing

/**
 * How hard is this line?
 *
 * @param {string} text
 * @param {{severe:Set<string>, heavy:Set<string>}} lists
 * @returns {'none'|'light'|'heavy'|'severe'}
 */
function severityOf(text, lists) {
    const words = String(text || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const uniq = new Set(words);
    for (const w of uniq) if (lists.severe && lists.severe.has(w)) return 'severe';

    // Heavy words are the filtered list MINUS the light ones. A word being on
    // the filter list is not enough on its own any more — that is exactly what
    // was catching "idiot".
    let heavy = 0;
    let light = 0;
    for (const w of uniq) {
        if (LIGHT.has(w)) { light += 1; continue; }
        if (lists.heavy && lists.heavy.has(w)) heavy += 1;
    }
    if (heavy) return 'heavy';
    // Several light words at once is no longer banter, it is a pile-on.
    if (light >= 3) return 'heavy';
    return light ? 'light' : 'none';
}

/**
 * Is this line AIMED at somebody in the room?
 *
 * IRC convention does the work: people put the name first. A name anywhere in a
 * short aggressive line counts too, because "tu bachega nahi soul" is aimed at
 * soul whichever end the name is on.
 */
function aimedAt(text, isPresent) {
    const tokens = String(text || '').split(/[\s,:;!?.]+/).filter(Boolean);
    for (const t of tokens) {
        const n = t.replace(/^[@+~&%]/, '');
        if (n.length >= 3 && isPresent(n)) return n;
    }
    return '';
}

class Feuds {
    /**
     * @param {{windowMs?:number, startAt?:number, escalateAt?:number,
     *          devoiceMin?:number, instigatorBonus?:number}} opts
     */
    constructor(opts = {}) {
        this.windowMs = opts.windowMs || WINDOW_MS;
        this.startAt = opts.startAt || START_AT;
        this.escalateAt = opts.escalateAt || ESCALATE_AT;
        this.devoiceMin = opts.devoiceMin || 2;
        // The one who started it serves longer. Asked for explicitly, and it is
        // the only version of this that reads as fair from outside.
        this.instigatorBonus = opts.instigatorBonus == null ? 3 : opts.instigatorBonus;
        this.rows = new Map();   // "chan|a|b" (sorted) -> state
    }

    key(chan, a, b) {
        const pair = [a.toLowerCase(), b.toLowerCase()].sort();
        return `${String(chan).toLowerCase()}|${pair[0]}|${pair[1]}`;
    }

    /**
     * Record one line and say what should happen.
     *
     * @param {string} chan
     * @param {string} from     who spoke
     * @param {string} text     what they said
     * @param {{severity:string, target:string, now?:number}} ctx
     * @returns {null|{action:'nudge',a:string,b:string}
     *              |{action:'devoice',instigator:string,other:string,
     *                instigatorMin:number,otherMin:number}}
     */
    see(chan, from, text, ctx) {
        const now = ctx.now || Date.now();
        const target = ctx.target;
        // No target, no feud. Somebody swearing at the weather is not fighting.
        if (!target || target.toLowerCase() === from.toLowerCase()) return null;
        // Light words never start or feed a fight. This is the whole fix for
        // people being punished over "stupid".
        if (ctx.severity !== 'heavy' && ctx.severity !== 'severe') return null;

        const k = this.key(chan, from, target);
        let row = this.rows.get(k);
        if (!row || now - row.last > this.windowMs) {
            row = { instigator: from, count: 0, nudged: false, sinceNudge: 0, last: now, who: new Set() };
            this.rows.set(k, row);
        }
        row.last = now;
        row.count += 1;
        row.who.add(from.toLowerCase());
        if (row.nudged) row.sinceNudge += 1;

        // One person being unpleasant at somebody who is not answering is a
        // different problem, handled by the ordinary ladder. A FEUD needs both
        // of them in it.
        if (row.who.size < 2) return null;

        if (!row.nudged && row.count >= this.startAt) {
            row.nudged = true;
            row.sinceNudge = 0;
            return { action: 'nudge', a: row.instigator, b: this.other(row, target, from) };
        }
        if (row.nudged && row.sinceNudge >= this.escalateAt) {
            this.rows.delete(k);
            const instigator = row.instigator;
            const other = this.other(row, target, from);
            return {
                action: 'devoice',
                instigator,
                other,
                instigatorMin: this.devoiceMin + this.instigatorBonus,
                otherMin: this.devoiceMin,
            };
        }
        return null;
    }

    /** The other half of the pair, given whoever just spoke. */
    other(row, target, from) {
        const inst = row.instigator.toLowerCase();
        for (const n of [from, target]) if (n.toLowerCase() !== inst) return n;
        return target;
    }

    /** Forget a pair — used when a moderator settles it by hand. */
    clear(chan, a, b) { this.rows.delete(this.key(chan, a, b)); }

    get size() { return this.rows.size; }
}

module.exports = { Feuds, severityOf, aimedAt, isBanter, hasLaughter, isBenignHinglish, HINGLISH_BENIGN, BANTER, LAUGHTER, LIGHT, WINDOW_MS };
