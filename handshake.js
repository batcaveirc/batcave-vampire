'use strict';
// Proving a bot is one of ours, without services.
//
// Renfield has no NickServ account by design, so nothing the network can tell
// us distinguishes him from anyone else who types /nick Renfield. Recognising
// him by NAME alone would be a backdoor straight to channel operator: the nick
// is unregistered, anyone may take it, and this room is currently under attack
// by somebody whose whole method is wearing other people's names.
//
// So the peers challenge instead. Dracula sends a random nonce; the real
// Renfield answers with an HMAC of it under a secret only the bots hold; an
// impostor cannot, because the secret never crosses the wire. It survives what
// a hostmask cannot — the bots run on GitHub runners whose addresses rotate
// every few hours, so there is no stable host to trust.
//
// Deliberate properties:
//   - the secret is never transmitted, only proof of holding it
//   - each nonce is single-use and short-lived, so a captured answer is
//     worthless a minute later and cannot be replayed
//   - a failed answer grants nothing and is reported, because a wrong answer to
//     a challenge nobody else should receive is somebody trying it on
//   - no secret configured means no recognition at all, never blanket trust

const crypto = require('crypto');

const NONCE_TTL_MS = 60000;

class Handshake {
    /**
     * @param {{secret?:string, peers?:string[]}} opts
     */
    constructor(opts = {}) {
        this.secret = opts.secret || '';
        // The PREVIOUS secret, still accepted. Secrets bind when a workflow run
        // is CREATED, and these bots restart independently every six hours — so
        // rotating one splits the mesh for as long as the oldest run lives.
        // Observed: the secret was rewritten at 12:25 while Dracula's job had
        // been created at 12:11 and one standby's at 12:21; the bots created in
        // the same window still agreed, the others were refused for hours.
        // Accepting the last key as well makes a rotation a slow fade instead
        // of a cliff, and costs nothing — an attacker needs a valid secret
        // either way, and the old one is no easier to obtain than the new.
        this.prevSecret = opts.prevSecret || '';
        this.peers = (opts.peers || []).map((p) => p.toLowerCase());
        this.pending = new Map();   // nick(lower) -> {nonce, at}
    }

    /** Is this a nick we would even bother challenging? */
    isCandidate(nick) {
        return Boolean(this.secret) && this.peers.includes((nick || '').toLowerCase());
    }

    /** A fresh challenge for this nick, or null if we would not challenge it. */
    challenge(nick) {
        if (!this.isCandidate(nick)) return null;
        const nonce = crypto.randomBytes(16).toString('hex');
        this.pending.set(nick.toLowerCase(), { nonce, at: Date.now() });
        return nonce;
    }

    /** The correct answer to a nonce. Both sides compute this the same way. */
    static answer(secret, nonce) {
        return crypto.createHmac('sha256', String(secret))
            .update(String(nonce)).digest('hex').slice(0, 32);
    }

    /**
     * Did they answer their own challenge correctly?
     *
     * Consumes the nonce either way: a wrong answer must not leave the
     * challenge open for a second guess.
     */
    verify(nick, response) {
        const k = (nick || '').toLowerCase();
        const rec = this.pending.get(k);
        this.pending.delete(k);
        if (!rec || !this.secret) return false;
        if (Date.now() - rec.at > NONCE_TTL_MS) { this.lastFailure = 'challenge expired'; return false; }
        const given = Buffer.from(String(response || ''));
        for (const key of [this.secret, this.prevSecret]) {
            if (!key) continue;
            const want = Buffer.from(Handshake.answer(key, rec.nonce));
            // Constant-time, length-checked first because timingSafeEqual
            // throws on a mismatch rather than returning false.
            if (given.length === want.length && crypto.timingSafeEqual(given, want)) {
                this.lastFailure = '';
                return true;
            }
        }
        // Say WHICH failure it was. "could not prove it" reads as an intruder
        // and sent the owner hunting for one, when it was our own key rotation.
        this.lastFailure = 'wrong secret (key rotation, or genuinely not ours)';
        return false;
    }

    /** Are we still waiting on this nick? */
    isPending(nick) {
        const rec = this.pending.get((nick || '').toLowerCase());
        return Boolean(rec && Date.now() - rec.at <= NONCE_TTL_MS);
    }
}

module.exports = { Handshake, NONCE_TTL_MS };
