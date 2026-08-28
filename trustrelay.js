'use strict';
// The trust list, carried from the bot that can read it to the bots that cannot.
//
// #batcave-trust holds who is trusted and who has forfeited it, and ChanServ
// will only show that list to an account holding +A. Dracula has one. The
// standbys deliberately do not — they are unregistered by design, because an
// unregistered nick is what lets a spare stand in for a name already taken.
// Verified live: an unidentified client asking ChanServ for the list is told
// "You are not authorized to perform this operation."
//
// So Dracula reads it and passes it on, signed. The signature is the same
// HMAC the peer handshake already uses: proof of holding a shared secret,
// which never crosses the wire. A standby therefore accepts a trust list from
// something that can prove it is one of ours, and from nothing else — which
// matters, because "here is the new list of people you must not moderate" is
// the single most useful message an attacker could forge.
//
// Deliberate properties:
//   - a timestamp inside the signed body, so a captured list cannot be
//     replayed weeks later to restore somebody's standing
//   - all-or-nothing: a partial list is discarded rather than applied, because
//     half a trust list silently strips everyone missing from it
//   - no secret configured means no relay at all, never blanket trust

const crypto = require('crypto');

const MAX_AGE_MS = 10 * 60000;   // a list older than this is stale, not fresh
const ASSEMBLE_MS = 60000;       // give up on a half-delivered list

/** The same construction the handshake uses, so there is one way to prove this. */
function sign(secret, body) {
    return crypto.createHmac('sha256', String(secret))
        .update(String(body)).digest('hex').slice(0, 32);
}

/** Flatten the four sets into one line. */
function encode(state) {
    const part = (tag, set) => `${tag}:${[...(set || [])].join(',')}`;
    return [part('T', state.trusted), part('D', state.denied),
            part('M', state.masks), part('N', state.denyMasks)].join('|');
}

function decode(body) {
    const out = { trusted: new Set(), denied: new Set(), masks: new Set(), denyMasks: new Set() };
    const key = { T: 'trusted', D: 'denied', M: 'masks', N: 'denyMasks' };
    for (const chunk of String(body).split('|')) {
        const at = chunk.indexOf(':');
        if (at < 1) continue;
        const field = key[chunk.slice(0, at)];
        if (!field) continue;
        for (const v of chunk.slice(at + 1).split(',')) if (v) out[field].add(v.toLowerCase());
    }
    return out;
}

/**
 * Build the lines to send. IRC drops a line past ~512 bytes SILENTLY, which is
 * how a 71-name list would arrive as 40 names and nobody would know, so this
 * splits well under that and numbers the pieces.
 *
 * @returns {string[]} each ready to send as `NOTICE <peer> :<line>`
 */
function pack(secret, state, size = 300) {
    if (!secret) return [];
    const body = encode(state);
    const parts = [];
    for (let i = 0; i < body.length; i += size) parts.push(body.slice(i, i + size));
    if (!parts.length) parts.push('');
    const ts = Date.now();
    return parts.map((p, i) =>
        `TRUST ${ts} ${i + 1}/${parts.length} ${sign(secret, `${ts}|${i + 1}/${parts.length}|${p}`)} ${p}`);
}

/** Collects the pieces, verifies each, and hands over only a complete list. */
class TrustFeed {
    constructor(opts = {}) {
        this.secret = opts.secret || '';
        this.prevSecret = opts.prevSecret || '';
        this.parts = new Map();     // ts -> {total, got:Map<idx,string>, at}
        this.lastApplied = 0;
        this.lastError = '';
    }

    get enabled() { return Boolean(this.secret); }

    /**
     * Feed one line in.
     * @returns {object|null} the decoded state once every piece has arrived
     */
    absorb(line) {
        if (!this.enabled) return null;
        const m = String(line || '').match(/^TRUST (\d+) (\d+)\/(\d+) ([0-9a-f]{32}) ?(.*)$/);
        if (!m) return null;
        const [, tsRaw, idxRaw, totalRaw, sig, payload] = m;
        const ts = Number(tsRaw);
        const idx = Number(idxRaw);
        const total = Number(totalRaw);

        // Stale or from the future: refuse. Without this a captured list can be
        // replayed later to restore standing somebody has since lost.
        if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_AGE_MS) {
            this.lastError = 'a trust list arrived stale — ignored'; return null;
        }
        if (ts < this.lastApplied) { this.lastError = 'older than what we hold'; return null; }
        if (!(idx >= 1 && idx <= total && total <= 40)) { this.lastError = 'malformed piece'; return null; }

        const want = `${ts}|${idx}/${total}|${payload}`;
        const ok = [this.secret, this.prevSecret].some((k) => {
            if (!k) return false;
            const a = Buffer.from(sign(k, want));
            const b = Buffer.from(sig);
            return a.length === b.length && crypto.timingSafeEqual(a, b);
        });
        if (!ok) { this.lastError = 'signature did not verify — NOT applied'; return null; }

        let rec = this.parts.get(ts);
        if (!rec) { rec = { total, got: new Map(), at: Date.now() }; this.parts.set(ts, rec); }
        rec.got.set(idx, payload);

        // Drop half-delivered lists rather than let them accumulate.
        for (const [k, v] of this.parts) if (Date.now() - v.at > ASSEMBLE_MS) this.parts.delete(k);

        if (rec.got.size !== rec.total) return null;
        let body = '';
        for (let i = 1; i <= rec.total; i += 1) body += rec.got.get(i);
        this.parts.delete(ts);
        this.lastApplied = ts;
        this.lastError = '';
        return decode(body);
    }
}

module.exports = { pack, TrustFeed, sign, encode, decode, MAX_AGE_MS };
