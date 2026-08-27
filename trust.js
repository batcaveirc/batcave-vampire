'use strict';
// Trust that can be edited without touching a secret.
//
// The problem, in the owner's words: adding or removing a whitelisted regular
// meant editing a GitHub secret, and a secret is WRITE-ONLY — you cannot read
// the current list in order to change one name in it. That is why UNTRUST had
// to exist at all: a subtraction list, because subtraction was the only edit
// possible. It works, but "who is trusted" now lives in two variables and
// neither can be read back.
//
// WHY NOT A FILE IN THE REPO. Both repos are public. A committed trust list
// publishes exactly which names are worth impersonating, in a room whose
// attackers' whole method is wearing other people's names. It would also mean
// a commit and a redeploy for every change.
//
// WHY CHANSERV. The network is already a database with an admin interface and
// an audit trail. A registered channel's access list:
//
//   - survives every restart, because it lives on the server, not in the job
//   - has no length limit, unlike a topic
//   - is editable with one command, from IRC, by anyone with +f
//   - is NOT public — only people with access can list it
//   - can be read back, which a secret cannot
//
// So: one registered channel whose access list IS the whitelist. Adding
// somebody is `!!trust add nick`; removing them is `!!trust del nick`; and both
// stick without a deploy.
//
// The secrets remain the fallback. If no trust channel is configured, or
// ChanServ never answers, WHITELIST and UNTRUST work exactly as before —
// switching this on must never be the reason the room loses its moderators.

/**
 * Parse an Atheme `ChanServ FLAGS #chan` listing.
 *
 * The reply arrives as a run of NOTICEs looking roughly like:
 *
 *   Entry Nickname/Host          Flags
 *   ----- ---------------------- -----
 *   1     Vikram                 +AFORVefiorstv (FOUNDER)
 *   2     *!*@*                  +V
 *   3     LiBu                   +Vo
 *   ----- ---------------------- -----
 *   End of #batcave-trust FLAGS listing.
 *
 * Only numbered rows are entries. Everything else is furniture.
 *
 * @param {string} line one NOTICE from ChanServ
 * @returns {{who:string, flags:string}|null}
 */
function parseFlagRow(line) {
    const m = String(line || '').trim().match(/^(\d+)\s+(\S+)\s+(\+\S*)/);
    if (!m) return null;
    return { who: m[2], flags: m[3] };
}

/** Is this the last line of a listing? */
function isEndOfList(line) {
    return /End of .* FLAGS listing/i.test(String(line || ''));
}

class TrustList {
    /**
     * @param {{channel:string, flag?:string, send:Function, log?:Function}} opts
     */
    constructor(opts = {}) {
        this.channel = String(opts.channel || '').trim();
        // Which flag marks a trusted regular. +V is autovoice, which is what
        // being a regular means here anyway, so the two stay in step and the
        // list is meaningful to a human reading it in ChanServ.
        this.flag = opts.flag || 'V';
        // The SECOND list, in the same channel. Atheme marks an access entry
        // with +b as an auto-kick, which is exactly the right meaning for
        // "this person has forfeited standing" — and its only side effect is
        // keeping them out of a secret channel they would never join anyway.
        //
        // Two lists in one readable place beats a trusted list on the server
        // and an untrusted one in a write-only secret, which is what this
        // replaces. Both are auditable: ChanServ records who changed each
        // entry and when.
        this.denyFlag = opts.denyFlag || 'b';
        this.send = opts.send;
        this.log = opts.log || (() => {});
        this.names = new Set();
        this.denied = new Set();
        this.loading = false;
        this.loaded = false;
        this.pending = new Set();       // trusted, while a listing is in flight
        this.pendingDeny = new Set();   // denied, likewise
        this.lastRead = 0;
        // Our own services account. It has to HOLD +V and +b to be
        // allowed to hand them out (see writeRefused), which would
        // otherwise put the bot in its own trusted and denied lists.
        this.self = String(opts.self || '').toLowerCase();
        this.lastWrite = 0;      // when we last asked ChanServ to change something
        this.lastWriteWho = '';  // and about whom, so a refusal can name them
    }

    get enabled() { return Boolean(this.channel); }

    /** Ask ChanServ for the list. Harmless to call again. */
    refresh() {
        if (!this.enabled || this.loading) return;
        this.loading = true;
        this.pending = new Set();
        this.pendingDeny = new Set();
        this.send(`PRIVMSG ChanServ :FLAGS ${this.channel}`);
        // If ChanServ never answers — not registered, no access, services
        // split — the listing must not stay open forever holding an empty
        // list that then replaces a working whitelist.
        setTimeout(() => {
            if (!this.loading) return;
            this.loading = false;
            this.log('WARN', `ChanServ did not answer FLAGS ${this.channel}. `
                + 'Keeping the previous trust list; check the channel is registered '
                + 'and that this bot holds +f on it.');
        }, 15000);
    }

    /**
     * Feed one ChanServ NOTICE in. Returns true when a listing just completed.
     */
    absorb(line) {
        if (!this.enabled || !this.loading) return false;
        if (/is not registered|no such channel|not authorized|insufficient/i.test(line)) {
            this.loading = false;
            this.log('WARN', `Trust channel ${this.channel} unusable: ${String(line).slice(0, 80)}. `
                + 'Falling back to the WHITELIST secret.');
            return false;
        }
        const row = parseFlagRow(line);
        if (row) {
            // A hostmask entry is real access but not a name we can match a
            // speaker against, so it is kept out of the name list rather than
            // silently trusting everybody via *!*@*.
            const plain = !row.who.includes('!') && !row.who.includes('@') && !row.who.includes('*');
            const key = row.who.toLowerCase();
            // We must hold +V and +b to be able to grant them, so we
            // appear in our own listing. Reading that back would put the
            // bot in its own denied list and have it distrust itself.
            const mine = this.self && key === this.self;
            if (plain && !mine && row.flags.includes(this.flag)) this.pending.add(key);
            if (plain && !mine && row.flags.includes(this.denyFlag)) this.pendingDeny.add(key);
            return false;
        }
        if (isEndOfList(line)) {
            this.loading = false;
            this.loaded = true;
            this.lastRead = Date.now();
            this.names = this.pending;
            this.denied = this.pendingDeny;
            this.log('OK', `Trust list from ${this.channel}: ${this.names.size} trusted, `
                + `${this.denied.size} denied.`);
            return true;
        }
        return false;
    }

    /** Every write goes through here so a later refusal can be attributed. */
    write(nick, change) {
        this.lastWrite = Date.now();
        this.lastWriteWho = String(nick);
        this.send(`PRIVMSG ChanServ :FLAGS ${this.channel} ${nick} ${change}`);
    }

    /**
     * ChanServ refusing a write we just made.
     *
     * This existed as a silent path and cost three attempts at `!!trust
     * seed` with no explanation offered: absorb() only looked at notices
     * while a LISTING was open, so every refusal of a write landed in a
     * branch that discarded it. ChanServ was saying exactly what was
     * wrong the whole time and nobody was reading it.
     *
     * The cause it was hiding: Atheme lets a non-founder hand out only
     * the flags it HOLDS. +f is permission to edit the list, not
     * permission to grant +V, so a bot with +Af silently writes nothing.
     *
     * @returns {string|null} a sentence worth showing an owner
     */
    writeRefused(line) {
        const t = String(line || '');
        // Only interpret a refusal as ours if we just wrote. ChanServ
        // talks for many reasons and most are nothing to do with us.
        if (!this.lastWrite || Date.now() - this.lastWrite > 20000) return null;
        if (!/not authorized|access denied|insufficient|you may only manipulate|is not registered|no such/i.test(t)) return null;
        const who = this.lastWriteWho ? ` (writing \x02${this.lastWriteWho}\x02)` : '';
        if (/you may only manipulate|not authorized|access denied|insufficient/i.test(t)) {
            return `ChanServ refused a change to ${this.channel}${who}: ${t.slice(0, 90)} `
                + `— I hold +f but Atheme only lets me hand out flags I hold myself. `
                + `Fix: \x02/msg ChanServ FLAGS ${this.channel} ${this.self || '<my account>'} `
                + `+Af${this.flag}${this.denyFlag}\x02`;
        }
        return `ChanServ refused a change to ${this.channel}${who}: ${t.slice(0, 110)}`;
    }

    add(nick) {
        if (!this.enabled) return false;
        this.write(nick, `+${this.flag}`);
        this.names.add(String(nick).toLowerCase());
        return true;
    }

    remove(nick) {
        if (!this.enabled) return false;
        this.write(nick, `-${this.flag}`);
        this.names.delete(String(nick).toLowerCase());
        return true;
    }

    /** Mark somebody as having forfeited standing, durably. */
    deny(nick) {
        if (!this.enabled) return false;
        const k = String(nick).toLowerCase();
        // Remove any trust they hold in the same breath, or the two lists
        // disagree and whichever is read last wins.
        this.write(nick, `-${this.flag}+${this.denyFlag}`);
        this.names.delete(k);
        this.denied.add(k);
        return true;
    }

    /** Undo that. */
    allow(nick) {
        if (!this.enabled) return false;
        this.write(nick, `-${this.denyFlag}`);
        this.denied.delete(String(nick).toLowerCase());
        return true;
    }

    isDenied(nick) { return this.denied.has(String(nick || '').toLowerCase()); }
    deniedList() { return [...this.denied].sort(); }

    has(nick) { return this.names.has(String(nick || '').toLowerCase()); }
    get size() { return this.names.size; }
    list() { return [...this.names].sort(); }
}

/**
 * The effective whitelist.
 *
 * ChanServ wins when it has actually answered — that is the whole point, an
 * editable list beats a pair of secrets nobody can read. Until then the
 * secrets hold the room, so a services outage or a misconfigured channel
 * cannot quietly strip every regular of their standing.
 *
 * @param {TrustList} trust
 * @param {Set<string>} fromSecret WHITELIST
 * @param {Set<string>} untrust    UNTRUST
 */
function effective(trust, fromSecret, untrust) {
    // An EMPTY trust channel means "not set up yet" far more often than it
    // means "nobody in this room is trusted". Handing over to it on the first
    // read would strip every regular of their standing the moment the channel
    // was registered — silently, because losing an exemption looks exactly like
    // never having had one. The secret keeps the room until somebody is
    // actually in the channel; `!!trust seed` is how you get there.
    const useChannel = trust && trust.enabled && trust.loaded && trust.names.size > 0;
    const base = useChannel ? trust.names : fromSecret;
    // Denied wins over trusted, from either source. The channel's deny list is
    // the durable one; the UNTRUST secret stays as a fallback for rooms with
    // no trust channel configured.
    const denied = new Set([...untrust, ...(trust && trust.denied ? trust.denied : [])]);
    return new Set([...base].filter((n) => !denied.has(n)));
}

module.exports = { TrustList, effective, parseFlagRow, isEndOfList };
