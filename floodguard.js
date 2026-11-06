'use strict';
// What to do when the SERVER says we flooded it.
//
//   ← Dracula has left (RecvQ exceeded)
//   → Dracula has joined
//   ← Dracula has left (RecvQ exceeded)
//
// RecvQ is the server's buffer of what we have already SENT, so that line means
// the bot outran the ircd. The pacer exists to make that rare; this file exists
// for the rest of it. Three things matter once it has happened, and none of them
// is "reconnect quickly":
//
//   1. Recognise the complaint. A kill for flooding arrives as an ERROR line
//      whose text is the only place the reason appears.
//   2. Slow down for a while. Rejoining at the same pace arrives at the same
//      server that just objected, which is how a one-off becomes a crash loop.
//   3. Back off harder the more often it happens. The cost of being offline for
//      a minute is one quiet minute; the cost of a flood loop is the account.
//
// Pure functions, no sockets and no timers, so the arithmetic is testable
// without pretending to be an ircd.
const FLOOD_WORDS = /(recvq|sendq|excess\s*flood|flooding|too\s*fast|throttl|rate\s*limit)/i;

// Somebody typing the word "flooding" in the room is not the server complaining,
// and confusing the two would slow the bot down because a person used a word.
// Server lines are bare (ERROR, PING) or prefixed with a source and a command a
// user cannot send (numerics, a server NOTICE); a PRIVMSG or NOTICE from a
// nick!user@host is conversation.
const USER_LINE = /^:\S+!\S+ (?:PRIVMSG|NOTICE)\b/i;

/** Is this server line a complaint about how much we sent? */
function isFloodComplaint(line) {
    const s = String(line || '');
    if (USER_LINE.test(s)) return false;
    return FLOOD_WORDS.test(s);
}

/**
 * How long to wait before reconnecting, given how many times we have been
 * killed for flooding. 5s, 10, 20, ... capped at ten minutes.
 *
 * The first wait is short because one kill is usually a burst that is already
 * over; the cap is what stops a persistent loop from hammering the network.
 */
function reconnectDelayMs(complaints, base = 5000, cap = 10 * 60 * 1000) {
    const n = Math.max(0, Math.min(8, Math.floor(Number(complaints) || 0)));
    return Math.min(cap, base * Math.pow(2, Math.max(0, n - 1)));
}

/**
 * Token-refill interval while the bot is on notice. One complaint doubles it,
 * two triples it, and it stops growing at 4x — a bot that takes four seconds to
 * say one line is still a bot that answers, and being silent is its own outage.
 */
function refillMultiplier(complaints) {
    const n = Math.max(0, Math.min(3, Math.floor(Number(complaints) || 0)));
    return 1 + n;
}

/** How long the slowed pace lasts. Long enough to outlive a burst, short enough to forgive. */
function penaltyMs(complaints) {
    const n = Math.max(0, Math.min(4, Math.floor(Number(complaints) || 0)));
    return Math.min(60 * 60 * 1000, 15 * 60 * 1000 * Math.max(1, n));
}

module.exports = { isFloodComplaint, reconnectDelayMs, refillMultiplier, penaltyMs, FLOOD_WORDS };
