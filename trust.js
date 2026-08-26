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
        this.send = opts.send;
        this.log = opts.log || (() => {});
        this.names = new Set();
        this.loading = false;
        this.loaded = false;
        this.pending = new Set();     // collected while a listing is in flight
        this.lastRead = 0;
    }

    get enabled() { return Boolean(this.channel); }

    /** Ask ChanServ for the list. Harmless to call again. */
    refresh() {
        if (!this.enabled || this.loading) return;
        this.loading = true;
        this.pending = new Set();
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
            if (!row.who.includes('!') && !row.who.includes('@') && !row.who.includes('*')
                && row.flags.includes(this.flag)) {
                this.pending.add(row.who.toLowerCase());
            }
            return false;
        }
        if (isEndOfList(line)) {
            this.loading = false;
            this.loaded = true;
            this.lastRead = Date.now();
            this.names = this.pending;
            this.log('OK', `Trust list from ${this.channel}: ${this.names.size} names.`);
            return true;
        }
        return false;
    }

    add(nick) {
        if (!this.enabled) return false;
        this.send(`PRIVMSG ChanServ :FLAGS ${this.channel} ${nick} +${this.flag}`);
        this.names.add(String(nick).toLowerCase());
        return true;
    }

    remove(nick) {
        if (!this.enabled) return false;
        this.send(`PRIVMSG ChanServ :FLAGS ${this.channel} ${nick} -${this.flag}`);
        this.names.delete(String(nick).toLowerCase());
        return true;
    }

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
    return new Set([...base].filter((n) => !untrust.has(n)));
}

module.exports = { TrustList, effective, parseFlagRow, isEndOfList };
