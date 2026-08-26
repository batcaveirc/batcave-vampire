'use strict';
// Trust that follows behaviour, not just a moderator's memory.
//
// The owner asked for two things: keep the manual commands, and let people
// gain or lose standing from what they actually do in the rooms. JAILER is the
// case that prompted it — he threatened another regular and kept his
// privileges, because nothing connected "what he just did" to "what he is
// allowed to do".
//
// THE HARD PART IS NOT THE RULE, IT IS THE MEMORY.
//
// These bots restart roughly every forty minutes. Any counter kept in the
// process is gone long before somebody could earn anything with it, so
// "trusted after three days of good behaviour" cannot be measured locally —
// the bot has never seen three days. Storing it would mean a database this
// project deliberately does not have.
//
// So earning trust leans on what the NETWORK already remembers: a services
// account, and how long ago it was registered. That is durable, free, checkable
// at any moment, and impossible to fake by idling — which matters, because the
// obvious attack on any auto-promotion is to behave for exactly as long as it
// takes and then use the privileges.
//
// LOSING trust needs no memory at all. It is a response to something that just
// happened, and it is the half that actually protects the room.

// Losing trust is immediate and needs no history.
const FORFEIT = {
    severe: 'severe language',
    feud: 'starting a fight with another regular',
    strikes: 'repeated warnings',
};

class Reputation {
    /**
     * @param {{minAccountDays?:number, minMessages?:number, maxStrikes?:number}} opts
     */
    constructor(opts = {}) {
        // How old a services account must be before it counts for anything.
        // Thirty days is not arbitrary: it is longer than a raid stays
        // interested, and long enough that registering an account purely to
        // farm trust is a month of somebody's patience.
        this.minAccountDays = opts.minAccountDays == null ? 30 : opts.minAccountDays;
        // And they must have actually TALKED here, not merely idled.
        this.minMessages = opts.minMessages == null ? 40 : opts.minMessages;
        this.maxStrikes = opts.maxStrikes == null ? 3 : opts.maxStrikes;
        this.said = new Map();        // nick -> messages seen this run
        this.offences = new Map();    // nick -> offences seen this run
    }

    key(n) { return String(n || '').toLowerCase(); }

    /** One ordinary message. */
    spoke(nick) {
        const k = this.key(nick);
        this.said.set(k, (this.said.get(k) || 0) + 1);
    }

    /** One thing they should not have done. */
    offended(nick) {
        const k = this.key(nick);
        this.offences.set(k, (this.offences.get(k) || 0) + 1);
    }

    messages(nick) { return this.said.get(this.key(nick)) || 0; }
    strikes(nick) { return this.offences.get(this.key(nick)) || 0; }

    /**
     * Should this person LOSE trust, right now, for what they just did?
     *
     * @param {string} nick
     * @param {'severe'|'feud'|'strikes'} what
     * @returns {string} the reason, or '' to leave them alone
     */
    forfeits(nick, what) {
        if (what === 'severe' || what === 'feud') return FORFEIT[what];
        if (what === 'strikes' && this.strikes(nick) >= this.maxStrikes) return FORFEIT.strikes;
        return '';
    }

    /**
     * Has this person EARNED trust?
     *
     * Deliberately strict, and deliberately reliant on the account rather than
     * on time this process has been awake. Returns a reason when they have, so
     * the promotion can be explained rather than just happening.
     *
     * @param {string} nick
     * @param {{account:string, registeredAt:number}} who
     *   account: their services account, '' if not identified
     *   registeredAt: epoch ms the account was registered, 0 if unknown
     */
    earns(nick, who = {}) {
        // Unregistered means anybody can wear the name tomorrow. Trust attached
        // to a name nobody owns is trust handed to whoever takes it next, in a
        // room whose attackers do exactly that.
        if (!who.account) return '';
        if (!who.registeredAt) return '';
        const days = (Date.now() - who.registeredAt) / 86400000;
        if (days < this.minAccountDays) return '';
        if (this.messages(nick) < this.minMessages) return '';
        // Any offence at all this run disqualifies. Someone earning trust is
        // not somebody the filter has had to speak to today.
        if (this.strikes(nick) > 0) return '';
        return `${Math.floor(days)} days registered as ${who.account}, `
            + `${this.messages(nick)} messages here, no warnings`;
    }

    /** Forget somebody entirely — used when a moderator settles it by hand. */
    clear(nick) {
        const k = this.key(nick);
        this.said.delete(k);
        this.offences.delete(k);
    }
}

module.exports = { Reputation, FORFEIT };
