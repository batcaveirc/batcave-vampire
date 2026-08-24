'use strict';
// Plain-English moderation, spoken by people who already have the authority.
//
//   <Vikram> Dracula kick spammer99
//   <Scarlet> dracula, ban troll42 for flooding
//   <johnny> Dracula give voice to newguy
//
// This is NOT the AI moderator. The AI decides FOR ITSELF whether something was
// abuse, which is why it is fenced behind six gates and may never ban. Here a
// trusted human has already decided and is simply saying so; the only job is to
// understand them correctly. That makes a deterministic parser the right tool —
// it does the same thing every time, needs no API, and cannot be talked into
// anything by the message it is reading.
//
// The guards exist because the cost of a false positive is throwing a real
// person out of the room:
//
//   - the bot must be ADDRESSED BY NAME, so talking *about* a kick is never
//     mistaken for ordering one
//   - questions are ignored ("should we ban him?")
//   - negations are ignored ("don't kick him", "no need to ban her")
//   - the target must be present, and must not be another bot or me
//   - a trusted person cannot be targeted by this at all, so the hierarchy
//     cannot be turned against the people it protects

const ACTIONS = [
    // Order matters: every entry must be tried BEFORE any entry whose
    // pattern it contains. 'take the voice from' contains 'voice', so
    // devoice precedes voice; likewise unban before ban, unmute before
    // mute. Get this backwards and 'take the voice from bob' voices him.
    { verb: 'unban',   re: /\b(?:un-?ban|remove (?:the )?ban (?:on|from)|lift (?:the )?ban (?:on|from))\b/ },
    { verb: 'unmute',  re: /\b(?:un-?mute|un-?quiet|let .* (?:talk|speak) again)\b/ },
    { verb: 'devoice', re: /\b(?:take (?:the )?voice (?:from|off|away from)|de-?voice|remove voice from)\b/ },
    { verb: 'voice',   re: /\b(?:give (?:a )?voice to|voice up|re-?voice|voice)\b/ },
    { verb: 'mute',    re: /\b(?:mute|quiet|shut (?:up|him|her|them) up|silence)\b/ },
    { verb: 'ban',     re: /\b(?:ban|banish|blacklist|get rid of|throw out permanently)\b/ },
    { verb: 'kick',    re: /\b(?:kick|boot|remove|throw out|chuck out)\b/ },
    { verb: 'warn',    re: /\b(?:warn|tell off|caution)\b/ },
];

// "don't kick him" must never become a kick. Checked across the whole message
// rather than just before the verb, because "kick him? no, don't" exists.
const NEGATION = /\b(?:don'?t|do not|never|no need to|stop|cancel|undo|instead of|rather than|without)\b/i;

// Words that look like a nickname but are not the target.
const NOT_A_NICK = new Set([
    'the', 'this', 'that', 'him', 'her', 'them', 'they', 'it', 'user', 'guy',
    'person', 'someone', 'anybody', 'anyone', 'everyone', 'all', 'a', 'an',
    'to', 'from', 'for', 'and', 'please', 'now', 'up', 'out', 'off', 'away',
    'voice', 'ban', 'kick', 'mute', 'warn', 'again',
]);

/**
 * Understand a moderation order, or return null.
 *
 * @param {string} text     the message as typed
 * @param {string} botNick  who we are, so "Dracula ..." is recognised
 * @param {(n:string)=>boolean} isPresent  is this nick in the room
 * @returns {{action:string,target:string,reason:string}|null}
 */
function parseOrder(text, botNick, isPresent) {
    if (!text || !botNick) return null;
    const raw = text.trim();

    // 1. Addressed to us? "Dracula kick x", "dracula, kick x", "kick x, Dracula"
    const name = botNick.toLowerCase().replace(/[^a-z0-9]/g, '');
    const lower = raw.toLowerCase();
    const addressed = new RegExp(`(^|[^a-z0-9])${name}([^a-z0-9]|$)`, 'i').test(lower);
    if (!addressed) return null;

    // 2. A question is a question, not an instruction.
    if (/\?\s*$/.test(raw)) return null;

    // 3. Negation anywhere means do nothing. Better to miss an order — the
    //    person can repeat it — than to act on its opposite.
    if (NEGATION.test(raw)) return null;

    // Strip our own name so it can never be read as the target.
    const body = lower.replace(new RegExp(name, 'gi'), ' ');

    // 4. Which action? First match wins, longest phrasings are listed first.
    let action = null;
    for (const a of ACTIONS) {
        if (a.re.test(body)) { action = a.verb; break; }
    }
    if (!action) return null;

    // 5. Who? The first token that is actually someone in the room. Checking
    //    presence is what makes this safe: an ordinary sentence rarely contains
    //    a word that happens to be a nickname of someone standing here.
    let target = null;
    for (const tok of raw.split(/[\s,.:;!]+/)) {
        const t = tok.replace(/^[@+~&%]/, '').trim();
        if (!t || t.length < 2) continue;
        const tl = t.toLowerCase();
        if (tl === name || NOT_A_NICK.has(tl)) continue;
        if (isPresent(t)) { target = t; break; }
    }
    if (!target) return null;

    // 6. A reason, if they gave one.
    const m = raw.match(/\b(?:for|because|reason:?)\s+(.{2,120})$/i);
    return { action, target, reason: m ? m[1].trim() : '' };
}

// Nicks a spoken order may never be aimed at: services, and any bot sharing
// the room. recruit.js already refused to invite these; handleOrder did not
// refuse to KICK them, so "Dracula kick ChanBot" would have had the bot swing
// at services. Extend with BOT_NICKS rather than editing this list — rooms
// acquire other people's bots (Almond, NotSoBot) without warning.
const PROTECTED_NICKS = new Set([
    'chanserv', 'nickserv', 'operserv', 'hostserv', 'memoserv', 'botserv',
    'global', 'chanbot', 'luna1', 'vampire', 'dracula', 'notsobot',
    ...(process.env.BOT_NICKS || '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean),
]);

module.exports = { parseOrder, PROTECTED_NICKS };
