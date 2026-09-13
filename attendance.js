'use strict';
// Who actually turns up and talks — remembered by the bot that CAN remember.
//
// Dracula's automatic promotion has never once fired. Not because it is broken:
// because its evidence is amnesiac. It requires 40 messages, and it counts them
// in a Map that is created when the process starts and thrown away when the
// host hands over roughly every six hours. The owner described the people he
// wants trusted as the ones who "talk normally everyday" — which is precisely
// the pattern this could never see. Somebody who says fifteen lines a day for a
// fortnight scores fifteen, forever; somebody who floods one afternoon scores
// forty and qualifies.
//
// The room already has a durable memory, and it is not in this process. Luna
// relays #batcave into Discord line by line, and Discord keeps it. Weeks of
// "who spoke, on which day" is sitting there being used for nothing.
//
// So Luna counts the days and Dracula enforces the result. This module is the
// wire between them, and it is written to be suspicious, because "here is the
// list of people you should trust" is the single most useful message an
// attacker could forge. Properties, each deliberate:
//
//   - HMAC-signed with the shared peer secret, which never crosses the wire.
//     No secret configured means no feed at all, never blanket trust.
//   - the timestamp is INSIDE the signed body, so a captured report cannot be
//     replayed weeks later to reinstate somebody.
//   - it carries EVIDENCE, not authority. A report says "this nick spoke on 9
//     separate days". It cannot say "trust them" — Dracula still demands a
//     registered account, checks the deny list, and applies its own thresholds.
//   - nicks are validated, counts are bounded, and a malformed entry is
//     dropped rather than being allowed to mean zero or infinity.
//
// The nick→account step is the crux and lives on Dracula's side on purpose. A
// nick is wearable by anybody; Luna sees nicks in a relay and cannot tell
// aishwarya from somebody who took her name this morning. Activity earns a
// LOOK, never the standing itself.

const crypto = require('crypto');

const TAG = 'REGULARS';
const MAX_AGE_MS = 30 * 60000;      // a report older than this is stale, not fresh
const MAX_DAYS = 400;               // a count beyond this is a bug or a lie
const MAX_ENTRIES = 200;
// IRC nick characters, per RFC 2812 plus the punctuation this network allows.
const NICK_OK = /^[A-Za-z0-9_\[\]{}\\^`|.-]{1,32}$/;

/** The same construction the peer handshake and the trust relay already use. */
function sign(secret, body) {
    return crypto.createHmac('sha256', String(secret))
        .update(String(body)).digest('hex').slice(0, 32);
}

/**
 * Build the line Luna sends. Exported so the test signs exactly the way the
 * sender does, rather than asserting against a string I typed out by hand.
 */
function encodeReport(secret, days, at = Date.now()) {
    const pairs = [...days.entries()]
        .filter(([nick, n]) => NICK_OK.test(String(nick)) && Number.isFinite(Number(n)))
        .slice(0, MAX_ENTRIES)
        .map(([nick, n]) => `${nick}:${Math.min(MAX_DAYS, Math.max(0, Math.round(Number(n))))}`);
    const body = `${at} ${pairs.join(',')}`;
    return `${TAG} ${body} ${sign(secret, body)}`;
}

/**
 * Read a report, and refuse it unless it proves itself.
 *
 * Both the current secret and the previous one are accepted, because the two
 * bots restart independently and a rotation otherwise means a window where each
 * is certain the other is an impostor. Designs that require perfect
 * simultaneity fail on this network roughly every time it is tried.
 *
 * @returns {{ok:boolean, why:string, days:Map<string,number>}}
 */
function verifyReport(line, secrets, now = Date.now()) {
    const out = { ok: false, why: '', days: new Map() };
    const keys = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean).map(String);
    if (!keys.length) { out.why = 'no PEER_SECRET set, so nothing can prove itself'; return out; }
    const m = String(line || '').trim().match(/^REGULARS\s+(\d+)\s+(\S*)\s+([0-9a-f]{32})$/);
    if (!m) { out.why = 'not a report'; return out; }
    const [, ts, payload, sig] = m;
    const body = `${ts} ${payload}`;
    // timingSafeEqual, so a wrong signature cannot be narrowed down by how long
    // the comparison took. Same length always, since both sides are 32 hex.
    const given = Buffer.from(sig, 'utf8');
    const good = keys.some((k) => {
        const want = Buffer.from(sign(k, body), 'utf8');
        return want.length === given.length && crypto.timingSafeEqual(want, given);
    });
    if (!good) { out.why = 'signature does not match'; return out; }
    const at = Number(ts);
    // Future-dated as well as stale: a clock-skewed or hand-rolled timestamp is
    // not evidence of anything, and accepting one widens the replay window.
    if (!Number.isFinite(at) || Math.abs(now - at) > MAX_AGE_MS) {
        out.why = `signed ${Math.round((now - at) / 60000)} min away from now — stale`;
        return out;
    }
    for (const piece of String(payload).split(',')) {
        if (!piece) continue;
        const at2 = piece.lastIndexOf(':');
        if (at2 < 1) continue;
        const nick = piece.slice(0, at2);
        const n = Number(piece.slice(at2 + 1));
        if (!NICK_OK.test(nick)) continue;                 // dropped, never defaulted
        if (!Number.isInteger(n) || n < 0 || n > MAX_DAYS) continue;
        out.days.set(nick.toLowerCase(), n);
    }
    out.ok = true;
    return out;
}

/**
 * What the receiving side keeps: how many separate days each account has been
 * heard on, as most recently reported.
 *
 * Keyed on the lowercased nick because that is all a relay can see. Dracula
 * maps that to an account itself before any of it counts.
 */
class Attendance {
    constructor() {
        this.days = new Map();
        this.at = 0;
    }

    /** Replace wholesale: a partial report must not silently demote everybody. */
    absorb(days) {
        if (!days || !days.size) return false;
        this.days = new Map(days);
        this.at = Date.now();
        return true;
    }

    daysFor(nick) { return this.days.get(String(nick || '').toLowerCase()) || 0; }
    get size() { return this.days.size; }
    fresh(now = Date.now(), within = 26 * 3600 * 1000) {
        return Boolean(this.at) && now - this.at < within;
    }
}

module.exports = { Attendance, encodeReport, verifyReport, sign, TAG, MAX_AGE_MS, MAX_DAYS };
