'use strict';
// What makes a bot read as a person, and what gives it away.
//
// The owner asked for the bot to feel human. The tempting answer is a better
// personality prompt, and that is not where the problem was: getAIResponse() sent
// ONE message with no history, so every line was answered cold. You could not
// have a back-and-forth with it — ask a follow-up and it had already forgotten
// the question. Meanwhile recentSaid already held the last ten minutes of the
// room and the chat path never looked at it.
//
// The tells, in the order they actually give a bot away:
//
//   1. no memory of the last thirty seconds
//   2. repeating itself — the single loudest one
//   3. answering in a register nobody in the room uses (formal English in a
//      room that argues in Hinglish)
//   4. "nick: " in front of every line, which no person types
//   5. replying in 400ms, every time, whatever was asked
//
// None of those are fixed by being wittier, and all of them are fixed here.
// Note what is deliberately NOT here: nothing makes the bot insist it is human.
// A flat denial reads worse than a deflection, and behaviour is what convinces
// anybody — a character people enjoy is achievable, passing a Turing test in a
// room that can see it run !! commands is not.

/**
 * The last few lines of the room, as a transcript the model can follow.
 *
 * Oldest first, because that is the order a conversation happened in, and a
 * model handed it backwards answers the wrong turn.
 *
 * @param {Array<{at:number, nick:string, msg:string}>} log
 * @param {{me?:string, limit?:number, budget?:number, now?:number, windowMs?:number}} opts
 * @returns {string}
 */
function transcript(log, opts = {}) {
    const me = String(opts.me || '').toLowerCase();
    const limit = opts.limit == null ? 8 : opts.limit;
    const budget = opts.budget == null ? 900 : opts.budget;
    const now = opts.now == null ? Date.now() : opts.now;
    const windowMs = opts.windowMs == null ? 8 * 60000 : opts.windowMs;
    const lines = [];
    for (const e of (Array.isArray(log) ? log : []).slice(-limit * 3)) {
        if (!e || !e.msg) continue;
        if (e.at && now - e.at > windowMs) continue;      // stale is not context
        const who = String(e.nick || '?');
        // Our own lines are labelled as ours, so the model can see its own half
        // of the exchange and not repeat it.
        const text = String(e.msg).replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!text) continue;
        lines.push(`${who.toLowerCase() === me ? 'you' : who}: ${text}`);
    }
    // Newest lines matter most, so trim from the FRONT when over budget.
    let out = lines.slice(-limit);
    while (out.length > 1 && out.join('\n').length > budget) out = out.slice(1);
    return out.join('\n');
}

/**
 * Should the reply name the person it answers?
 *
 * "nick: " on every line is one of the loudest tells — nobody types it in a
 * two-person exchange. It IS needed when other people have spoken since, or
 * nobody can tell who is being answered.
 *
 * @param {Array<{nick:string}>} log      the room since their message
 * @param {string} who                    who we are answering
 */
function needsName(log, who) {
    const low = String(who || '').toLowerCase();
    const others = (Array.isArray(log) ? log : [])
        .filter((e) => e && e.nick && String(e.nick).toLowerCase() !== low);
    return others.length > 0;
}

/**
 * How long a person would have taken to type this.
 *
 * An instant answer to everything is a tell no wording can hide. Roughly a fast
 * typist, floored so a one-word reply is not suspiciously immediate and capped
 * so nobody is left waiting on a bot pretending to think.
 */
function typingDelay(text, rnd = Math.random, maxMs = 5200) {
    // The ceiling is configurable, for two reasons. A room may want it snappier
    // than five seconds, and a TEST cannot wait that long for every assertion:
    // the fixed version made nobotchat.js fail about one run in three, because
    // the jitter sometimes pushed a reply past its window. A flaky test is worse
    // than a missing one, because it teaches people to ignore red.
    const cap = Math.max(0, Number(maxMs) || 0);
    if (!cap) return 0;
    const n = String(text || '').length;
    const base = 700 + n * 22;
    const jitter = 0.75 + rnd() * 0.6;
    return Math.round(Math.max(Math.min(600, cap), Math.min(cap, base * jitter)));
}

/**
 * Take the polish off.
 *
 * Chat models write like documents: a full sentence, a capital, a final stop,
 * and an em dash. On IRC that reads as a press release. Short lines lose the
 * trailing full stop the way people's do; stage directions in asterisks go
 * entirely, because a person typing "*smiles*" is rare and a bot doing it every
 * third line is unmistakable.
 */
function deRobot(text, rnd = Math.random) {
    let t = String(text || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/\*[^*]{1,40}\*/g, '').replace(/\s+/g, ' ').trim();
    // Leading "Nick:" — the model apes the prefix it was shown in the transcript.
    // Not the comma form: "meds, kuch nahi" is how a person addresses somebody,
    // and matching it stripped ordinary openers like "haan, bol" down to "bol".
    t = t.replace(/^[A-Za-z0-9_\[\]{}\\^`|.-]{2,20}\s*:\s+/, '');
    // Em dashes and semicolons are not typed in a chat room.
    t = t.replace(/\s*—\s*/g, ' - ').replace(/;\s*/g, ', ');
    if (t.length <= 42) t = t.replace(/\.$/, '');
    // A model that opens with "Ah," or "Well," every time is its own tell.
    t = t.replace(/^(ah|well|indeed|alas|ahh),?\s+/i, (m) => (rnd() < 0.7 ? '' : m));
    return t.trim();
}

/**
 * Is this just something we already said?
 *
 * Repetition is the loudest tell of all, and the one a personality prompt cannot
 * fix: the same clever line twice is worse than a dull one once.
 *
 * @param {string} text
 * @param {string[]} ourLines   flattened lines we have said recently
 */
function isRepeat(text, ourLines) {
    const flat = String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (flat.length < 10) return false;
    return (ourLines || []).some((l) => {
        if (!l || l.length < 10) return false;
        if (l === flat || l.includes(flat) || flat.includes(l)) return true;
        // Near-duplicates: same words, reshuffled or lightly edited.
        const a = new Set(flat.split(' ').filter((w) => w.length > 3));
        const b = new Set(l.split(' ').filter((w) => w.length > 3));
        if (a.size < 3 || b.size < 3) return false;
        let shared = 0;
        for (const w of a) if (b.has(w)) shared += 1;
        return shared / Math.min(a.size, b.size) >= 0.8;
    });
}

// ── Shaping a reply for the room (2026-10-18) ─────────────────────────────
// Three things reached the room that never should have, all from the owner's
// transcript: a model's own planning note ("(Dracula IRC bot) answer concisely
// without evading"), answers cut off mid-word ("2026 hasn't"), and long pastes
// split across lines until the half that arrived made no sense.

const WITTY_DECLINES = Object.freeze([
    "that's a scroll, not a chat line. ask me the short version 🦇",
    'code? I bite necks, not keyboards. GitHub is down the hall.',
    'four hundred years old and I still refuse to paste essays into a chatroom.',
    "that needs a library, not a vampire. one-line questions, one-line answers.",
    'I could write all that, but the room would turn to dust waiting.',
    'too long for a chat window, too short for my patience. narrow it down?',
]);

/** Somebody asking for code or a long document. Answered with a quip, no AI call. */
function asksForLong(text) {
    const t = String(text || '');
    // A request to PRODUCE something long — "what is html" is a fair question.
    return /\b(write|give|make|create|build|generate|send|paste|show|code)\b[^.?!]{0,40}\b(code|html|css|javascript|typescript|python|sql|bash|regex|script|program|website|webpage|web page|app|function|essay|article|tutorial|report)\b/i.test(t)
        || /\b(source code|full code|step[- ]by[- ]step)\b/i.test(t)
        || /\b(html|css|javascript|typescript|python|sql|bash)\s+(code|script|page|file)\b/i.test(t);
}

/** The model narrating its instructions instead of answering. */
function looksLikeLeak(text) {
    const t = String(text || '');
    if (/^\s*\((?=[^)]*\b(bot|assistant|irc|ai|model|system)\b)[^)]{0,80}\)/i.test(t)) return true;
    return LEAK_PHRASES.test(t);
}
// Plain phrases, built as a string, so test/linker.js does not read
// "the user (asked" inside a regex as a call to user().
const LEAK_PHRASES = new RegExp('\\b(?:' + [
    'answer concisely', 'without evading', 'system prompt', 'my instructions',
    'the user asked', 'the user wants', 'the user is asking',
    'we need to answer', 'we need to respond', 'we need to reply',
    'i should answer', 'i should respond', 'i should reply',
    'as an ai\\b', 'language model',
].join('|') + ')', 'i');

/** Code, markup or a programme listing — never pasted into the room. */
function hasCode(text) {
    return /```|<\/?(html|head|body|div|span|script|style|ul|li|table|form)\b[^>]*>|^\s*(def |function |class |import |const |let |var |#include|public static)/im
        .test(String(text || ''));
}

/** Longest prefix of `t`, at most `max` chars, that ends on a full sentence. */
function trimToSentence(t, max) {
    const s = String(t || '').slice(0, max);
    let end = -1;
    const re = /[.!?।…](?=\s|$|["'”’)\]])/g;
    let m;
    while ((m = re.exec(s)) !== null) end = m.index;
    return end >= 0 ? s.slice(0, end + 1).trim() : '';
}

/**
 * Turn a raw model reply into something fit for the room, or null.
 * `why` says what happened: '' (clean), 'trimmed', 'code', 'long', or a reason
 * it was discarded ('empty', 'leak', 'cut') — the caller may ask once more.
 */
function finalizeReply(raw, finish, opts = {}) {
    const rnd = opts.rnd || Math.random;
    const max = opts.max || 420;
    const decline = () => WITTY_DECLINES[Math.floor(rnd() * WITTY_DECLINES.length)];
    const src = String(raw || '').trim();
    if (!src) return { text: null, why: 'empty' };
    if (looksLikeLeak(src)) return { text: null, why: 'leak' };
    if (hasCode(src)) return { text: decline(), why: 'code' };
    let t = deRobot(src, rnd);
    if (finish === 'length') {
        const cut = trimToSentence(t, t.length);
        if (!cut || cut.length < 15) return { text: null, why: 'cut' };
        t = cut;
    }
    if (t.length > max) {
        const cut = trimToSentence(t, max);
        if (cut && cut.length >= 60) return { text: cut, why: 'trimmed' };
        return { text: decline(), why: 'long' };
    }
    return { text: t, why: '' };
}

module.exports = {
    transcript, needsName, typingDelay, deRobot, isRepeat,
    finalizeReply, asksForLong, looksLikeLeak, hasCode, trimToSentence, WITTY_DECLINES,
};
