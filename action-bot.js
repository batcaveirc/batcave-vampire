const net = require('net');
const tls = require('tls');
const { FindIt } = require('./findit');
const { Fun } = require('./fun');
const { Recruiter } = require('./recruit');
const { parseOrder } = require('./orders');

// --- Configuration (all from env / GitHub Secrets) ---
const list = (s) => (s || '').split(',').map((x) => x.toLowerCase().trim()).filter(Boolean);
const onOff = (s) => /^(1|true|yes|on)$/i.test(s || '');
const channels = (process.env.IRC_CHANNEL || '#batcave').split(',').map((s) => s.trim()).filter(Boolean);

// TLS matters here: without it the NickServ password is sent in cleartext over
// the wire. IRC_TLS was previously accepted in config but never honoured.
const useTls = onOff(process.env.IRC_TLS);

const config = {
    host: process.env.IRC_SERVER || 'irc.hybridirc.com',
    port: parseInt(process.env.IRC_PORT || (useTls ? '6697' : '6667'), 10),
    tls: useTls,
    nick: process.env.IRC_NICK || 'Dracula',
    realname: process.env.IRC_REALNAME || 'Older than the room, and in no hurry',
    password: process.env.NICKSERV_PASS || '',
    nsAccount: process.env.NICKSERV_ACCOUNT || '',
    channels,
    owners: list(process.env.OWNERS),
    admins: list(process.env.ADMINS),
    groqKey: process.env.GROQ_API_KEY || '',
    // Free Groq tiers rate-limit fast; a second key keeps moderation alive.
    groqKey2: process.env.GROQ_API_KEY_2 || process.env.GROQ_API_KEY1 || '',
    // llama-3.1-8b-instant was decommissioned 2026-08-16. Models get retired,
    // so keep a fallback: a dead model would otherwise silently disable all AI
    // moderation with nothing in the channel to show for it.
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    groqModelFallback: process.env.GROQ_MODEL_FALLBACK || 'openai/gpt-oss-20b',
    linkFilter: onOff(process.env.LINK_FILTER),
    warnLimit: parseInt(process.env.WARN_LIMIT || '3', 10),            // whitelisted
    warnLimitRegistered: parseInt(process.env.WARN_LIMIT_REGISTERED || '1', 10),
    kickUnregistered: onOff(process.env.KICK_UNREGISTERED || 'on'),   // no warnings
    autoVoice: onOff(process.env.AUTO_VOICE || 'on'),
};

// Default moderation vocab (EN + Hinglish). Extend at runtime with !!badword, or
// via the BADWORDS / SEVERE_WORDS secrets. Severe words are kept OUT of the repo
// on purpose — add slurs there via the SEVERE_WORDS secret.
const DEFAULT_BADWORDS = ['fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt',
    'slut', 'whore', 'retard', 'stupid', 'idiot', 'moron', 'dumbass', 'loser', 'scum',
    'pussy',
    // Hinglish. The first pass only had a handful and real abuse walked straight
    // through it — "randi", "chut", "bhanchod" and friends were all missed live.
    'kutta', 'kutte', 'kutti', 'chutiya', 'chutiye', 'chutia', 'madarchod', 'madarchod',
    'bhenchod', 'bhanchod', 'behenchod', 'bhosdi', 'bhosdike', 'bhosadike',
    'randi', 'raand', 'rand', 'chut', 'chudai', 'chod', 'chodu', 'lund', 'gaand',
    'gandu', 'harami', 'kamina', 'kamine', 'kaminey', 'kaminon',
    'suwar', 'suar', 'jhaat', 'tatti', 'lodu', 'bsdk', 'bhadwa', 'bhadve',
    // truncations people actually type
    'fuc', 'fuk', 'fck', 'phuck', 'azz', 'btch'];
const badwords = new Set([...DEFAULT_BADWORDS, ...list(process.env.BADWORDS)]);
const severeWords = new Set(list(process.env.SEVERE_WORDS));
const whitelist = new Set(list(process.env.WHITELIST));

// IRC channel names are case-insensitive: the server may echo "#BatCave" while
// the secret says "#batcave". Comparing them with === / includes() silently
// drops every message in the room, which looks exactly like the bot "hanging".
const chanKey = (c) => (c || '').toLowerCase();
const channelSet = new Set(config.channels.map(chanKey));
const isOurChannel = (c) => channelSet.has(chanKey(c)) || game.isGameChannel(c);

// --- State (in-memory; resets each restart — fine for an ephemeral host) ---
let socket = null;
let currentNick = config.nick;
let connecting = false;
let reconnectAttempts = 0;
// Did we ever complete registration on ANY connection this process? Used to
// tell "the network refused this address" apart from "the link dropped".
let everRegistered = false;
let preRegFailures = 0;
let hasJoined = false;
let ready = false;                 // replay guard: ignore backlog on (re)join
let sentientMode = onOff(process.env.SENTIENT_ON || 'on');
const seenUsers = {};
const warns = new Map();           // nick(lower) -> strike count
const floodLog = new Map();        // nick(lower) -> [timestamps]
const repeatLog = new Map();       // nick(lower) -> { text, count }
const hostOf = new Map();          // nick(lower) -> user@host (for real bans)
const ignored = new Set();         // nick(lower) -> bot ignores them entirely
const opped = new Set();           // channel(lower) we currently hold +o in
const joinLog = new Map();         // channel(lower) -> [join timestamps] (raid detect)
const lockedByRaid = new Set();    // channels auto-locked, so we can auto-unlock
const members = new Map();         // channel(lower) -> Set(nick) for !!mass
const accountOf = new Map();       // nick(lower) -> NickServ account ('' = unregistered)
const prefixOf = new Map();        // "chan|nick" (lower) -> "@" / "+" / "" etc.
const nickVerdict = new Map();     // nick(lower) -> true/false (AI screened, cached)
const nickOffences = new Map();    // nick(lower) -> times removed for the nick itself
let aiCalls = [];                  // recent Groq call timestamps (rate limit)
let reconnectTimer = null;
let lastRx = Date.now();           // last byte received — drives the health check
let pingProbeSent = false;
const connectTime = Date.now();

// Hosts protected from being kicked by other moderators, independent of nick
// (e.g. *!*@ku0.6ol.235.110.IP). The WHITELIST is protected automatically.
const protectMasks = new Set(list(process.env.PROTECT_MASKS));
// Trust that follows the HOST, not the nick. A regular who arrives as "libu"
// one day and "flood" the next needs one entry, not one per nick — and a nick
// list can never keep up with someone who changes theirs.
const trustedMasks = new Set(list(process.env.TRUSTED_MASKS));
const rescueLog = new Map();       // nick(lower) -> [timestamps of rescues]
let massPending = null;            // a bulk kick/ban awaiting confirmation
const recentlyActioned = new Map(); // nick(lower) -> ts of last kick/ban

// Persistent auto-ban masks, enforced on every join (glob, e.g. *!*@1.2.3.*).
const autobanMasks = new Set(list(process.env.AUTOBAN_MASKS));
// Strict mode: kick joiners whose NICK itself contains filtered words.
let strictNicks = onOff(process.env.STRICT_NICKS || 'on');
const channelRules = process.env.CHANNEL_RULES || '';
// How long a trusted regular is muted instead of kicked.
const quietMinutes = parseInt(process.env.QUIET_MINUTES || '5', 10);
// How long a devoice lasts before the floor is handed back.
const devoiceMinutes = parseInt(process.env.DEVOICE_MINUTES || '2', 10);
// Rooms running +m, where voice is the right to speak. Everyone who walks in
// is given it; losing it is the first rung of the ladder.
const moderatedRooms = new Set(
    (process.env.MODERATED_ROOMS || '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean));
// Voice anyone identified to services, not just a hand-kept nick list.
const voiceRegistered = onOff(process.env.AUTO_VOICE_REGISTERED || 'on');
// Channel history: InspIRCd's chanhistory mode, +H <lines>:<duration>.
const historySpec = process.env.CHANNEL_HISTORY_SPEC || '50:3d';
let historyReport = null;      // set while awaiting the server's verdict

// Raid protection: N joins inside the window trips a temporary invite-lock.
const raidJoins = parseInt(process.env.RAID_JOINS || '7', 10);
const raidWindowMs = parseInt(process.env.RAID_WINDOW_SEC || '10', 10) * 1000;
const raidLockSec = parseInt(process.env.RAID_LOCK_SEC || '60', 10);
let raidGuard = onOff(process.env.RAID_GUARD || 'on');

// The game. `bot` is the small surface findit.js needs.
const bot = { send, say, notice, get nick() { return currentNick; } };
const game = new FindIt(bot);
const fun = new Fun(bot, (c) => game.isGameChannel(c));
const recruiter = new Recruiter(bot, {
    membersOf: (c) => [...(members.get(chanKey(c)) || [])],
    prefixOf: (c, n) => prefixIn(c, n),
    get homeChannel() { return config.channels[0]; },
});
fun.enabled = onOff(process.env.FUN_ON || 'on');
// Master moderation switch, independent of the game.
let modEnabled = onOff(process.env.MOD_ENABLED || 'on');
// No auto-moderation inside a running game: nobody should be kicked mid-round
// for a word, and a compartment filling up is not a raid.
function moderationOff(chan) { return !modEnabled || game.isGameChannel(chan); }

// --- Helpers ---
function log(type, msg) { console.log(`[${type}] ${msg}`); }
// Outbound pacing. A game start sends a dozen role notices, three dozen task
// lines and a pile of invites at once; InspIRCd drops a client that floods.
// Token bucket: a small burst is fine, sustained traffic is spread out.
const outQueue = [];
let tokens = 10;
setInterval(() => {
    if (tokens < 10) tokens += 1;
    while (outQueue.length && tokens > 0) {
        tokens -= 1;
        const line = outQueue.shift();
        if (socket && socket.writable) socket.write(line + '\r\n');
    }
}, 200);

function send(data) {
    if (!socket || !socket.writable) return;
    // Protocol keepalives must never sit in a queue.
    if (/^(PONG|PING|QUIT)/.test(data)) { socket.write(data + '\r\n'); return; }
    if (tokens > 0 && !outQueue.length) { tokens -= 1; socket.write(data + '\r\n'); return; }
    if (outQueue.length < 400) outQueue.push(data);
}
// IRC drops anything past ~512 bytes for the whole line, so a long answer is
// silently truncated mid-word — which is how !!help lost its last third. Split
// on word boundaries instead, with room for the ":nick!user@host PRIVMSG #chan :"
// the server prepends.
function chunk(msg, size = 380) {
    const out = [];
    let line = '';
    for (const word of String(msg).split(' ')) {
        if (line && (line + ' ' + word).length > size) { out.push(line); line = word; }
        else line = line ? line + ' ' + word : word;
    }
    if (line) out.push(line);
    return out.length ? out : [''];
}
function say(chan, msg) { chunk(msg).forEach((c) => send(`PRIVMSG ${chan} :${c}`)); }
function notice(nick, msg) { chunk(msg).forEach((c) => send(`NOTICE ${nick} :${c}`)); }
// Store an absolute timestamp and render it as "12m ago". A clock reading is
// useless here: the runner is UTC and every user is in a different zone.
function ago(ts) {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ago`;
    return `${Math.floor(sec / 86400)}d ago`;
}

function isOwner(nick) { return config.owners.includes(nick.toLowerCase()); }
function isAdmin(nick) { const n = nick.toLowerCase(); return config.owners.includes(n) || config.admins.includes(n); }
function isExempt(nick, chan) {
    const n = nick.toLowerCase();
    if (n === config.nick.toLowerCase() || isAdmin(nick)) return true;
    // Channel operators are the moderators — never police them.
    if (chan && isChannelMod(chan, nick)) return true;
    // Whitelisted users are NOT exempt any more: they get a warning quota
    // instead, so genuine abuse from a trusted account is still caught.
    return false;
}

// Normalize leet/obfuscation so "st00pid" and "f-u-c-k" still match a whole word.
function normalize(t) {
    return (t || '').toLowerCase()
        // '@' stands in for 'a' (k@mine -> kamine), NOT 'o'. Getting this wrong
        // let "k@mine ho" and "h@rami ho" walk straight through the filter.
        .replace(/@/g, 'a').replace(/0/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e')
        .replace(/4/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't')
        .replace(/[^a-zऀ-ॿ ]/g, ' ')     // keep latin + devanagari
        .replace(/(.)\1{2,}/g, '$1$1');
}
/** Every distinct filtered word in a message, for judging severity by volume. */
function distinctHits(wordSet, msg) {
    if (!wordSet.size) return [];
    const norm = normalize(msg);
    const words = new Set((' ' + norm + ' ').split(/\s+/));
    const joined = norm.replace(/\s+/g, '');
    const found = new Set();
    for (const w of wordSet) {
        if (!w) continue;
        if (words.has(w) || (w.length >= 6 && joined.includes(w))) found.add(w);
    }
    return [...found];
}

function wordHit(wordSet, msg) {
    if (!wordSet.size) return null;
    const norm = normalize(msg);
    const words = new Set((' ' + norm + ' ').split(/\s+/));
    for (const w of wordSet) if (w && words.has(w)) return w;

    // Second pass for evasion by spacing/punctuation ("k a m i n e", "ch.utiya").
    // Only words of 6+ characters, because short ones hide inside innocent words
    // (e.g. "randi" inside the name "Brandi") and a false kick is worse than a
    // missed one.
    const joined = norm.replace(/\s+/g, '');
    for (const w of wordSet) if (w && w.length >= 6 && joined.includes(w)) return w;
    return null;
}

// Glob ("*!*@1.2.3.*") -> RegExp, for auto-ban masks.
function globToRe(glob) {
    return new RegExp('^' + glob.split('*').map((x) =>
        x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}
// "lucifer" -> "*!*@their.host" if known, else "lucifer!*@*". Anything that
// already looks like a mask is left alone.
function toMask(input) {
    if (/[!@*]/.test(input)) return input;
    const host = hostOf.get(input.toLowerCase());
    return host ? `*!*@${host.split('@')[1]}` : `${input}!*@*`;
}
function matchesAnyMask(nick, userHost) {
    const full = `${nick}!${userHost}`;
    for (const m of autobanMasks) { if (globToRe(m).test(full)) return m; }
    return null;
}

// ── Hierarchy ────────────────────────────────────────────────────────────
// Trust ladder, most trusted first:
//   1. owners/admins            — never moderated
//   2. channel operators (@ ~ & %) — they ARE the mods; never moderated
//   3. whitelisted              — full warn quota
//   4. registered (NickServ)    — short quota, they have an identity at stake
//   5. unregistered strangers   — removed on first offence
function prefixIn(chan, nick) { return prefixOf.get(`${chanKey(chan)}|${nick.toLowerCase()}`) || ''; }
function isChannelMod(chan, nick) { return /[~&@%]/.test(prefixIn(chan, nick)); }
function isRegistered(nick) { return !!accountOf.get(nick.toLowerCase()); }

/** True if this nick's host matches a TRUSTED_MASKS entry. */
function hostIsTrusted(nick) {
    if (!trustedMasks.size) return false;
    const uh = hostOf.get(nick.toLowerCase());
    if (!uh) return false;
    for (const m of trustedMasks) if (globToRe(m).test(`${nick}!${uh}`)) return true;
    return false;
}
/** Whitelisted by nick, or by host mask. */
function isTrusted(nick) {
    return whitelist.has(nick.toLowerCase()) || hostIsTrusted(nick);
}

/**
 * Who gets auto-voice.
 *
 * Host masks are the wrong identity for this network: a webchat user's cloak
 * changes between sessions, so the same person was "*!*@4sg.2ls.31.47.IP" one
 * day and "*!webchat@c1p.6ol.235.110.IP" the next. A mask list decays quietly
 * and the regulars it was meant to cover stop being recognised.
 *
 * A services ACCOUNT does not change. Voicing registered users covers every
 * regular without a list to maintain, which is why AUTO_VOICE_REGISTERED is on
 * by default.
 */
function deservesVoice(nick, chan) {
    // Where the room is +m, voice IS the right to speak, so everybody arriving
    // gets it — otherwise a newcomer joins into silence and never finds out
    // why. Elsewhere it stays a mark of standing.
    if (chan && moderatedRooms.has(chanKey(chan))) return true;
    return isTrusted(nick) || (voiceRegistered && isRegistered(nick));
}

function tierOf(chan, nick) {
    if (isAdmin(nick) || nick.toLowerCase() === config.nick.toLowerCase()) return 'staff';
    if (isChannelMod(chan, nick)) return 'mod';
    if (isTrusted(nick)) return 'trusted';
    // A services-granted voice IS the trust signal, once VOP holds the list.
    // Voice used to be only an OUTPUT of this function — the bot voiced people
    // it already trusted — which meant moving the roster into ChanServ VOP
    // changed nothing: the bot kept judging by its own stale nick list. Reading
    // +v back as an INPUT is what makes that migration take effect, and it
    // covers a human operator voicing someone by hand too.
    if (/\+/.test(prefixIn(chan, nick))) return 'trusted';
    if (isRegistered(nick)) return 'registered';
    // Without services nobody reads as registered, so the whole room drops to
    // the tier that gets removed on sight. "registered" is not gentle enough
    // either — its quota is one, which still means a kick on first offence.
    // If we genuinely cannot tell who someone is, assume the best: warn them
    // like a regular and let a human decide.
    if (servicesDown) return 'trusted';
    return 'stranger';
}
function warnQuotaFor(tier) {
    if (tier === 'trusted') return config.warnLimit;
    if (tier === 'registered') return config.warnLimitRegistered;
    return 0;                       // strangers get none
}

// The same ladder, in a moderated room, where the first rungs cost a person
// their voice rather than their seat. Nobody drops to zero here: taking the
// floor is cheap and reversible, so even a stranger is quieted once before
// anyone reaches for a kick — that is the whole point of moderating the room.
// Above that floor the hierarchy is the open-room one, so who you are still
// decides how much runway you get, not merely what happens when it runs out.
function moderatedQuotaFor(tier) {
    if (tier === 'trusted' || tier === 'mod' || tier === 'staff') return config.warnLimit;
    if (tier === 'registered') return Math.max(2, config.warnLimitRegistered);
    return 1;                       // strangers: one devoice, then out
}

// Nick screening is different from message screening: wordHit() matches whole
// words so ordinary chat isn't over-flagged, but a nick is a single token —
// "stupidbot" would never match "stupid". Use substring matching here, with a
// minimum length so short words can't cause false hits.
function badNick(nick) {
    const n = normalize(nick).replace(/\s+/g, '');
    for (const w of severeWords) if (w && w.length >= 3 && n.includes(w)) return w;
    for (const w of badwords) if (w && w.length >= 4 && n.includes(w)) return w;
    return null;
}

/**
 * Carry out a spoken moderation order from someone entitled to give one.
 * Returns true if the message was an order (handled or refused), so the
 * caller stops treating it as ordinary chat.
 *
 * The parser in orders.js decides what was MEANT. Everything here decides
 * whether it is ALLOWED — kept apart deliberately, because understanding a
 * sentence and being permitted to act on it are different questions and it
 * would be easy to let a confident parse imply authority.
 */
function handleOrder(chan, nick, msg) {
    const here = members.get(chanKey(chan)) || new Set();
    const order = parseOrder(msg, currentNick, (n) => [...here].some((m) => m.toLowerCase() === n.toLowerCase()));
    if (!order) return false;

    const tier = tierOf(chan, nick);
    if (tier !== 'trusted' && tier !== 'mod' && tier !== 'staff') {
        // Say nothing. Announcing "you may not do that" teaches the room the
        // exact phrasing that works and invites people to go looking for a gap.
        return false;
    }

    const { action, target, reason } = order;
    const why = reason ? `${reason} (by ${nick})` : `asked by ${nick}`;

    // Never against another bot, services, or me.
    const t = target.toLowerCase();
    if (t === currentNick.toLowerCase() || /^(chanserv|nickserv|operserv|hostserv|memoserv|botserv|luna1)$/.test(t)) {
        say(chan, `${nick}: not that one. 🦇`);
        return true;
    }
    // Never against someone the hierarchy protects. This is the guard that
    // stops the feature being turned around and used on the regulars.
    const targetTier = tierOf(chan, target);
    if (targetTier === 'trusted' || targetTier === 'mod' || targetTier === 'staff') {
        say(chan, `${nick}: ${target} is one of ours — I won't. Do it yourself if you mean it.`);
        return true;
    }

    if (!opped.has(chanKey(chan))) {
        say(chan, `${nick}: I'd need ops for that.`);
        return true;
    }

    switch (action) {
        case 'kick':    kickUser(chan, target, why); break;
        case 'ban':     banUser(chan, target, why); break;
        case 'mute':    quietUser(chan, target, quietMinutes, why); break;
        case 'unmute':  send(`MODE ${chan} -q ${target}!*@*`);
                        say(chan, `\x0309[MOD]\x03 ${target} un-quieted — ${why}.`); break;
        case 'voice':   send(`MODE ${chan} +v ${target}`);
                        say(chan, `\x0309[MOD]\x03 ${target} voiced — ${why}.`); break;
        case 'devoice': send(`MODE ${chan} -v ${target}`);
                        say(chan, `\x0304[MOD]\x03 ${target} de-voiced — ${why}.`); break;
        case 'unban':   send(`MODE ${chan} -b ${target}!*@*`);
                        say(chan, `\x0309[MOD]\x03 ${target} un-banned — ${why}.`); break;
        case 'warn':    warnUser(chan, target, why); break;
        default:        return false;
    }
    log('OK', `Order from ${nick} (${tier}): ${action} ${target}`);
    return true;
}

// --- Punishment / escalation ---
function warnUser(chan, nick, reason) {
    const tier = tierOf(chan, nick);
    const k = nick.toLowerCase();

    // ── Moderated room: the voice ladder, and it applies to EVERYONE ───────
    // Including strangers. Outside a moderated room an unregistered guest is
    // removed on the first offence, because there is nothing else to take from
    // them. Here there is: the floor. Taking it costs them nothing but the
    // next two minutes and costs the room nothing at all, which makes it the
    // right first answer to somebody who was probably joking.
    if (moderatedRooms.has(chanKey(chan))) {
        // Whitelisted regulars are TOLD, never silenced and never removed.
        // They are the people the room is for; taking a regular's voice mid-joke
        // costs more than the joke did, and the owner would rather handle those
        // few by hand. A human moderator can still act — !!quiet, !!kick and a
        // spoken order all still work on anyone.
        if (tier === 'trusted' || tier === 'mod' || tier === 'staff') {
            const n = (warns.get(k) || 0) + 1;
            warns.set(k, n);
            say(chan, `\x0308[MOD]\x03 ${nick} — ${reason}. (warning ${n}, no action taken)`);
            return;
        }
        const quota = moderatedQuotaFor(tier);
        const n = (warns.get(k) || 0) + 1;
        warns.set(k, n);
        // `<=`, not `<`: the quota counts devoices, so a quota of one has to
        // yield one devoice. With `<` a stranger's first offence skipped
        // straight to a kick and the moderated room bought them nothing.
        if (n <= quota) {
            send(`MODE ${chan} -v ${nick}`);
            say(chan, `\x0304[MOD]\x03 ${nick} — ${reason}. Voice back in ${devoiceMinutes}m. `
                + `(${n}/${quota})`);
            setTimeout(() => {
                const here = members.get(chanKey(chan));
                if (here && [...here].some((m) => m.toLowerCase() === k)) send(`MODE ${chan} +v ${nick}`);
            }, devoiceMinutes * 60000);
            return;
        }
        warns.set(k, 0);
        // Out of strikes. Trusted people are quieted rather than removed; the
        // rest leave, and can come straight back.
        if (tier === 'trusted' || tier === 'mod' || tier === 'staff') {
            quietUser(chan, nick, quietMinutes, `${quota} strikes — ${reason}`);
        } else {
            kickUser(chan, nick, `${quota} strikes — ${reason}`);
        }
        return;
    }

    // ── Open room: the original ladder ────────────────────────────────────
    const quota = warnQuotaFor(tier);

    // Strangers (no NickServ account, not whitelisted) don't get a runway.
    if (quota === 0) {
        if (config.kickUnregistered) {
            kickUser(chan, nick, `${reason} — unregistered guests get no warnings`);
        } else {
            say(chan, `\x0304[MOD]\x03 ${nick}: ${reason}. Register your nick to earn some leeway.`);
        }
        return;
    }

    const n = (warns.get(k) || 0) + 1;
    warns.set(k, n);
    if (n >= quota) {
        warns.set(k, 0);
        if (tier === 'trusted' || tier === 'mod' || tier === 'staff') {
            quietUser(chan, nick, quietMinutes, `${quota} strikes — ${reason}`);
        } else {
            kickUser(chan, nick, `${quota} strike${quota > 1 ? 's' : ''} — ${reason}`);
        }
    } else {
        say(chan, `\x0304[MOD]\x03 ${nick} warned (${n}/${quota}) — ${reason}.`);
    }
}
// A pasted wall of text arrives as several PRIVMSGs, and each one trips the
// filter independently — which is why one offender was kicked three times with
// three identical announcements. They are already gone after the first.
// Keyed by channel AND action on purpose: a kick in one room must not silence
// moderation in another, and a deliberate escalation (kick, then ban when they
// come back with the same nick) is a different action, not a duplicate.
function actionKey(chan, nick, action) { return `${chanKey(chan)}|${nick.toLowerCase()}|${action}`; }
function actedRecently(chan, nick, action) {
    return Date.now() - (recentlyActioned.get(actionKey(chan, nick, action)) || 0) < 10000;
}
function markActioned(chan, nick, action) {
    recentlyActioned.set(actionKey(chan, nick, action), Date.now());
}

// Muting one person needs +q, not +m. A moderated channel silences everyone
// who is not voiced — newcomers, anyone whose auto-voice has not landed yet —
// so it turns a targeted action into a room-wide one. +q takes away exactly
// one voice and leaves the room running. (findit.js reached the same
// conclusion independently.)
const quietUntil = new Map();      // "chan|nick" -> ts the -q is due
let quietSweep = false;            // true while asking for the +q list at startup
function quietUser(chan, nick, mins, reason) {
    if (!requireOps(chan, `quiet ${nick}`)) return;
    const uh = hostOf.get(nick.toLowerCase());
    const mask = uh ? `*!*@${uh.split('@')[1]}` : `${nick}!*@*`;
    send(`MODE ${chan} +q ${mask}`);
    say(chan, `\x0304[MOD]\x03 ${nick} muted ${mins}m — ${reason}. Still here, just quiet.`);
    quietUntil.set(`${chanKey(chan)}|${nick.toLowerCase()}`, Date.now() + mins * 60000);
    setTimeout(() => {
        send(`MODE ${chan} -q ${mask}`);
        quietUntil.delete(`${chanKey(chan)}|${nick.toLowerCase()}`);
        notice(nick, `You can speak in ${chan} again.`);
    }, mins * 60000);
}

function kickUser(chan, nick, reason) {
    if (actedRecently(chan, nick, 'kick')) return;
    markActioned(chan, nick, 'kick');
    if (!requireOps(chan, `kick ${nick}`)) return;
    send(`KICK ${chan} ${nick} :${reason}`);
    say(chan, `\x0304[MOD]\x03 ${nick} banished — ${reason}. 🦇`);
}

// A "nick!*@*" ban stops nobody — they rejoin under any other nick two seconds
// later. Ban the HOST when we know it (learned from their messages/joins) and
// fall back to the nick mask only when we don't.
/**
 * HybridIRC cloaks look like "59oca5.fqsv.s1ur.6ea0.2a02.IP". The LEADING groups
 * are randomised per session; the trailing two encode the network and stay put.
 * So a ban on the full cloak lasts exactly until the offender reconnects — two
 * observed nicks from one person differed in every leading group and matched on
 * "6ea0.2a02.IP".
 *
 * wide=false → this session only (safe, evadable)
 * wide=true  → "*!*@*.6ea0.2a02.IP", which follows them across reconnects but
 *              also covers everyone else on that network block.
 */
function banMask(nick, wide) {
    const uh = hostOf.get(nick.toLowerCase());
    if (!uh) return `${nick}!*@*`;
    const host = uh.split('@')[1] || '';
    if (!wide) return `*!*@${host}`;
    const parts = host.split('.');
    if (parts.length >= 3 && /^ip$/i.test(parts[parts.length - 1])) {
        return `*!*@*.${parts.slice(-3).join('.')}`;
    }
    return `*!*@${host}`;
}
function banUser(chan, nick, reason) {
    if (actedRecently(chan, nick, 'ban')) return;
    markActioned(chan, nick, 'ban');
    if (!requireOps(chan, `ban ${nick}`)) return;
    const mask = banMask(nick);
    send(`MODE ${chan} +b ${mask}`);
    send(`KICK ${chan} ${nick} :${reason}`);
    say(chan, `\x0304[MOD]\x03 ${nick} banned (${mask}) — ${reason}. 🦇`);
}

// Ops handling. We do NOT refuse an action just because our own bookkeeping
// says we lack ops — that state can be stale (ChanServ can op us at any time,
// and an op granted before we joined arrives only in the NAMES list). Refusing
// on stale state blocks a bot that is in fact opped. Instead: always attempt,
// and let the server's 482 reply report the failure honestly.
function requireOps(chan, what) {
    if (!opped.has(chanKey(chan))) {
        log('MOD', `No ops recorded for ${chan} — attempting "${what}" anyway; asking ChanServ.`);
        send(`PRIVMSG ChanServ :OP ${chan} ${currentNick}`);
    }
    return true;
}

// Protected from OTHER moderators' kicks: the whitelist, plus any host mask in
// PROTECT_MASKS (so protection survives a nick change).
function isProtectedFromKick(nick) {
    const n = nick.toLowerCase();
    if (isTrusted(nick) || isAdmin(nick)) return true;
    const uh = hostOf.get(n);
    if (uh) { for (const m of protectMasks) if (globToRe(m).test(`${nick}!${uh}`)) return true; }
    return false;
}

// A KICK cannot be blocked — it is instantaneous and server-side, and this
// network has no channel rank above @ that ChanServ could grant to make someone
// immune (PREFIX=(Yov)!@+). So the only real defence is to undo it quickly:
// invite them straight back and strip any ban the kick left behind.
// NOTE: INVITE only waives +i. It does NOT rejoin anyone — their client has to
// act on it, so the victim needs auto-join-on-invite for this to be seamless.
function rescueFromKick(chan, victim, kicker, reason) {
    const k = victim.toLowerCase();
    const now = Date.now();
    const hist = (rescueLog.get(k) || []).filter((t) => now - t < 60000);

    // Never get into an invite/kick loop with a determined human — that would
    // flood the channel and help nobody.
    if (hist.length >= 5) {
        if (hist.length === 5) {
            rescueLog.set(k, [...hist, now]);
            say(chan, `\x0304[MOD]\x03 ${victim} has been kicked ${hist.length}x — standing down to `
                + `avoid a loop. ${config.owners[0] || 'An owner'} should step in.`);
        }
        return;
    }
    hist.push(now); rescueLog.set(k, hist);

    const mask = banMask(victim);
    send(`INVITE ${victim} ${chan}`);
    send(`MODE ${chan} -b ${mask}`);                        // clear a direct ban
    send(`PRIVMSG ChanServ :UNBAN ${chan} ${mask}`);        // and any ChanServ one
    send(`PRIVMSG ChanServ :UNBAN ${chan} ${victim}`);
    say(chan, `\x0304[MOD]\x03 ${victim} is protected — kicked by ${kicker}`
        + `${reason ? ` (${reason})` : ''}. Invited back and bans cleared. 🦇`);
    log('MOD', `Rescued ${victim} after kick by ${kicker} in ${chan}`);
}

// --- Scripted moderation (ALWAYS on): severe, badwords, links, caps, flood, repeat ---
function scriptedModeration(chan, nick, message) {
    if (isExempt(nick, chan)) return false;

    // Severe language is always actioned — including inside a game. Switching
    // moderation off is about avoiding accidental kicks, not tolerating slurs.
    const severe = wordHit(severeWords, message);
    if (severe) { banUser(chan, nick, 'severe language'); return true; }

    if (moderationOff(chan)) return false;

    // Count DISTINCT filtered words. One swear is someone being rude; a message
    // carrying several is a tirade, and treating it as "watch your language"
    // under-reacts badly — that is what happened to a threat-laden wall of abuse
    // which earned a kick when it warranted a ban.
    const hits = distinctHits(badwords, message);
    if (hits.length >= 3) {
        banUser(chan, nick, `sustained abuse (${hits.length} slurs in one message)`);
        return true;
    }
    if (hits.length) { warnUser(chan, nick, 'watch your language'); return true; }

    if (config.linkFilter && /(https?:\/\/|www\.)\S+/i.test(message)) {
        warnUser(chan, nick, 'no links'); return true;
    }

    const letters = message.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 10 && message.replace(/[^A-Z]/g, '').length / letters.length > 0.75) {
        warnUser(chan, nick, 'stop shouting'); return true;
    }

    const k = nick.toLowerCase(), now = Date.now();

    const hist = (floodLog.get(k) || []).filter((t) => now - t < 5000);
    hist.push(now); floodLog.set(k, hist);
    if (hist.length > 5) { warnUser(chan, nick, 'flooding'); return true; }

    const rep = repeatLog.get(k);
    if (rep && rep.text === message) {
        rep.count += 1;
        if (rep.count >= 3) { repeatLog.set(k, { text: message, count: 0 }); warnUser(chan, nick, 'stop repeating'); return true; }
    } else {
        repeatLog.set(k, { text: message, count: 1 });
    }
    return false;
}

// --- Sentient (AI) moderation via Groq — only when !!sentient is ON ---
function aiRateOk() {
    const now = Date.now();
    aiCalls = aiCalls.filter((t) => now - t < 60000);
    if (aiCalls.length >= 20) return false;        // stay under Groq's rate limit
    aiCalls.push(now);
    return true;
}
// One place that talks to Groq, so both callers get key failover for free.
// gpt-oss and qwen3 are REASONING models: they spend tokens on an internal
// "reasoning" field first and leave `content` empty until that finishes. With a
// small max_tokens they hit the cap mid-thought and return "" — which would have
// made the fallback model silently produce nothing. max_tokens is a ceiling, not
// a spend, so raising it costs the non-reasoning primary nothing.
const REASONING_MIN_TOKENS = 320;
function needsRoomToThink(model) { return /gpt-oss|qwen3|reason/i.test(model || ''); }

async function groqChat(body) {
    const keys = [config.groqKey, config.groqKey2].filter(Boolean);
    const models = [...new Set([body.model || config.groqModel, config.groqModelFallback])];
    let lastErr = null;
    for (const model of models) {
        for (const key of keys) {
            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...body,
                        model,
                        max_tokens: needsRoomToThink(model)
                            ? Math.max(body.max_tokens || 0, REASONING_MIN_TOKENS)
                            : body.max_tokens,
                    }),
                });
                // 401 bad key / 429 rate-limited → try the other key
                if ((res.status === 401 || res.status === 429) && keys.length > 1) {
                    lastErr = new Error(`key rejected (${res.status})`);
                    continue;
                }
                // 400/404 usually means the model is gone or renamed → next model
                if (res.status === 400 || res.status === 404) {
                    lastErr = new Error(`model "${model}" rejected (${res.status})`);
                    log('AI', `Model "${model}" refused (${res.status}) — trying the fallback.`);
                    break;
                }
                if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
                if (model !== models[0]) log('AI', `Serving from fallback model "${model}".`);
                return await res.json();
            } catch (e) { lastErr = e; }
        }
    }
    if (lastErr) throw lastErr;
    return null;
}

// Whitespace/punctuation-insensitive form, for checking the model quoted
// something that is genuinely in the message.
const flatten = (s) => normalize(s).replace(/\s+/g, ' ').trim();

// Words that NAME bigotry rather than express it. Someone expressing hate uses
// a slur or a target; someone objecting to it uses one of these.
const CALLOUT_WORDS = /^(racist|racism|sexist|sexism|homophobic|homophobia|transphobic|transphobia|bigot|bigotry|bigoted|casteist|casteism|misogynist|misogyny|xenophobic|xenophobia|antisemitic|islamophobic|prejudiced|discriminat\w*|offensive|abusive|hate|hateful|toxic|creepy|inappropriate)$/i;

/**
 * True when the model's own evidence is nothing but the name of the offence.
 *
 * A user replied "Racist" to somebody else's remark and was BANNED for hate
 * speech: the model quoted the word "Racist" and called that the abuse. But
 * naming a thing is not doing it, and punishing the person who objects
 * silences the wrong side of the room. If the quote contains no slur and
 * reduces to accusation vocabulary, there is no offence in it.
 */
function quoteNamesTheProblem(quote) {
    const words = flatten(quote).split(' ').filter(Boolean);
    if (!words.length) return false;
    if (words.some((w) => severeWords.has(w) || badwords.has(w))) return false;
    return words.every((w) => CALLOUT_WORDS.test(w)
        || ['that', 'is', 'was', 'so', 'very', 'you', 'are', 'being', 'this',
            'a', 'an', 'the', 'its', 'it', 'thats', 'stop', 'dont', 'not'].includes(w));
}

async function sentientModeration(chan, nick, message) {
    if (isExempt(nick, chan) || moderationOff(chan) || !config.groqKey || message.length < 4) return;
    if (!aiRateOk()) return;                        // busy → scripted filter still covers it
    try {
        const data = await groqChat(({
                model: config.groqModel, temperature: 0, max_tokens: 80,
                messages: [
                    { role: 'system', content:
                        'You moderate a friendly IRC room. A word filter already handles ordinary '
                        + 'profanity, so you exist ONLY to catch SERIOUS harm that a word list misses: '
                        + 'targeted harassment, threats of violence, sexual harassment, slurs and hate '
                        + 'toward a person or group, doxxing, and sustained demeaning abuse of someone.\n'
                        + 'Be permissive about everything else. Friends swearing, teasing, dark jokes, '
                        + 'crude banter, arguments, Hinglish slang and single rude words are NOT your '
                        + 'business — answer "none" for those.\n'
                        + 'Messages may be Hinglish/Hindi in Latin script; judge meaning, not spelling.\n'
                        + 'The first word is often the NICKNAME of the person being spoken to. A '
                        + 'nickname is never abuse, however rude it reads: "bully you are late" is '
                        + 'someone greeting a user called bully.\n'
                        + 'Hinglish teasing between friends is the ordinary register in this '
                        + 'room, not abuse. Words like "churail", "pagal", "kamina", "chudail", '
                        + '"nautanki", "gadha", "ullu" are what friends call each other here — '
                        + 'answer "none" unless the message is genuinely aimed at hurting '
                        + 'somebody, and remember you cannot hear tone.\n'
                        + 'CRITICAL: talking ABOUT bigotry is not bigotry. "Racist", "that is '
                        + 'racist", "stop being homophobic", reporting or objecting to abuse, and '
                        + 'discussing it are all "none" — the person naming the problem is not the '
                        + 'person causing it. Punishing them silences the wrong side of the room.\n'
                        + 'Teasing between friends is the normal register here, especially with ":D", '
                        + '":P" or "lol" — those mark a joke. Examples that are all "none": '
                        + '"bully you have the right to be desperate here :D", "tu pagal hai yaar", '
                        + '"shut up lol".\n'
                        + 'Reply with ONLY compact JSON: {"action":"none|warn|kick|ban",'
                        + '"confident":true|false,"quote":"the exact words from the message that are '
                        + 'abusive","reason":"few words"}. '
                        + '"ban" = slurs, hate or threats. "kick" = serious targeted harassment. '
                        + '"warn" = borderline but clearly demeaning. Everything else "none".\n'
                        + 'A wrong call throws a real person out of their community. If you have to '
                        + 'reason about whether it is abuse, it is not: answer "none".' },
                    { role: 'user', content: message },
                ],
        }));
        const txt = data?.choices?.[0]?.message?.content || '';
        const m = txt.match(/\{[\s\S]*\}/);
        if (!m) return;
        let verdict;
        try { verdict = JSON.parse(m[0]); } catch (e) { return; }   // fail-safe: never act on unparseable output
        const action = String(verdict.action || 'none').toLowerCase();
        if (!['warn', 'kick', 'ban'].includes(action)) return;

        // Gate 1 — the model must be sure. A hedged verdict is banter.
        if (verdict.confident !== true) {
            log('AI', `Flagged ${nick} (${action}) without confidence — leaving it.`);
            return;
        }
        // Gate 2 — it must point AT the abuse, and the quote must really be in
        // the message. A model that cannot quote what it is punishing is
        // inventing it: that is how a friendly ":D" was read as harassment and
        // a trusted regular got thrown out mid-joke.
        const quote = flatten(verdict.quote || '');
        if (!quote || !flatten(message).includes(quote)) {
            log('AI', `Flagged ${nick} (${action}) but quoted "${verdict.quote || ''}" `
                + `which is not in the message — ignoring.`);
            return;
        }

        const reason = `AI: ${String(verdict.reason || 'abuse').slice(0, 40)}`;
        const tier = tierOf(chan, nick);
        log('AI', `${nick} [${tier}] → ${action} (${reason}) quote="${verdict.quote}"`);

        // Gate 3 — the model's evidence must be more than the name of the
        // offence. This is the exact shape of the live false positive.
        if (quoteNamesTheProblem(verdict.quote || '')) {
            log('AI', `Ignoring ${action} on ${nick}: quoted "${verdict.quote}", which names abuse rather than being it.`);
            return;
        }

        // Gate 4 — a short message carries no act, only a topic. A user replying
        // "Racist" to someone else's remark was BANNED for hate speech: the
        // model matched the subject and missed that they were objecting to it.
        // Naming a thing is not doing it, and one or two words never carry
        // enough context to tell the difference.
        if (message.trim().split(/\s+/).length < 4) {
            log('AI', `Ignoring ${action} on a ${message.trim().split(/\s+/).length}-word message from ${nick}.`);
            return;
        }

        // Gate 5 — the AI may never ban. A ban is the one action the person
        // cannot undo by coming back, and it should rest on something
        // deterministic: the word list bans, the model at most removes. Same
        // rule already applied to nickname screening.
        if (action === 'ban') {
            log('MOD', `AI wanted to ban ${nick} — capped at a kick.`);
            if (tier === 'stranger') { kickUser(chan, nick, reason); return; }
            warnUser(chan, nick, reason);
            return;
        }

        // Gate 6 — an AI opinion never outranks the trust hierarchy. A word from
        // the filter is evidence; a model's reading of a remark is not, so for
        // anyone with standing the harshest it can be is a warning.
        if (tier !== 'stranger' && action !== 'warn') {
            log('MOD', `AI wanted to ${action} ${nick} (${tier}) — downgraded to a warning.`);
            warnUser(chan, nick, reason);
            return;
        }
        if (action === 'kick') kickUser(chan, nick, reason);
        else warnUser(chan, nick, reason);          // tier-aware
    } catch (e) {
        log('AI', 'moderation error: ' + e.message);
    }
}

// --- AI nickname screening ---------------------------------------------
// A word list only catches spellings someone already thought of. Nicknames are
// where people get creative: "BULL4UR_RAND", slurs in other languages, sexual
// phrases split by separators. Groq reads the nick as a phrase instead.
// Verdicts are cached per nick so a join flood costs one call each, and the
// cheap badNick() check runs first so obvious cases never reach the API.
async function aiNickIsOffensive(nick) {
    const k = nick.toLowerCase();
    if (nickVerdict.has(k)) return nickVerdict.get(k);
    if (!config.groqKey || !aiRateOk()) return null;      // unknown -> caller falls back
    try {
        const data = await groqChat({
            model: config.groqModel, temperature: 0, max_tokens: 40,
            messages: [
                { role: 'system', content:
                    'You screen IRC nicknames. Flag a nickname ONLY when it unmistakably '
                    + 'contains an explicit slur, explicit sexual/pornographic wording, hate '
                    + 'speech, or an insult aimed at a person. Read leetspeak and separators '
                    + 'phonetically ("BULL4UR_RAND" = "bull 4 ur rand"); Hinglish in Latin '
                    + 'script counts.\n\n'
                    + 'DO NOT flag, these are all fine:\n'
                    + '- abbreviations and consonant clusters: NgtCht, fwkkr, xyzzy, brb_afk\n'
                    + '- ordinary or foreign words even if suggestive: erotiqueF, Sensual, Amour\n'
                    + '- gamer tags, brands, random letters, names in any language\n'
                    + '- edgy or gothic themes: Lucifer, DeathKnight, Reaper\n\n'
                    + 'A wrong flag ejects a real person from their community, so the bar is '
                    + 'high: if you have to reason about it, or it only MIGHT be rude, it is '
                    + 'fine. Set confident=true only when the offensive reading is the obvious '
                    + 'one to any reader.\n'
                    + 'Reply with ONLY compact JSON: '
                    + '{"bad":true|false,"confident":true|false,"category":"slur|sexual|hate|insult|none","why":"few words"}.' },
                { role: 'user', content: `Nickname: ${nick}` },
            ],
        });
        const txt = data?.choices?.[0]?.message?.content || '';
        const m = txt.match(/\{[\s\S]*\}/);
        if (!m) return null;
        const v = JSON.parse(m[0]);
        // Two gates: the model must say bad AND say it is confident AND name a
        // real category. One loose "true" should not remove someone.
        const bad = v.bad === true && v.confident === true
            && ['slur', 'sexual', 'hate', 'insult'].includes(String(v.category || '').toLowerCase());
        nickVerdict.set(k, bad);
        if (v.bad === true && !bad) {
            log('MOD', `AI flagged "${nick}" but not confidently (${v.category || '?'}) — leaving it.`);
        } else if (bad) {
            log('MOD', `AI flagged nick "${nick}": ${v.category} — ${String(v.why || '').slice(0, 40)}`);
        }
        return bad;
    } catch (e) { return null; }
}

// Screen a joiner's nickname: cheap list check first, AI second. First offence
// is a kick (they can just change nick); returning with the same nick is a ban.
async function screenNick(chan, nick) {
    if (isExempt(nick, chan)) return;
    // isExempt() deliberately excludes whitelisted users (they get a warn quota
    // for what they SAY). But a trusted regular's NAME is settled — screening it
    // banned a user seconds after the owner whitelisted them.
    if (isTrusted(nick)) return;
    // A registered nick is an identity someone owns; leave those to a human.
    if (isRegistered(nick)) return;
    const listHit = badNick(nick);
    const fromList = !!listHit;
    let bad = listHit ? 'filtered word in nick' : null;
    if (!bad) {
        const verdict = await aiNickIsOffensive(nick);
        if (verdict === true) bad = 'offensive nickname';
    }
    if (!bad) return;

    const k = nick.toLowerCase();
    const n = (nickOffences.get(k) || 0) + 1;
    nickOffences.set(k, n);

    // Only the word list — which the owner controls — may escalate to a ban.
    // An AI judgement is an opinion, and a wrong ban on a regular costs far
    // more than asking someone twice to change their nick.
    if (fromList && n > 1) banUser(chan, nick, `${bad} (returned with it)`);
    else kickUser(chan, nick, `${bad} - please pick a different nick`);
}

// --- Witty AI reply (for mentions when sentient mode is off) ---
async function getAIResponse(prompt, who) {
    if (!config.groqKey) return null;
    try {
        const data = await groqChat({
            model: config.groqModel, temperature: 0.9, max_tokens: 120,
            messages: [
                { role: 'system', content: 'You are Dracula, a witty gothic vampire haunting an IRC channel. Never admit to being a bot. Keep replies to 1-2 sharp sentences.' },
                { role: 'user', content: `${who} says: ${prompt}` },
            ],
        });
        return (data?.choices?.[0]?.message?.content || '').replace(/\s+/g, ' ').trim().slice(0, 380) || null;
    } catch (e) { return null; }
}

/** One real AI call at startup. Silence from this layer is indistinguishable
 *  from an absence of abuse, so its health has to be asserted, not assumed. */
async function selfCheckAI() {
    if (!config.groqKey) { log('WARN', 'No Groq key — AI moderation is OFF.'); return; }
    try {
        const data = await groqChat({
            model: config.groqModel, temperature: 0, max_tokens: 8,
            messages: [{ role: 'user', content: 'reply with the single word: ok' }],
        });
        const txt = (data?.choices?.[0]?.message?.content || '').trim();
        if (txt) { log('OK', `AI layer healthy (${config.groqModel}).`); return; }
        throw new Error('empty response');
    } catch (e) {
        log('ERR', `AI layer FAILED at startup: ${e.message}`);
        // Tell the people who can do something about it, without alarming the room.
        for (const n of channelMods()) {
            notice(n, `\x0304[ALERT]\x03 AI moderation is offline (${e.message.slice(0, 60)}). `
                + 'The word filter still stands. Check the Groq key.');
        }
    }
}

// ── Services health, and what to do without them ────────────────────────────
//
// Almost every trust decision here is really a services decision: who is
// registered, who ChanServ voices, who holds ops. If Atheme splits or a channel
// is dropped, none of that is knowable — and the dangerous part is that it does
// not look like a failure. Everyone simply appears to be an unregistered
// stranger.
//
// That inverts the usual instinct about degraded mode. The trust ladder's
// harshest rule — remove a stranger on first offence — is the one that MUST be
// suspended, because without services every regular in the room matches it.
// Losing services should make the bot gentler, not stricter.
let servicesDown = false;
let servicesReport = null;      // set while awaiting ChanServ's INFO reply

/** Every operator across our channels, each listed once. */
function channelMods() {
    const seen = new Map();
    for (const c of config.channels) {
        for (const n of members.get(chanKey(c)) || []) {
            if (isChannelMod(c, n) && n.toLowerCase() !== config.nick.toLowerCase()) {
                seen.set(n.toLowerCase(), n);
            }
        }
    }
    return [...seen.values()];
}

function enterDegradedMode(why) {
    if (servicesDown) return;
    servicesDown = true;
    log('ERR', `DEGRADED: ${why}. Stranger-removal suspended; word filter still active.`);
    // One alert per person. An operator in both rooms was being told twice.
    for (const n of channelMods()) {
        notice(n, `\x0304[ALERT]\x03 ${why}. I cannot tell who is registered, so I have `
            + 'stopped removing strangers — everyone looks like one right now. '
            + 'Word filter, flood and raid guard are unaffected.');
    }
    setTimeout(() => verifyServices(1), 300000);   // look again in five minutes
}

function leaveDegradedMode() {
    if (!servicesDown) return;
    servicesDown = false;
    log('OK', 'Services are back — full trust ladder restored.');
    for (const n of channelMods()) notice(n, '\x0303[OK]\x03 Services are back. Normal moderation resumed.');
}

/**
 * Ask ChanServ about each channel and judge from the answer.
 *
 * Three outcomes worth distinguishing, because they need different responses:
 *   registered + we are opped -> normal
 *   registered + no ops       -> ask for ops, keep moderating what we can
 *   no reply at all           -> services are gone; degrade
 *   "not registered"          -> the channel was dropped; tell the owners,
 *                                because no AKICK, VOP or auto-op exists now
 */
let servicesProbes = 0;
/**
 * Voice everyone present who deserves it.
 *
 * Auto-voice originally fired only on JOIN, so anyone already sitting in the
 * channel when we connect was skipped — and we reconnect every few hours.
 *
 * It must run after BOTH lists arrive. WHO and NAMES are sent back to back and
 * answer independently: NAMES brings membership, WHO brings accounts. Sweeping
 * on end-of-NAMES alone meant that whenever WHO had not finished, no one looked
 * registered and nobody was voiced — which is exactly why the two rooms
 * disagreed about the same people. Called from both endings; the prefix check
 * makes it idempotent.
 */
const enforcedModeration = new Set();

function voiceSweep(ch) {
    // Deliberately NOT setting +m here any more.
    //
    // It used to, from config, and that silenced every unregistered newcomer
    // in both rooms: +m went on, the on-join voice did not follow, and people
    // arrived unable to speak or even ask why. A moderated room only works if
    // voicing is completely reliable, and a bot that restarts every six hours
    // and lands on blocked addresses is not that.
    //
    // So moderation is now only ever a human decision — !!moderate on — made
    // by someone who is present to see whether arrivals can talk. Config may
    // describe how the LADDER behaves; it may not take away the room's voice
    // on its own.
    if (moderatedRooms.has(ch) && opped.has(ch) && !enforcedModeration.has(ch)) {
        enforcedModeration.add(ch);
        log('MOD', `${ch} is configured for the voice ladder. Not setting +m by myself — `
            + 'use !!moderate on when someone is watching.');
    }
    // NOT gated on `ready`. That flag is a replay guard for user MESSAGES,
    // and we join on identify — about a second and a half before it is set —
    // so NAMES and WHO always answered while it was still false and the sweep
    // returned immediately. It had never once run at startup, which is the
    // whole moment it exists for.
    if (!ch || !config.autoVoice || game.isGameChannel(ch) || !opped.has(ch)) return;
    for (const n of members.get(ch) || []) {
        if (deservesVoice(n, ch) && !/[~&@%+]/.test(prefixIn(ch, n))) send(`MODE ${ch} +v ${n}`);
    }
}

function verifyServices(attempt = 1) {
    const seen = new Set();
    let anyReply = false;
    servicesReport = (text) => {
        anyReply = true;
        const m = text.match(/(#\S+)/);
        const chan = m ? m[1] : '';
        if (/is not registered|isn.t registered|no such channel/i.test(text)) {
            seen.add(`unregistered:${chan}`);
        }
    };
    for (const c of config.channels) send(`PRIVMSG ChanServ :INFO ${c}`);
    setTimeout(() => {
        servicesReport = null;
        if (!anyReply) {
            // One slow or dropped reply must not weaken moderation. Degrading
            // suspends stranger-removal, so it needs more evidence than a
            // single missed answer — ask again before concluding anything.
            if (attempt < 3) { log('WARN', `ChanServ silent (probe ${attempt}/3) — retrying.`); verifyServices(attempt + 1); return; }
            enterDegradedMode('ChanServ is not answering');
            return;
        }
        leaveDegradedMode();
        for (const key of seen) {
            const chan = key.split(':')[1];
            log('ERR', `${chan} is NOT registered with ChanServ.`);
            for (const n of members.get(chanKey(chan)) || []) {
                if (isChannelMod(chan, n)) {
                    notice(n, `\x0304[ALERT]\x03 ${chan} is not registered with ChanServ. `
                        + 'There is no AKICK list, no auto-voice and no auto-op behind me — '
                        + 'if I drop, the room has nothing.');
                }
            }
        }
    }, 15000);
}

// --- Command handler (!! prefix) ---
function handleCommand(chan, nick, message) {
    const args = message.slice(2).trim().split(/\s+/);
    const cmd = (args.shift() || '').toLowerCase();
    const target = args[0];
    const owner = isOwner(nick);
    // Channel operators run the room, so they run the bot. Relying on a secret
    // list meant authority lived somewhere nobody could see or change from the
    // channel, and it silently denied people who plainly are in charge.
    // Owner-set: every operator gets every command. The confirm step on !!mass
    // is what stops a slip becoming thirty removals, not the permission check.
    const admin = isAdmin(nick) || isChannelMod(chan, nick);
    log('CMD', `${nick} !!${cmd}`);
    // Command output goes back to the caller as a NOTICE. A help listing or a
    // status dump is for the person who asked; pasting it into the room makes
    // every command an interruption for everyone else. Moderation
    // announcements still go to the channel — those the room needs to see.
    const reply = (m) => notice(nick, m);

    // The game claims its own commands first. !!join with no argument joins a
    // lobby; !!join #room stays the admin channel command underneath.
    if (game.handle(nick, chan, cmd, args, hostOf.get(nick.toLowerCase()))) return;
    // Fun comes after the game (a compartment's !!fix is not a joke) and before
    // moderation commands, which it shares no names with.
    if (fun.handle(nick, chan, cmd, args)) return;

    switch (cmd) {
        case 'help':
            reply( 'Everyone: !!seen <nick>, !!status, !!info [nick], !!rules. '
                + 'Fun: !!bite, !!slap, !!hug, !!pat, !!8ball <q>, !!ship <a> <b>, !!fortune, !!rip, !!vibe. '
                + 'Talk: !!icebreaker, !!hotseat [nick], !!story, !!toast [nick]. '
                + 'Mods: !!join/!!part #room, !!rooms, !!mass kick|ban|voice|devoice, '
                + '!!autoban add|remove|list <mask>, !!strict on|off, !!linkfilter on|off, '
                + '!!raidguard on|off, !!protect add|remove <nick|mask>, !!hardban <nick>, !!aicheck, '
                + '!!history on|off, '
                + '!!access, !!unwarn <nick>, !!sentient on|off, !!moderate on|off, !!autovoice on|off, !!fun on|off, !!recruit on|off|now, !!badword add|remove <w>, '
                + '!!whitelist add|remove <nick>, !!announce <msg>.');
            break;
        case 'seen': {
            if (!target) { reply( 'Usage: !!seen <nick>'); break; }
            const st = seenUsers[target.toLowerCase()];
            reply( st ? `${target} was last active ${ago(st)}.` : `I haven't seen ${target} since I rose.`);
            break;
        }
        case 'status': {
            const up = Math.floor((Date.now() - connectTime) / 1000);
            const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
            reply( `Online ${h}h${m}m. Sentient: ${sentientMode ? 'ON' : 'OFF'}. `
                + `Strict: ${strictNicks ? 'ON' : 'OFF'}. `
                + `Raidguard: ${raidGuard ? 'ON' : 'OFF'}. Filter: ${badwords.size} words. `
                + `Autoban masks: ${autobanMasks.size}. Ops here: ${opped.has(chanKey(chan)) ? 'yes' : 'NO'}.`);
            break;
        }
        // Who is this? Role, strikes, host, protection — the intel a mod needs
        // before acting. (Vampire's !info.)
        case 'info': {
            const who = target || nick;
            const k = who.toLowerCase();
            const role = isOwner(who) ? 'owner' : isAdmin(who) ? 'admin' : 'user';
            // Against the quota THIS person actually has. Reporting everyone's
            // strikes out of config.warnLimit told a mod that an unregistered
            // guest sat at 1/3 when one more word would remove them.
            const tier = tierOf(chan, who);
            const quota = moderatedRooms.has(chanKey(chan))
                ? moderatedQuotaFor(tier) : warnQuotaFor(tier);
            reply( `${who} — role: ${role} (${tier}), strikes: ${warns.get(k) || 0}/${quota}, `
                + `host: ${hostOf.get(k) || 'unknown'}, `
                + `${whitelist.has(k) ? 'whitelisted (immune)' : 'not whitelisted'}`
                + `${ignored.has(k) ? ', ignored' : ''}, last active: ${seenUsers[k] ? ago(seenUsers[k]) : 'never'}.`);
            break;
        }
        case 'rules':
            reply( channelRules || 'Be civil, no slurs, no spam, no unsolicited links. I am always watching. 🦇');
            break;

        // Forgiveness. The ladder can put someone one word away from a kick and
        // there was no way to undo it short of restarting the bot — so a mod who
        // decided a strike was unfair had to either say nothing or let it stand.
        // (Vampire's !unwarn.) Restores voice too: a strike usually arrives with
        // a devoice, and clearing one without the other is half an apology.
        case 'unwarn': {
            if (!admin) { reply('Access denied.'); break; }
            if (!target) { reply('Usage: !!unwarn <nick>'); break; }
            const k = target.toLowerCase();
            const had = warns.get(k) || 0;
            if (!had) { reply(`${target} has no strikes to clear.`); break; }
            warns.delete(k);
            if (moderatedRooms.has(chanKey(chan)) && deservesVoice(target, chan)) {
                send(`MODE ${chan} +v ${target}`);
            }
            say(chan, `\x0309[MOD]\x03 ${target} — slate wiped clean (${had} cleared) by ${nick}.`);
            break;
        }


        // ── Room control ─────────────────────────────────────────────────
        // Joining is not just a JOIN line: the room must also be added to the
        // watched set, or the bot sits there moderating nothing (isOurChannel
        // gates every handler).
        case 'join': {
            if (!admin || !target) { if (admin) reply( 'Usage: !!join #room'); break; }
            const room = target.startsWith('#') ? target : '#' + target;
            if (isOurChannel(room)) { reply( `Already in ${room}.`); break; }
            channelSet.add(chanKey(room));
            config.channels.push(room);
            send(`JOIN ${room}`);
            send(`PRIVMSG ChanServ :OP ${room} ${currentNick}`);
            send(`WHO ${room} %cuhnar,152`);
            send(`NAMES ${room}`);
            reply( `Drifting into ${room}. 🦇`);
            break;
        }
        case 'part': {
            if (!admin) { reply('Access denied.'); break; }
            const room = target ? (target.startsWith('#') ? target : '#' + target) : chan;
            if (!isOurChannel(room)) { reply( `I'm not in ${room}.`); break; }
            send(`PART ${room} :Called away`);
            channelSet.delete(chanKey(room));
            config.channels = config.channels.filter((c) => chanKey(c) !== chanKey(room));
            opped.delete(chanKey(room));
            members.delete(chanKey(room));
            if (chanKey(room) !== chanKey(chan)) reply( `Left ${room}.`);
            break;
        }
        case 'rooms':
            if (!admin) { reply('Access denied.'); break; }
            reply( `Watching: ${config.channels.map((c) => `${c}${opped.has(chanKey(c)) ? '(op)' : ''}`).join(', ')}`);
            break;

        // ── Mass tools for a raid in progress. Owners, admins, channel ops,
        //    whitelisted regulars, protected masks and the bot are never
        //    targeted, and kick/ban need an explicit confirmation. ──────────
        case 'mass': {
            if (!admin) { reply('Access denied.'); break; }
            const action = (args[0] || '').toLowerCase();
            if (!['kick', 'ban', 'voice', 'devoice'].includes(action)) {
                reply( 'Usage: !!mass kick|ban|voice|devoice'); break;
            }
            if (!requireOps(chan, `mass ${action}`)) break;
            // isExempt() alone is NOT enough here: whitelisted users were removed
            // from it on purpose so their MESSAGES still carry a warning quota.
            // Mass actions must additionally spare everyone protected from kicks,
            // or a single command clears the regulars out of the room.
            const targets = [...members.get(chanKey(chan)) || []]
                .filter((n) => !isExempt(n, chan) && !isProtectedFromKick(n));
            if (!targets.length) { reply( 'Nobody eligible — everyone here is protected.'); break; }

            // Kicking and banning in bulk is not undoable. Show the damage first
            // and require a second, explicit command.
            const destructive = action === 'kick' || action === 'ban';
            if (destructive && args[1] !== 'confirm') {
                massPending = { chan: chanKey(chan), action, at: Date.now(), n: targets.length };
                const preview = targets.slice(0, 8).join(', ') + (targets.length > 8 ? `, +${targets.length - 8} more` : '');
                reply( `\x0304[MOD]\x03 mass ${action} would remove \x02${targets.length}\x02 user(s): ${preview}. `
                    + `Protected and skipped: ${[...members.get(chanKey(chan)) || []].length - targets.length}. `
                    + `Type \x02!!mass ${action} confirm\x02 within 30s to go ahead.`);
                break;
            }
            if (destructive) {
                const ok = massPending && massPending.chan === chanKey(chan)
                    && massPending.action === action && Date.now() - massPending.at < 30000;
                massPending = null;
                if (!ok) { reply( `Nothing pending — run \x02!!mass ${action}\x02 first.`); break; }
            }
            reply( `\x0304[MOD]\x03 mass ${action} on ${targets.length} user(s). 🦇`);
            targets.forEach((n, i) => setTimeout(() => {
                if (action === 'kick') send(`KICK ${chan} ${n} :mass kick`);
                else if (action === 'ban') { send(`MODE ${chan} +b ${banMask(n)}`); send(`KICK ${chan} ${n} :mass ban`); }
                else if (action === 'voice') send(`MODE ${chan} +v ${n}`);
                else send(`MODE ${chan} -v ${n}`);
            }, i * 350));                                  // paced: avoids server flood kill
            break;
        }

        // ── Persistent mask rules, enforced on every join ────────────────
        case 'protect':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'add' && args[1]) {
                protectMasks.add(toMask(args[1]));
                reply( `Protected from other mods' kicks: ${toMask(args[1])} (${protectMasks.size} masks + the whitelist).`);
            } else if (args[0] === 'remove' && args[1]) {
                const m = protectMasks.has(args[1]) ? args[1] : toMask(args[1]);
                protectMasks.delete(m);
                reply( `Removed ${m} (${protectMasks.size} left).`);
            } else {
                reply( `Kick-protected: all ${whitelist.size} whitelisted users`
                    + `${protectMasks.size ? ' + masks: ' + [...protectMasks].join(', ') : ''}. `
                    + 'Use !!protect add|remove <nick|mask>.');
            }
            break;
        // A normal ban dies the moment they reconnect with a fresh cloak. This
        // one targets the stable network part, so it follows them — at the cost
        // of also covering others on that block, which is why it is deliberate
        // and separate rather than the default.
        case 'hardban': {
            if (!admin || !target) { if (admin) reply( 'Usage: !!hardban <nick>'); break; }
            const wide = banMask(target, true);
            const seen = banMask(target, false);
            if (wide === seen) {
                reply( `No cloak known for ${target} yet — plain ban applied.`);
            }
            if (!requireOps(chan, `hardban ${target}`)) break;
            send(`MODE ${chan} +b ${wide}`);
            send(`KICK ${chan} ${target} :banned`);
            autobanMasks.add(wide);
            reply( `\x0304[MOD]\x03 ${target} hard-banned as \x02${wide}\x02 — this survives a `
                + 'reconnect, and covers others on the same network block. '
                + `\x02!!autoban remove ${wide}\x02 to lift it.`);
            break;
        }
        case 'autoban':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'add' && args[1]) {
                // A bare nick is not a glob: "lucifer" only ever matches the
                // literal string, never "lucifer!user@host", so the rule never
                // fired. Turn a plain nick into a real mask — host-based when
                // we know it (survives a nick change), nick-based otherwise.
                const m = toMask(args[1]);
                autobanMasks.add(m);
                reply( `Auto-ban mask added: ${m} (${autobanMasks.size} total).`);
            }
            else if (args[0] === 'remove' && args[1]) {
                const m = autobanMasks.has(args[1]) ? args[1] : toMask(args[1]);
                autobanMasks.delete(m);
                reply( `Removed ${m} (${autobanMasks.size} left).`);
            }
            else reply( `Auto-ban masks (${autobanMasks.size}): ${[...autobanMasks].join(', ') || '(none)'}. Use !!autoban add|remove <mask>.`);
            break;
            send(`PRIVMSG ChanServ :CLEAR ${chan} BANS`);
            reply( '\x0304[MOD]\x03 Clearing every ban via ChanServ.');
            break;

        // ── Toggles ──────────────────────────────────────────────────────
        case 'strict':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'on') { strictNicks = true; reply( '\x0304[MOD]\x03 Strict mode ON — offensive nicks are removed on sight.'); }
            else if (args[0] === 'off') { strictNicks = false; reply( 'Strict mode OFF.'); }
            else reply( `Strict mode is ${strictNicks ? 'ON' : 'OFF'}. Use !!strict on|off.`);
            break;
        // Channel history is a channel MODE on InspIRCd (chanhistory), not a
        // ChanServ command: +H <lines>:<duration>, -H to clear. We are opped in
        // both rooms, so this needs no services at all.
        case 'history': {
            if (!admin) { reply( 'Access denied.'); break; }
            const sub = (args[0] || '').toLowerCase();
            if (sub !== 'on' && sub !== 'off') {
                reply( `Usage: !!history on [lines:duration]  ·  !!history off   (default ${historySpec})`);
                break;
            }
            const spec = sub === 'on' ? (args[1] || historySpec) : '';
            if (sub === 'on' && !/^\d+:\d+[smhdw]$/i.test(spec)) {
                reply( 'Format is lines:duration — e.g. !!history on 50:3d');
                break;
            }
            const replies = [];
            historyReport = (m) => { if (replies.length < 8) replies.push(m.replace(/\s+/g, ' ').trim()); };
            for (const c of config.channels) {
                send(sub === 'on' ? `MODE ${c} +H ${spec}` : `MODE ${c} -H`);
            }
            reply( `\x0306[HISTORY]\x03 ${sub === 'on' ? `+H ${spec}` : '-H'} on ${config.channels.join(', ')}…`);
            setTimeout(() => {
                historyReport = null;
                if (replies.length) replies.forEach((r) => reply( `\x0306[HISTORY]\x03 ${r.slice(0, 300)}`));
                else reply( `\x0306[HISTORY]\x03 no objection from the server — history is ${sub.toUpperCase()}.`);
            }, 5000);
            break;
        }
        case 'mod':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'on') { modEnabled = true; reply( '\x0304[MOD]\x03 Auto-moderation ON.'); }
            else if (args[0] === 'off') { modEnabled = false; reply( '\x0304[MOD]\x03 Auto-moderation OFF — only severe words and kick-protection remain.'); }
            else reply( `Auto-moderation is ${modEnabled ? 'ON' : 'OFF'}. Use !!mod on|off.`);
            break;
        case 'unquiet':
            if (!admin) { reply('Access denied.'); break; } if (!target) break;
            send(`MODE ${chan} -q ${target}!*@*`);
            reply( `Cleared any quiet on ${target}.`);
            break;
        // There was no way to know whether the AI layer actually worked until
        // abuse happened and it either acted or silently did not. This makes one
        // real call and reports which key and model answered — never the value.
        case 'aicheck': {
            if (!admin) { reply('Access denied.'); break; }
            if (!config.groqKey) { reply( 'No Groq key configured — word filter only.'); break; }
            reply( 'Testing the AI backend…');
            (async () => {
                const started = Date.now();
                try {
                    const data = await groqChat({
                        model: config.groqModel, temperature: 0, max_tokens: 40,
                        messages: [{ role: 'user', content: 'reply with one word: ok' }],
                    });
                    const reply = (data?.choices?.[0]?.message?.content || '').trim();
                    const served = data?.model || '(unknown)';
                    reply( reply
                        ? `\x0303AI OK\x03 — "${reply.slice(0, 20)}" from \x02${served}\x02 in ${Date.now() - started}ms. `
                          + `Keys loaded: ${[config.groqKey, config.groqKey2].filter(Boolean).length}.`
                        : `\x0304AI replied empty\x03 from ${served} — the model answered but returned no content.`);
                } catch (e) {
                    const m = String(e.message || e);
                    reply( `\x0304AI FAILED\x03 — ${/429|rate/i.test(m) ? 'rate-limited (quota)' : m.slice(0, 60)}. `
                        + 'Word filter still covers the room.');
                }
            })();
            break;
        }
        case 'linkfilter':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'on') { config.linkFilter = true; reply( 'Link filter ON.'); }
            else if (args[0] === 'off') { config.linkFilter = false; reply( 'Link filter OFF.'); }
            else reply( `Link filter is ${config.linkFilter ? 'ON' : 'OFF'}.`);
            break;
        case 'raidguard':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'on') { raidGuard = true; reply( `🛡️ Raid guard ON (${raidJoins} joins / ${raidWindowMs / 1000}s → auto-lock).`); }
            else if (args[0] === 'off') { raidGuard = false; reply( 'Raid guard OFF.'); }
            else reply( `Raid guard is ${raidGuard ? 'ON' : 'OFF'}.`);
            break;
        case 'sentient':
            if (!admin) { reply( 'Access denied.'); break; }
            if (args[0] === 'on') { sentientMode = true; reply( '🧠 Sentient moderation ACTIVE — I read the room now.'); }
            else if (args[0] === 'off') { sentientMode = false; reply( 'Sentient moderation off — scripted filter still stands guard.'); }
            else reply( `Sentient is ${sentientMode ? 'ON' : 'OFF'}.`);
            break;
        // Put a room on the voice ladder: +m, everyone present voiced, and
        // from then on losing voice is the first consequence rather than a
        // kick. The room keeps working exactly as before for anyone behaving.
        // Server-side auto-voice, so the room keeps working when we do not.
        // Both rooms run +m, which means an unvoiced person cannot speak — so
        // if both bots are down, nobody new can. ChanServ can grant voice on
        // join by itself, with no bot involved, and that is the layer that
        // should be holding the room up.
        //
        // We can set this because we are identified to the FOUNDER account;
        // ChanServ grants access to accounts, not to channel operators, which
        // is why an opped throwaway nick could not do it.
        // Who actually holds channel access. NOT the same as who is opped
        // right now: ChanServ's list is the persistent grant, the @ in the room
        // is just its effect, and someone can hold access while absent.
        // Read-only on purpose — removing access is a separate decision and
        // should be made looking at this output, not blind.
        // Trim the moderator list down to a keep-list. Reads ChanServ's own
        // listing first, previews exactly what would go, and does nothing until
        // confirmed — !!mass removed thirty regulars in one command, and an
        // access list is harder to rebuild than a room.
        case 'access': {
            if (!admin) { reply('Access denied.'); break; }
            const lines = [];
            servicesReport = (m) => { if (lines.length < 40) lines.push(m.replace(/\s+/g, ' ').trim()); };
            for (const c of config.channels) send(`PRIVMSG ChanServ :FLAGS ${c}`);
            reply(`\x0306[ACCESS]\x03 asking ChanServ about ${config.channels.join(', ')}…`);
            setTimeout(() => {
                servicesReport = null;
                if (!lines.length) {
                    reply('ChanServ said nothing — do I still hold access to read this?');
                } else {
                    lines.forEach((l) => reply(l.slice(0, 300)));
                }
            }, 8000);
            break;
        }
        case 'autovoice': {
            if (!admin) { reply('Access denied.'); break; }
            const target = args[1] || '$registered';
            const replies = [];
            servicesReport = (m) => { if (replies.length < 6) replies.push(m.replace(/\s+/g, ' ').trim()); };
            if (args[0] === 'on') {
                for (const c of config.channels) send(`PRIVMSG ChanServ :FLAGS ${c} ${target} +V`);
            } else if (args[0] === 'off') {
                for (const c of config.channels) send(`PRIVMSG ChanServ :FLAGS ${c} ${target} -V`);
            } else {
                for (const c of config.channels) send(`PRIVMSG ChanServ :FLAGS ${c}`);
                reply('Current ChanServ access lists:');
                setTimeout(() => { servicesReport = null; replies.forEach((r) => reply(r.slice(0, 300))); }, 6000);
                break;
            }
            reply(`\x0306[AUTOVOICE]\x03 ${args[0]} for ${target} on ${config.channels.join(', ')}…`);
            setTimeout(() => {
                servicesReport = null;
                if (replies.length) replies.forEach((r) => reply(`\x0306[ChanServ]\x03 ${r.slice(0, 300)}`));
                else reply('\x0306[AUTOVOICE]\x03 ChanServ said nothing — check I still hold founder access.');
            }, 6000);
            break;
        }
        case 'moderate': {
            if (!admin) { reply('Access denied.'); break; }
            const ch = chanKey(chan);
            if (args[0] === 'on') {
                moderatedRooms.add(ch);
                send(`MODE ${chan} +m`);
                for (const n of members.get(ch) || []) {
                    if (!/[~&@%+]/.test(prefixIn(ch, n))) send(`MODE ${chan} +v ${n}`);
                }
                say(chan, '\x0304[MOD]\x03 Moderated. Everyone here has a voice; '
                    + `lose it for ${devoiceMinutes}m if you earn it, kicked on ${config.warnLimit} strikes.`);
            } else if (args[0] === 'off') {
                moderatedRooms.delete(ch);
                send(`MODE ${chan} -m`);
                say(chan, '\x0304[MOD]\x03 Moderation lifted — anyone can speak.');
            } else {
                reply(`${chan} is ${moderatedRooms.has(ch) ? 'MODERATED (voice ladder)' : 'open'}. `
                    + '!!moderate on|off');
            }
            break;
        }
        case 'recruit':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'on') {
                recruiter.enabled = recruiter.channels.length > 0;
                recruiter.start(log);       // idempotent; the timers may not exist yet
                recruiter.soon();           // and don't inherit the gap rolled while it was off
                reply(recruiter.enabled
                    ? `Recruiting from ${recruiter.channels.join(', ')} — next attempt ${recruiter.dueIn()}.`
                    : 'No RECRUIT_CHANNELS set.');
            }
            else if (args[0] === 'off') { recruiter.enabled = false; reply('Recruiting off.'); }
            else if (args[0] === 'now') {
                const r = recruiter.inviteOne();
                if (r) { reply(`Invited ${r.target} from ${r.chan}.`); break; }
                // Say WHY. "Nobody eligible" cannot tell four different
                // problems apart, and each needs a different fix.
                reply(`Nobody eligible. ${recruiter.enabled ? '' : 'Recruiting is OFF. '}`);
                recruiter.explain().forEach((l) => reply(l));
            } else {
                reply(`Recruiting is ${recruiter.enabled ? 'ON' : 'OFF'}`
                    + `${recruiter.channels.length ? ` from ${recruiter.channels.join(', ')}` : ' (no channels set)'}`
                    + `; ${recruiter.invited.size} invited so far, next attempt ${recruiter.dueIn()}. `
                    + '!!recruit on|off|now');
                // An INVITE goes privately to whoever is invited, so the room
                // sees nothing whether this is working perfectly or not at all.
                // Show the last few by name, or say plainly that there are none.
                if (recruiter.recent.length) {
                    reply('Recent: ' + recruiter.recent
                        .map((r) => `${r.target} (${r.chan}, ${ago(r.at)})`).join(', '));
                } else {
                    reply('No invitations sent yet this run.');
                }
                recruiter.explain().forEach((l) => reply(l));
            }
            break;
        case 'fun':
            if (!admin) { reply( 'Access denied.'); break; }
            if (args[0] === 'on') { fun.enabled = true; reply( '🦇 Fun commands ON — !!bite, !!8ball, !!ship, !!fortune, !!rip, !!vibe, !!slap.'); }
            else if (args[0] === 'off') { fun.enabled = false; reply( 'Fun off. Back to brooding.'); }
            else reply( `Fun is ${fun.enabled ? 'ON' : 'OFF'}.`);
            break;
        case 'badword':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'add' && args[1]) {
                const w = args[1].toLowerCase();
                if (badwords.has(w)) reply( `"${w}" is already in the filter (${badwords.size} words).`);
                else { badwords.add(w); reply( `Added "${w}" (${badwords.size} words).`); }
            }
            else if (args[0] === 'remove' && args[1]) { badwords.delete(args[1].toLowerCase()); reply( `Removed "${args[1]}" (${badwords.size} total).`); }
            else reply( `Filter holds ${badwords.size} words.`);
            break;
        case 'whitelist':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'add' && args[1]) { whitelist.add(args[1].toLowerCase()); reply( `${args[1]} is trusted now — immune to auto-mod. 🩸`); }
            else if (args[0] === 'remove' && args[1]) { whitelist.delete(args[1].toLowerCase()); reply( `${args[1]} removed from the whitelist.`); }
            else reply( `Whitelist (${whitelist.size}): ${[...whitelist].join(', ') || '(empty)'}.`);
            break;
        case 'announce':
            if (!admin) { reply('Access denied.'); break; } if (!args.length) break;
            say(chan, `\x0304[ANNOUNCE]\x03 \x02${args.join(' ')}\x02`);   // for the room, by definition
            break;
        default: break;
    }
}

// --- Connection ---
function connect() {
    if (connecting) return;
    connecting = true; hasJoined = false; ready = false; currentNick = config.nick;
    log('INFO', `Connecting to ${config.host}:${config.port} (${config.tls ? 'TLS' : 'plaintext'}) as ${config.nick}...`);

    const onReady = () => {
        connecting = false;
        lastRx = Date.now();
        log('TCP', `Connected${config.tls ? ' over TLS' : ''} — registering...`);
        // Ask for the IRCv3 bits the trust hierarchy depends on:
        //   extended-join  -> the JOIN line carries the NickServ account
        //   account-notify -> we hear about later logins/logouts
        //   multi-prefix   -> NAMES shows all prefixes (@+nick), not just one
        send('CAP REQ :extended-join account-notify multi-prefix server-time');
        send(`NICK ${config.nick}`);
        send(`USER ${config.nick} 0 * :${config.realname}`);
        setTimeout(() => { if (!hasJoined) config.channels.forEach((c) => send(`JOIN ${c}`)); }, 5000);
    };

    socket = config.tls
        ? tls.connect({ host: config.host, port: config.port, servername: config.host }, onReady)
        : net.createConnection({ host: config.host, port: config.port }, onReady);
    socket.setKeepAlive(true, 30000);
    let buf = '';
    lastRx = Date.now(); pingProbeSent = false;
    socket.on('data', (data) => {
        lastRx = Date.now(); pingProbeSent = false;   // any byte proves the link is alive
        buf += data.toString();
        const lines = buf.split('\r\n');
        buf = lines.pop();
        lines.forEach(handleLine);
    });
    socket.on('error', (err) => { connecting = false; log('ERROR', err.message); });
    socket.on('close', () => { connecting = false; opped.clear(); game.onDisconnect(); log('INFO', 'Connection closed.'); scheduleReconnect(); });
}
/**
 * Re-identify, take our nick back, and rejoin. Used both when NickServ renames
 * us mid-session and by the watchdog below.
 */
function reclaimNick() {
    if (!config.password) return;
    const account = config.nsAccount || config.nick;
    send(`PRIVMSG NickServ :IDENTIFY ${account} ${config.password}`);
    setTimeout(() => {
        send(`PRIVMSG NickServ :GHOST ${config.nick} ${config.password}`);
        send(`PRIVMSG NickServ :RELEASE ${config.nick} ${config.password}`);
        send(`NICK ${config.nick}`);
        setTimeout(() => {
            config.channels.forEach((c) => send(`JOIN ${c}`));
            log('INFO', `Reclaim attempted — now ${currentNick}`);
        }, 1500);
    }, 1200);
}

// Losing the nick is not a one-off event at connect: enforcement, a netsplit or
// a stale ghost can take it at any point, and the bot is useless while it holds
// a Guest nick the channel bans. Keep checking.
let nickWatchdogStarted = false;
function startNickWatchdog() {
    if (nickWatchdogStarted) return;
    nickWatchdogStarted = true;
    setInterval(() => {
        if (!ready || !socket || !socket.writable) return;
        if (currentNick.toLowerCase() === config.nick.toLowerCase()) return;
        log('WARN', `Nick is "${currentNick}", wanted "${config.nick}" — reclaiming.`);
        reclaimNick();
    }, 60000);
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectAttempts += 1;

    // A connection that closes before we ever reach 001 is a different animal
    // from one that drops mid-session. It means the SERVER refused this IP —
    // GitHub runner addresses land on DroneBL often enough that it happens for
    // real — and no amount of retrying fixes an address. Retrying it for six
    // hours is worse than useless: the room has no bot the entire time, and the
    // one thing that WOULD help is a different IP, which is exactly what the
    // next run gets. So give up and let the cron start a fresh one.
    if (!everRegistered) {
        preRegFailures += 1;
        if (preRegFailures >= 5) {
            log('ERR', `Refused ${preRegFailures} times without ever registering — this address `
                + 'looks blocked. Exiting so the next run picks up a different one.');
            process.exit(1);
        }
        log('INFO', `Rejected before registering (${preRegFailures}/5) — retrying in 20s.`);
        reconnectTimer = setTimeout(connect, 20000);
        return;
    }

    const delay = Math.min(10000 * 2 ** (reconnectAttempts - 1), 300000); // 10s,20s,40s… cap 5m — avoids connection-flood bans
    log('INFO', `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts}).`);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}

// Channel history (+H) is replayed to us as ordinary PRIVMSGs the moment we
// join. Without this the bot re-moderates and re-answers conversations that
// already happened — every six hours, on every restart. The server-time tag is
// what distinguishes a replayed line from a live one; the 2.5s ready flag only
// covers replay that arrives promptly, and a slow join defeats it.
function isReplay(tags) {
    const t = tags && tags.time;
    if (!t) return false;
    const when = Date.parse(t);
    return Number.isFinite(when) && when < connectTime - 5000;
}

function handleLine(line) {
    if (!line.trim()) return;
    let tags = null;
    if (line.startsWith('@')) {
        const sp = line.indexOf(' ');
        tags = {};
        for (const kv of line.slice(1, sp).split(';')) {
            const i = kv.indexOf('=');
            if (i > 0) tags[kv.slice(0, i)] = kv.slice(i + 1);
        }
        line = line.slice(sp + 1);
    }
    if (line.startsWith('PING')) { send('PONG' + line.slice(4)); return; }
    if (line.startsWith('ERROR') || /closing link|throttl|k-lin|g-lin|z-lin|banned|flood|too many|dnsbl|blacklist|access denied/i.test(line)) {
        log('SRV', line.slice(0, 200));   // capture WHY the server rejects us
    }

    let prefix = '', command = '', params = [];
    if (line.startsWith(':')) { const p = line.split(' '); prefix = p[0]; command = p[1]; params = p.slice(2); }
    else { const p = line.split(' '); command = p[0]; params = p.slice(1); }
    const nick = (prefix.match(/^:(\S+?)!/) || [])[1] || '';
    const tgt = params[0] || '';
    const msg = params.slice(1).join(' ').replace(/^:/, '');

    if (command === '433') {                 // nick in use → take a temp nick so we can finish registering
        currentNick += '_';
        log('WARN', `Nick in use — trying ${currentNick}`);
        send(`NICK ${currentNick}`);
    }
    if (command === 'NICK' && nick) {
        const newNick = (params[0] || '').replace(/^:/, '');
        if (nick.toLowerCase() === currentNick.toLowerCase()) {
            currentNick = newNick || currentNick;
            // NickServ enforcement renames an unidentified protected nick to
            // Guest####. The channel bans Guest*, so the bot then sits there
            // unable to join anything and nothing notices. Recover immediately.
            if (/^Guest\d+$/i.test(currentNick)) {
                log('WARN', `Enforced rename to ${currentNick} — re-identifying and reclaiming.`);
                reclaimNick();
            }
        } else if (newNick) {
            const h = hostOf.get(nick.toLowerCase());
            if (h) hostOf.set(newNick.toLowerCase(), h);
            game.onNick(nick, newNick);
        }
    }

    if (command === 'CAP') {
        const sub = (params[1] || '').toUpperCase();
        if (sub === 'ACK' || sub === 'NAK') { send('CAP END'); log('CAP', line.slice(0, 120)); }
    }
    if (command === '001') {
        reconnectAttempts = 0;
        everRegistered = true;
        preRegFailures = 0;
        // +g (callerid) refuses private messages from anyone not on our accept
        // list, +R from anyone unregistered. Enforced by the SERVER, so a DM
        // flood never reaches our socket and cannot get us killed for excess
        // flood — ignoring it bot-side would still mean reading every line.
        // Verified on this network: services are exempt, so ChanServ and
        // NickServ still reach us. +i keeps us out of unsolicited scans.
        // +I hides our channel list from WHOIS — verified: another client sees
        // the nick and host but gets no channel line at all. +g/+R close DMs.
        // NOTE the absence of -x: +x is the cloak, and dropping it would put the
        // runner's real address in everyone's WHOIS. Hiding and unmasking are
        // opposite things and one letter apart.
        send(`MODE ${currentNick} +gIiR`);
        send('PRIVMSG HostServ :ON');        // reapply the vhost after a reconnect
        log('OK', `Registered as ${currentNick}.`);
        // Identify to the ACCOUNT immediately — the two-arg form works even if NickServ
        // enforcement already bumped us to a Guest nick, and fast identify keeps our nick.
        const account = config.nsAccount || config.nick;
        if (config.password) { send(`PRIVMSG NickServ :IDENTIFY ${account} ${config.password}`); log('AUTH', `IDENTIFY ${account} sent`); }
        // Give identify a moment, reclaim our nick if we were bumped, THEN join — so we
        // enter as the identified bot, not as a banned Guest.
        setTimeout(() => {
            if (config.password && currentNick.toLowerCase() !== config.nick.toLowerCase()) {
                send(`PRIVMSG NickServ :GHOST ${config.nick} ${config.password}`);
                send(`NICK ${config.nick}`);
            }
            config.channels.forEach((c) => send(`JOIN ${c}`));
            if (game.active) {
                game.onReconnect();           // same process: the round survives
            } else {
                // Fresh process: a round cannot be recovered, but a crash may
                // have left players quieted. Clear anything shaped like ours.
                game.coldStart(config.channels[0]);
            }
            startNickWatchdog();
            ready = true;
            log('OK', 'Identified, joined — moderation live.');
            // A dead key looks exactly like a quiet room: the AI layer simply
            // stops having opinions and nobody finds out until abuse walks
            // through it. Prove it works at startup, and tell the operators if
            // it does not.
            selfCheckAI();
            // Not immediately: registration queues joins, WHO, NAMES, mode
            // sets and the quiet-list request through a 5-lines/second
            // limiter, so a probe fired now sits behind twenty other lines and
            // times out on our own traffic. It reported "ChanServ is not
            // answering" when ChanServ was answering fine.
            setTimeout(() => verifyServices(), 20000);
            // Re-sweep periodically. A single missed JOIN used to mean somebody
            // sat voiceless indefinitely; now the worst case is a couple of
            // minutes. Cheap: the prefix check makes it a no-op for anyone who
            // already has voice.
            setInterval(() => config.channels.forEach((c) => voiceSweep(chanKey(c))), 30000);
            // Recruiting rooms belong to other people, and the bot is a guest
            // there: it can be dropped by a netsplit, a kick, or a JOIN that
            // simply lost its place in the outbound queue at startup. This used
            // to fire exactly once, 2.5s after ready, and never again — one
            // missed JOIN meant that room contributed nothing for the whole
            // six-hour shift, silently, because an empty member list is
            // indistinguishable from an empty room.
            //
            // Re-checking is cheap: JOIN on a channel we are already in is a
            // no-op at the server, and we only send it when we cannot see
            // ourselves in the member list.
            const joinRecruitRooms = () => {
                for (const c of recruiter.channels) {
                    const here = members.get(chanKey(c)) || new Set();
                    const inIt = [...here].some((m) => m.toLowerCase() === currentNick.toLowerCase());
                    if (!inIt) { send(`JOIN ${c}`); send(`NAMES ${c}`); }
                }
            };
            joinRecruitRooms();
            setInterval(joinRecruitRooms, 300000);   // every 5 minutes
            recruiter.start(log);
            quietSweep = true;
            config.channels.forEach((c) => send(`MODE ${c} +q`));   // list, then clear ours
            setTimeout(() => { quietSweep = false; }, 15000);
        }, 2500);
    }
    if (command === '900' || (command === 'NOTICE' && /identified|logged in/i.test(msg))) {
        if (!hasJoined) config.channels.forEach((c) => send(`JOIN ${c}`));
    }
    // ChanServ talks back in NOTICEs. Both the history command and the services
    // health check listen here; each is inert unless it is actually waiting.
    if (command === 'NOTICE' && /^chanserv$/i.test(nick || '')) {
        if (servicesReport) servicesReport(msg);
    }
    // The server's verdict on a !!history MODE change: 472 unknown mode char
    // (chanhistory not loaded), 482 not opped, 467/461 malformed. Silence means
    // it was accepted.
    if (historyReport && ['472', '482', '467', '461', '696'].includes(command)) {
        historyReport(params.slice(1).join(' ').replace(/^:/, '') || msg);
    }
    // Remember every user@host we see — needed for bans that actually hold.
    const userHost = (prefix.match(/^:\S+?!(\S+)/) || [])[1];
    if (nick && userHost) hostOf.set(nick.toLowerCase(), userHost);

    // 482 = we tried an op-only action without ops. Drop the stale ops flag so
    // requireOps() stops lying, and ask ChanServ to fix it.
    if (command === '482') {
        const c = params[1] || '';
        opped.delete(chanKey(c));
        log('MOD', `482 no-ops in ${c} — requesting ops from ChanServ.`);
        send(`PRIVMSG ChanServ :OP ${c} ${currentNick}`);
        say(c, '\x0304[MOD]\x03 That needs ops and the server refused me. Asking ChanServ — try again in a moment.');
    }

    // Track our own +o/-o so we know whether actions will actually land.
    if (command === 'MODE' && isOurChannel(tgt)) {
        const modes = params[1] || '';
        const targets = params.slice(2);
        let adding = true, ti = 0;
        for (const ch of modes) {
            if (ch === '+') { adding = true; continue; }
            if (ch === '-') { adding = false; continue; }
            if ('ovhbeIkl'.includes(ch)) {
                const who = targets[ti++] || '';
                if ('ovhq'.includes(ch) && who) {          // track everyone's status
                    const key = `${chanKey(tgt)}|${who.toLowerCase()}`;
                    const sym = { o: '@', v: '+', h: '%', q: '~' }[ch];
                    const cur = prefixOf.get(key) || '';
                    prefixOf.set(key, adding ? (cur.includes(sym) ? cur : cur + sym)
                                             : cur.split(sym).join(''));
                }
                if (ch === 'o' && who.toLowerCase() === currentNick.toLowerCase()) {
                    if (adding) { opped.add(chanKey(tgt)); log('OK', `Got ops in ${tgt}.`); }
                    else { opped.delete(chanKey(tgt)); log('WARN', `Lost ops in ${tgt}.`); }
                }
            }
        }
    }

    // extended-join: ":nick!u@h JOIN #chan account :realname"  ('*' = none)
    if (command === 'JOIN' && params.length >= 2 && nick) {
        const acct = (params[1] || '').replace(/^:/, '');
        accountOf.set(nick.toLowerCase(), acct === '*' ? '' : acct);
    }
    if (command === 'ACCOUNT' && nick) {                 // logged in/out later
        const acct = (params[0] || '').replace(/^:/, '');
        accountOf.set(nick.toLowerCase(), acct === '*' ? '' : acct);
    }
    if (command === '354' && params[1]) {                // WHOX reply
        // HybridIRC answers "%cuhnar,152" WITHOUT echoing the querytype back —
        // verified against the live server — so the fields land unshifted:
        //   354 <me> <chan> <user> <host> <nick> <account> :<real>
        // Other ircds DO echo it, which shifts everything one place right.
        // Detect rather than assume, because reading the wrong shape keys the
        // account map by host and silently makes every registered user look
        // like a stranger.
        const q = params[1] === '152';
        const user = q ? params[3] : params[2];
        const host = q ? params[4] : params[3];
        const n    = q ? params[5] : params[4];
        const acct = q ? params[6] : params[5];
        if (n) {
            accountOf.set(n.toLowerCase(), (acct && acct !== '0') ? acct : '');
            if (user && host) hostOf.set(n.toLowerCase(), `${user}@${host}`);
        }
    }
    if (command === '330' && params[1] && params[2]) {   // WHOIS "is logged in as"
        accountOf.set(params[1].toLowerCase(), params[2]);
    }

    if (command === '728' && params[3]) {
        game.onQuietEntry(params[1], params[3]);
        // A mute is meant to last minutes, but the host restarts us every few
        // hours — so any quiet WE set that outlived the process is stale by
        // definition, and the person is silenced with nobody left to release
        // them. Clear ours on the way in. params: [us, chan, 'q', mask, setter, ts]
        if (quietSweep && (params[4] || '').toLowerCase().startsWith(config.nick.toLowerCase())) {
            log('MOD', `Clearing a mute left behind by a previous run: ${params[3]}`);
            send(`MODE ${params[1]} -q ${params[3]}`);
        }
    }
    if (command === '729') { game.endQuietSweep(); quietSweep = false; }

    // 315 = end of WHO -> accounts are now known. Sweep again: NAMES may have
    // finished first, in which case the earlier sweep saw nobody as registered.
    if (command === '315') voiceSweep(chanKey(params[1] || ''));

    if (command === '353') {                       // NAMES reply -> membership + our own status
        const ch = chanKey(params[2] || '');
        const set = members.get(ch) || new Set();
        for (const raw of (params.slice(3).join(' ').replace(/^:/, '')).split(/\s+/)) {
            const pfx = (raw.match(/^[~&@%+]+/) || [''])[0];
            const n = raw.replace(/^[~&@%+]+/, '');
            if (!n) continue;
            set.add(n);
            prefixOf.set(`${ch}|${n.toLowerCase()}`, pfx);
            // ~ owner, & admin, @ op, % halfop all carry kick rights here.
            if (n.toLowerCase() === currentNick.toLowerCase() && /[~&@%]/.test(pfx)) {
                if (!opped.has(ch)) log('OK', `Already opped in ${ch} (seen as "${pfx}" in NAMES).`);
                opped.add(ch);
            }
        }
        members.set(ch, set);
    }
    // WHO reply -> learn every user's host, so a ban works even for someone
    // who has not spoken yet (otherwise we fall back to a weak nick mask).
    if (command === '352' && params[5] && params[2] && params[3]) {
        hostOf.set(params[5].toLowerCase(), `${params[2]}@${params[3]}`);
    }
    if (command === 'PART' && nick) {
        (members.get(chanKey(tgt)) || new Set()).delete(nick);
        game.onPart(nick, tgt);
    }
    if (command === 'QUIT' && nick) {
        for (const set of members.values()) set.delete(nick);
        game.onQuit(nick);
    }

    if (command === 'JOIN' && nick.toLowerCase() === config.nick.toLowerCase()) {
        hasJoined = true;
        const c = (tgt || msg).replace(/^:/, '');
        log('OK', `Joined ${c}`);
        send(`PRIVMSG ChanServ :OP ${c} ${currentNick}`);   // claim ops up front
        send(`WHO ${c} %cuhnar,152`);                       // WHOX: hosts AND accounts
        send(`NAMES ${c}`);                                 // and our own op status
        // Deliberately silent. This used to announce "Dracula stirs" in every
        // room it owns, which was useful while the rooms were being set up and
        // is noise now: the host hands the job over roughly every six hours and
        // restarts on every push, so a live room got the same line four or more
        // times a day for no news at all.
        //
        // The part worth keeping — telling a newcomer that !!help exists —
        // belongs to ChanServ ENTRYMSG, which shows it to each person as they
        // arrive, once, and survives every restart. Persistent things go to
        // services; the bot only says something when something happened.
    } else if (command === '366') {           // end of NAMES -> membership known
        voiceSweep(chanKey(params[1] || ''));
    } else if (command === 'JOIN' && nick) {
        const c = chanKey((tgt || msg).replace(/^:/, ''));
        if (!isOurChannel(c)) return;
        (members.get(c) || members.set(c, new Set()).get(c)).add(nick);
        game.onJoin(nick, c);

        // Voice on arrival. NOT gated on `ready`: that flag is a replay guard
        // for messages, and a JOIN is not a message — gating on it means a
        // newcomer who arrives during the first seconds of a reconnect never
        // gets voiced at all.
        //
        // Checked twice, because this went wrong live and I could not reproduce
        // it: the second pass costs one comparison and covers every race I
        // could not pin down — ChanServ opping us a moment after we join, a
        // NAMES reply landing late, our own prefix bookkeeping being briefly
        // stale. In a +m room the cost of missing one JOIN is a person sitting
        // there unable to speak or to ask why, so belt and braces is the right
        // trade.
        const voiceIfNeeded = () => {
            if (game.isGameChannel(c) || !config.autoVoice) return;
            if (!deservesVoice(nick, c) || !opped.has(c)) return;
            if (/[~&@%+]/.test(prefixIn(c, nick))) return;
            if (!(members.get(c) || new Set()).has(nick)) return;    // already left
            send(`MODE ${c} +v ${nick}`);
        };
        voiceIfNeeded();
        setTimeout(voiceIfNeeded, 5000);

        // Persistent auto-ban masks — enforced the moment they walk in.
        if (ready && !moderationOff(c) && !isExempt(nick) && userHost) {
            const hit = matchesAnyMask(nick, userHost);
            if (hit) {
                log('MOD', `Auto-ban mask ${hit} matched ${nick}!${userHost}`);
                banUser(c, nick, 'auto-ban rule');
                return;
            }
        }
        // Strict mode: the NICK itself is screened - word list first, then AI.
        if (ready && strictNicks && !moderationOff(c)) { screenNick(c, nick); }

        // Raid guard: a burst of joins in a few seconds is a raid, not traffic.
        if (ready && raidGuard && !game.isGameChannel(c)) {
            const now = Date.now();
            const hist = (joinLog.get(c) || []).filter((t) => now - t < raidWindowMs);
            hist.push(now); joinLog.set(c, hist);
            if (hist.length >= raidJoins && !lockedByRaid.has(c)) {
                lockedByRaid.add(c);
                joinLog.set(c, []);
                send(`MODE ${c} +i`);
                say(c, `\x0304[MOD]\x03 Raid detected (${hist.length} joins in ${raidWindowMs / 1000}s) — invite-only for ${raidLockSec}s. 🦇`);
                log('MOD', `Raid lock on ${c}`);
                setTimeout(() => {
                    lockedByRaid.delete(c);
                    send(`MODE ${c} -i`);
                    say(c, '\x0304[MOD]\x03 Doors open again.');
                }, raidLockSec * 1000);
            }
        }
    }
    if (command === 'KICK' && params[1] && isOurChannel(tgt)) {
        const victim = params[1];
        if (victim.toLowerCase() === config.nick.toLowerCase()) {
            opped.delete(chanKey(tgt));
            setTimeout(() => send(`JOIN ${tgt}`), 3000);
        } else if (ready && nick && nick.toLowerCase() !== currentNick.toLowerCase()
                   && isProtectedFromKick(victim)) {
            // Someone else kicked a protected user. (Our own kicks are excluded
            // above, or we would undo our own moderation.)
            rescueFromKick(tgt, victim, nick, params.slice(2).join(' ').replace(/^:/, ''));
        }
        (members.get(chanKey(tgt)) || new Set()).delete(victim);
    }

    if (command === 'PRIVMSG' && isOurChannel(tgt) && nick) {
        if (isReplay(tags)) return;                       // +H backlog, not live
        seenUsers[nick.toLowerCase()] = Date.now();
        if (!ready) return;                                   // ignore replayed backlog
        if (ignored.has(nick.toLowerCase())) return;          // !!ignore

        if (msg.startsWith('!!')) { handleCommand(tgt, nick, msg); return; }
        // A plain-English order from someone who already holds authority.
        // Before the filters, because a moderator saying "Dracula ban troll42
        // for racism" must not be screened as if THEY said something abusive.
        if (handleOrder(tgt, nick, msg)) return;
        if (scriptedModeration(tgt, nick, msg)) return;       // scripted filter first
        // Sentient screening runs in the background. It must NOT return here:
        // doing so silenced every reply once sentient mode became the default.
        if (sentientMode) sentientModeration(tgt, nick, msg);

        // Reply if mentioned by name
        if (new RegExp(`\\b${config.nick}\\b`, 'i').test(msg)) {
            getAIResponse(msg, nick).then((r) => { if (r) say(tgt, `${nick}: ${r}`); });
            return;
        }
        fun.ambient(tgt, nick, msg);          // rare unprompted quip on greetings
    }
}

// --- Graceful shutdown (GitHub Actions sends SIGTERM at the 6h timeout) ---
function shutdown(sig) {
    log('INFO', `${sig} — leaving cleanly.`);
    // The 6-hour job handoff arrives here. Ending the round properly is the
    // difference between "the game stopped" and "why am I still muted?".
    try {
        if (game.active) {
            game.say('\x0304The bot is being restarted — this round is void.\x03');
            game.end(null, 'bot restart');
        }
    } catch (e) { /* never block the quit */ }
    try { send('QUIT :The bats scatter into the night... 🦇'); } catch (e) { /* noop */ }
    setTimeout(() => process.exit(0), 800);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Start + health watchdog ---
// Checking socket.writable is NOT enough. A half-open TCP connection (NAT
// timeout, dropped route, server wedged) stays writable forever: our writes
// vanish into the void and nothing ever arrives, so the bot looks online but
// answers nothing and every action silently fails. That is the "it gets stuck"
// bug. Fix: watch for INBOUND traffic. The IRC server pings us every couple of
// minutes, so silence is real evidence the link is dead — probe once, then tear
// it down so the normal reconnect path runs.
const RX_SILENCE_PROBE_MS = 180000;   // 3m quiet → send our own PING
const RX_SILENCE_DEAD_MS = 260000;    // still quiet after that → declare it dead

connect();
setInterval(() => {
    if (!connecting && !reconnectTimer && (!socket || socket.destroyed || !socket.writable)) {
        connect();
        return;
    }
    if (!socket || !socket.writable || connecting) return;

    const quiet = Date.now() - lastRx;
    if (quiet > RX_SILENCE_DEAD_MS) {
        log('WARN', `No data for ${Math.round(quiet / 1000)}s — connection is dead, resetting.`);
        opped.clear();
        try { socket.destroy(); } catch (e) { /* close handler schedules the reconnect */ }
    } else if (quiet > RX_SILENCE_PROBE_MS && !pingProbeSent) {
        pingProbeSent = true;
        log('INFO', `Quiet for ${Math.round(quiet / 1000)}s — probing with PING.`);
        send(`PING :keepalive-${Date.now()}`);
    }
}, 30000);
