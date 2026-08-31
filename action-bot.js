const net = require('net');
const tls = require('tls');
const { FindIt } = require('./findit');
const { Fun } = require('./fun');
const { Recruiter } = require('./recruit');
const { parseOrder, PROTECTED_NICKS } = require('./orders');
const { Retort, shieldLine } = require('./retort');
const { geminiChat } = require('./gemini');
const { Guardian, victimOf } = require('./guardian');
const { Watch } = require('./watch');
const { Handshake } = require('./handshake');
const { Feuds, severityOf, aimedAt, isBanter, hasLaughter, isBenignHinglish } = require('./feud');
const { TrustList, effective } = require('./trust');
const { pack } = require('./trustrelay');
const { Reputation } = require('./reputation');
const { solicits } = require('./solicit');

// --- Configuration (all from env / GitHub Secrets) ---
const list = (s) => (s || '').split(',').map((x) => x.toLowerCase().trim()).filter(Boolean);
const onOff = (s) => /^(1|true|yes|on)$/i.test(s || '');
const channels = (process.env.IRC_CHANNEL || '#batcave').split(',').map((s) => s.trim()).filter(Boolean);

// The games room counts as ours.
//
// FINDIT_ROOM is where FindIt is hosted, but it was not in IRC_CHANNEL — so the
// bot ANNOUNCED the round there and then could not hear a word of it. Every
// !!join went to the "a room that is not ours, we are a guest" branch and was
// discarded, and the round scrubbed with "Not enough crew (0/4)" while people
// were typing !!join at it. It also needs ops there to quiet the dead and set
// the topic, and ops only get claimed for channels we consider ours.
const findItRoom = (process.env.FINDIT_ROOM || '').trim();
if (findItRoom && !channels.some((c) => c.toLowerCase() === findItRoom.toLowerCase())) {
    channels.push(findItRoom);
}

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
    // llama-3.3-70b-versatile was DECOMMISSIONED by Groq. Asking for it 404s,
    // and because a 404 only moves to the next MODEL, every single moderation
    // call was spending two HTTP requests — one to a model that no longer
    // exists, then one to the fallback that answered. Double consumption
    // against the rate limit, which is what produced the 429 alerts.
    //
    // Verified 2026-08-22 against the live account: of the 13 models it can
    // reach, gpt-oss-20b scored 7/7 on the real moderation prompt with real
    // room messages, including both cases that previously caused wrong kicks.
    // gpt-oss-safeguard-20b managed 4/7 — it returns EMPTY on explicit content,
    // despite the name — and qwen3.6-27b 1/7, emitting <think> blocks and
    // echoing the template. Re-run scratchpad/cmpmodels.py before changing this.
    groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    groqModelFallback: process.env.GROQ_MODEL_FALLBACK || 'openai/gpt-oss-120b',
    // Sized for a free-tier daily token allowance at ~600 tokens a call, with
    // headroom for the !!ai command and the mention replies that share it.
    aiMaxPerDay: parseInt(process.env.AI_MAX_PER_DAY || '600', 10),
    aiMaxPerMin: parseInt(process.env.AI_MAX_PER_MIN || '12', 10),
    // A provider on a DIFFERENT meter, so a spent Groq day is not a dead day.
    geminiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
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
// Trust, minus anyone explicitly withdrawn.
//
// UNTRUST exists because taking one name OFF the whitelist otherwise means
// rewriting the whole WHITELIST secret, and a secret is write-only — you
// cannot read the current list to edit it. `!!whitelist remove` mutates memory
// only, so a name removed that way is trusted again the moment the six-hourly
// restart lands, which is not what anybody means by "remove".
//
// A subtraction list needs no knowledge of what it subtracts from, and it is
// auditable: the reason someone lost trust is a name in one short variable.
const untrust = new Set(list(process.env.UNTRUST));
// The SEED. Once a trust channel answers, its access list replaces this — see
// trust.js. Until then, and forever if no channel is configured, this is the
// whitelist exactly as before.
const seedWhitelist = new Set(list(process.env.WHITELIST));
let whitelist = new Set([...seedWhitelist].filter((n) => !untrust.has(n)));

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
// Who is currently serving a de-voice, and until when: "chan|nick" -> epoch ms.
//
// Without this the punishment did not exist. deservesVoice() returns true for
// EVERYONE in a moderated room, and voiceSweep runs every 30 seconds, so the
// bot handed back the voice it had just taken — a two-minute sentence lasted
// at most thirty seconds. ChanServ compounds it: the access list carries
// `*!*@* +V`, so anyone who parts and rejoins is voiced again instantly.
// Punishment has to be state the bot HOLDS, not merely a mode it once set.
const serving = new Map();
const floodLog = new Map();        // nick(lower) -> [timestamps]
const repeatLog = new Map();       // nick(lower) -> { text, count }
const hostOf = new Map();          // nick(lower) -> user@host (for real bans)
const ignored = new Set();         // nick(lower) -> bot ignores them entirely
const opped = new Set();           // channel(lower) we currently hold +o in
const joinLog = new Map();         // channel(lower) -> [join timestamps] (raid detect)
const lockedByRaid = new Set();    // channels auto-locked, so we can auto-unlock
// Arrivals we had to act on, per channel. A raid of abusers is not
// characterised by VOLUME — this room was attacked by a steady drip that never
// came close to the burst threshold — but by how many of the arrivals turn out
// to be hostile. Counting that is what catches a slow raid.
const hostileJoins = new Map();
const members = new Map();         // channel(lower) -> Set(nick) for !!mass
const accountOf = new Map();       // nick(lower) -> NickServ account ('' = unregistered)
const prefixOf = new Map();        // "chan|nick" (lower) -> "@" / "+" / "" etc.
const nickVerdict = new Map();     // nick(lower) -> true/false (AI screened, cached)
const nickOffences = new Map();    // nick(lower) -> times removed for the nick itself
let aiCalls = [];                  // recent Groq call timestamps (rate limit)
// Calls spent today, and the UTC day they belong to. Groq meters per ACCOUNT
// per day and resets at UTC midnight, so the budget has to be counted the same
// way the provider counts it.
let aiDayCount = 0;
let geminiNoted = false;   // log the switch once, not per message
let aiDayKey = '';
let reconnectTimer = null;
let lastRx = Date.now();           // last byte received — drives the health check
// When the current connection attempt began. Covers the narrow case where TCP
// itself hangs before `onReady` runs — rare, but nothing else watches for it.
// NOT the cause of the 2026-08-25 outage: onReady clears `connecting` as soon
// as TCP connects, well before registration, so during a registration stall
// this flag is already false. See lastHealthy below for what actually happened.
let connectStartedAt = 0;
// When we last had a working connection. The pre-registration exit only covers
// a bot that has NEVER reached 001 — once it has, a permanently blocked address
// means scheduleReconnect() retries on a five-minute cap forever. The job stays
// alive with no bot attached and holds the workflow's concurrency slot shut
// against the run that would replace it. That is the two-hour outage of
// 2026-08-25: connected at 22:54, gone by 22:55, still "in_progress" at 01:14.
let lastHealthy = Date.now();
const DOWN_TOO_LONG_MS = parseInt(process.env.DOWN_EXIT_MIN || '12', 10) * 60000;
const CONNECT_DEADLINE_MS = 90000;
let pingProbeSent = false;
// Reset on EVERY connect, not once at process start. Dracula reconnects
// without restarting — a RecvQ drop mid-raid is routine — and a connectTime
// hours old made the +H backlog look newer than "when we connected", so
// isReplay() returned false and the whole replay was processed as live
// traffic. One rejoin produced nine flood warnings against somebody who had
// simply been chatting normally for the previous two minutes.
//
// The `ready` flag cannot cover this: it is set 2.5s after REGISTRATION,
// while the replay arrives on JOIN, which happens later. isReplay() is the
// only guard that actually sees the backlog.
let connectTime = Date.now();

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
// The SLOW-raid detector. The burst thresholds above look at join RATE, and
// the attack that prompted this never came close to them — roughly four joins
// in thirteen seconds, then a drip. What made it a raid was not how fast people
// arrived but how many of them had to be removed on arrival.
const hostileLimit = parseInt(process.env.RAID_HOSTILE_JOINS || '3', 10);
const hostileWindowMs = parseInt(process.env.RAID_HOSTILE_WINDOW_MIN || '5', 10) * 60000;
let raidGuard = onOff(process.env.RAID_GUARD || 'on');

// The game. `bot` is the small surface findit.js needs.
const bot = { send, say, notice, get nick() { return currentNick; } };
const game = new FindIt(bot);
// Off with RETORT=off; on by default, because a room that sees an abuser
// answered reads very differently from one that only sees a mod log line.
// Recognising the standby without services. He has no NickServ account by
// design, so the name proves nothing — anyone may type /nick Renfield, and this
// room is under attack by somebody who does exactly that for a living. He is
// challenged instead, and gets ops only if he can answer.
const handshake = new Handshake({
    secret: process.env.PEER_SECRET || '',
    prevSecret: process.env.PEER_SECRET_PREV || '',
    peers: (process.env.PEER_BOTS || 'Carmilla,Drusilla,Katerina').split(',').map((x) => x.trim()).filter(Boolean),
});
// Let a peer through our own CALLERID, but only once we can SEE them: an
// ACCEPT for a nick that is not online does not stick. Doing it at
// registration accepted nobody — the standbys had not connected yet — and
// their answers were refused coming back, silently, for five hours.
const acceptedPeers = new Set();
// Peers that have ALREADY proved themselves. Ops used to be granted once, in
// whatever rooms we happened to be opped in at that exact moment — so a standby
// that joined a second channel a beat later never got ops there, and nothing
// ever revisited the decision. Proof is remembered instead, and applied again
// on every later join and every time we gain ops ourselves.
const provenPeers = new Set();
// A failed challenge is announced once per nick per ten minutes. A standby
// stuck in a reconnect loop against a rotated key would otherwise repeat the
// same accusation every few seconds for as long as the split lasted.
const recentlyCalledOut = new Map();
setInterval(() => {
    const cutoff = Date.now() - 600000;
    for (const [n, at] of recentlyCalledOut) if (at < cutoff) recentlyCalledOut.delete(n);
}, 120000).unref?.();
function acceptPeer(nick) {
    const n = (nick || '').toLowerCase();
    if (!handshake.isCandidate(n) || acceptedPeers.has(n)) return;
    acceptedPeers.add(n);
    send(`ACCEPT +${nick}`);
}

const watch = new Watch({
    enabled: !/^(0|off|false|no)$/i.test(process.env.WATCH || 'on'),
    homes: config.channels,
});
const guardian = new Guardian({
    enabled: !/^(0|off|false|no)$/i.test(process.env.GUARDIAN || 'on'),
    minutes: parseInt(process.env.GUARDIAN_MINUTES || '10', 10),
});
const retort = new Retort({ enabled: !/^(0|off|false|no)$/i.test(process.env.RETORT || 'on') });
const fun = new Fun(bot, (c) => game.isGameChannel(c));
const recruiter = new Recruiter(bot, {
    membersOf: (c) => [...(members.get(chanKey(c)) || [])],
    prefixOf: (c, n) => prefixIn(c, n),
    get homeChannel() { return config.channels[0]; },
});
fun.enabled = onOff(process.env.FUN_ON || 'on');
// Master moderation switch, independent of the game.
let modEnabled = onOff(process.env.MOD_ENABLED || 'on');

/**
 * Cool mode: the deterministic layers work, the MODEL only watches.
 *
 * Default OFF, and that default is the point. Every removal that cost this
 * room a person today came from an AI verdict, not from the word list:
 *
 *   Lucifer   "Hum usko gayab kardenge"        threat  — Hindi idiom
 *   tulip     "kisi or ka head eat kro jaoo"   threat  — "go bother someone else"
 *   vergil    a welcome joke with a 😄         harassment
 *   Preeti24  "just friendships and bkchodi"   slur    — means idle chat
 *
 * Preeti24 was eleven minutes into her first visit. Each one was patched
 * afterwards, one phrase at a time, which is losing: the room speaks Hinglish
 * and the model reads it literally, so there will always be another phrase.
 *
 * So the model no longer acts unless a moderator says it should. What still
 * acts in cool mode, because none of it depends on interpretation:
 *   - the severe word list          (a slur is a slur)
 *   - solicitation and child safety (validated against real traffic)
 *   - raid guard, auto-ban masks, flood and repeat limits
 *   - every human-issued command
 *
 * The model keeps reading and keeps reporting to the mods. It simply stops
 * being the thing that removes people.
 */
let aiActive = onOff(process.env.AI_ACTIVE || 'off');
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
// The last few things WE said, so the room cannot feed them back to us.
//
// From today's log:
//   GirlInSpecs_ → kick (AI: threat of expulsion)
//   quote="You arrived to be removed"
// which is retort.js line 50, one of Dracula's own parting taunts. Somebody
// repeated it and the model read it as a threat by them. The bot writes
// deliberately cutting lines, so anything it says is exactly the sort of
// sentence its own moderator flags — a feedback loop where the room can get
// somebody removed by quoting the bot at it.
const ourLines = [];
function rememberSaid(msg) {
    ourLines.push(String(msg).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim());
    while (ourLines.length > 40) ourLines.shift();
}
/** Is this message just something we said, handed back to us? */
function isOurOwnWords(msg) {
    const flat = String(msg).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (flat.length < 12) return false;         // too short to be distinctive
    return ourLines.some((l) => l.length >= 12 && (l.includes(flat) || flat.includes(l)));
}

function say(chan, msg) { rememberSaid(msg); chunk(msg).forEach((c) => send(`PRIVMSG ${chan} :${c}`)); }
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
/**
 * Never moderated, whoever they are and whatever they do: us, the operators,
 * services, and other people's bots. Trust is NOT in here — a regular is
 * exempt from the ordinary ladder (see isExempt) but is still watched, because
 * standing you cannot lose is not standing, it is immunity.
 */
function isUntouchable(nick, chan) {
    const n = nick.toLowerCase();
    if (n === config.nick.toLowerCase() || isAdmin(nick)) return true;
    if (chan && isChannelMod(chan, nick)) return true;
    if (PROTECTED_NICKS.has(n)) return true;
    if (handshake.isCandidate(n)) return true;
    return false;
}

function isExempt(nick, chan) {
    const n = nick.toLowerCase();
    if (n === config.nick.toLowerCase() || isAdmin(nick)) return true;
    // Channel operators are the moderators — never police them.
    if (chan && isChannelMod(chan, nick)) return true;
    // Services and other people's bots. Policing a bot is not our job, its
    // operator's is, and an AI moderator reading a persona bot's roleplay as
    // harassment is entirely plausible — #batcave's Almond says things like
    // "mind your own biz, don't come between me and Navs" and "she will be
    // deleted??!!" in character. Kicking another operator's bot over its script
    // is embarrassing at best and how bot wars start at worst.
    if (PROTECTED_NICKS.has(n)) return true;
    // The standby bots, which live in PEER_BOTS rather than the bot list. Left
    // out, they got moderated like strangers: Carmilla answered "$$tr harami"
    // with the English word for it and was de-voiced by Dracula three seconds
    // later, in front of the room. A bot policing another bot is nobody's idea
    // of moderation, and the standby cannot argue back.
    if (handshake.isCandidate(n)) return true;
    // Whitelisted regulars are outside automated moderation entirely — owner's
    // call, 2026-08-22. They previously got a warning quota so that genuine
    // abuse from a trusted account was still caught; the trade now is that a
    // borrowed or compromised regular account cannot be stopped by the bot.
    // Human moderators still can: !!quiet, !!kick, !!ban and spoken orders all
    // work on anyone, and the whitelist is a short, hand-curated list.
    if (isTrusted(nick)) return true;
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
    const uh = hostOf.get(nick.toLowerCase());
    if (!uh) return false;
    const full = `${nick}!${uh}`;
    for (const m of trustedMasks) if (globToRe(m).test(full)) return true;
    // Masks stored in the trust channel count the same. This is the only way
    // somebody who has never registered a nick can be stored at all — ChanServ
    // keys on the account and they have none.
    for (const m of trust.masks) if (globToRe(m).test(full)) return true;
    return false;
}

/** Denied by a hostmask entry in the trust channel. */
function hostIsDenied(nick) {
    if (!trust.denyMasks.size) return false;
    const uh = hostOf.get(nick.toLowerCase());
    if (!uh) return false;
    const full = `${nick}!${uh}`;
    for (const m of trust.denyMasks) if (globToRe(m).test(full)) return true;
    return false;
}
/**
 * Whitelisted by nick, by services ACCOUNT, or by host mask.
 *
 * The account lookup is not optional. ChanServ has no key but the account, so
 * a trust channel stores `MinaL` for somebody who talks in the room as
 * `Nessie`, and `Vampire` for the owner, who talks as `Vikram`. The WHITELIST
 * secret was keyed by nick and worked; the moment the channel took over, every
 * regular whose nick differs from their account lost their standing — silently,
 * because losing an exemption looks exactly like never having had one.
 */
function isTrusted(nick) {
    const k = String(nick || '').toLowerCase();
    if (whitelist.has(k)) return true;
    const acct = accountOf.get(k);
    if (acct && whitelist.has(acct.toLowerCase())) return true;
    return hostIsTrusted(nick);
}

/** Has this person forfeited standing — under either their nick or account? */
function isForfeited(nick) {
    const k = String(nick || '').toLowerCase();
    if (untrust.has(k) || trust.isDenied(k)) return true;
    const acct = accountOf.get(k);
    if (acct && (untrust.has(acct.toLowerCase()) || trust.isDenied(acct))) return true;
    return hostIsDenied(nick);
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
/**
 * Why this person does or does not get voice — in words.
 *
 * Asked live: "sorry guys ishi and lord u guys didnt get auto voice? i had to
 * give voice to these two people when i joined in — why is that?" Both are
 * registered (ishi/ishi, LorD/EXTINCT), so the obvious answer was wrong, and
 * there was no way to find the real one: the decision was a boolean with four
 * separate ways to come out false and no record of which one fired.
 *
 * A refusal nobody can explain is the same silence that has cost this project
 * every hard bug. Now it says so, and !!info repeats it on demand.
 */
function voiceReason(nick, chan) {
    const until = serving.get(`${chanKey(chan)}|${nick.toLowerCase()}`);
    if (until && Date.now() < until) {
        return { ok: false, why: `serving a devoice for ${Math.ceil((until - Date.now()) / 60000)}m` };
    }
    if (watch.isFlagged(nick)) {
        return { ok: false, why: 'flagged by the watcher for advertising in another room' };
    }
    if (chan && moderatedRooms.has(chanKey(chan))) {
        return { ok: true, why: 'the room is moderated, so voice is the right to speak' };
    }
    if (isTrusted(nick)) return { ok: true, why: 'trusted' };
    const acct = accountOf.get(String(nick).toLowerCase());
    if (voiceRegistered && acct) return { ok: true, why: `registered as ${acct}` };
    if (voiceRegistered && !acct) {
        return { ok: false, why: 'I have not learned their services account yet '
            + '(no extended-join seen and no WHO reply) — a WHO fixes it' };
    }
    return { ok: false, why: 'not trusted, and voicing registered users is off' };
}

function deservesVoice(nick, chan) {
    // Where the room is +m, voice IS the right to speak, so everybody arriving
    // gets it — otherwise a newcomer joins into silence and never finds out
    // why. Elsewhere it stays a mark of standing.
    // Still serving a de-voice? Then no — not from the sweep, not on rejoin,
    // and not because ChanServ's autovoice already gave it back.
    const until = serving.get(`${chanKey(chan)}|${nick.toLowerCase()}`);
    if (until && Date.now() < until) return false;
    // Already known to have been advertising us elsewhere. Without this the
    // room watches the bot hand somebody voice and take it back one second
    // later — which is what it looked like live, and reads as the bot arguing
    // with itself rather than making a decision.
    if (watch.isFlagged(nick)) return false;
    if (chan && moderatedRooms.has(chanKey(chan))) return true;
    return isTrusted(nick) || (voiceRegistered && isRegistered(nick));
}

// A denial that repeats every 30 seconds must not log every 30 seconds. Say it
// once per person per room per hour — enough to find them, quiet enough to read.
const voiceGripe = new Map();
function noteVoiceDenial(nick, chan) {
    const k = `${chanKey(chan)}|${String(nick).toLowerCase()}`;
    if (Date.now() - (voiceGripe.get(k) || 0) < 3600000) return;
    voiceGripe.set(k, Date.now());
    log('MOD', `No voice for ${nick} in ${chan}: ${voiceReason(nick, chan).why}`);
}

/**
 * Does carrying +v actually mean anything in this room?
 *
 * Voice is a trust signal only when it is SELECTIVE. Both live rooms carry
 * `*!*@* +V` on the ChanServ access list, so services voice every arrival —
 * at which point "has voice" is true of everyone and distinguishes nobody.
 * Reading it as trust promoted the entire room, abusers included, to the tier
 * that is never punished. The moderation system was switched off by an access
 * list entry, silently, with every unit test still green.
 *
 * Self-tuning on purpose: if the blanket autovoice is ever removed in favour of
 * a real VOP list, voice becomes meaningful again and this starts trusting it
 * again, with no config to remember.
 */
function voiceIsSelective(chan) {
    const ch = chanKey(chan);
    const all = members.get(ch);
    if (!all || all.size < 4) return true;      // too few to judge; keep the old read
    let withPrefix = 0;
    for (const n of all) if (/[+~&@%]/.test(prefixIn(ch, n))) withPrefix += 1;
    return withPrefix / all.size < 0.6;
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
    if (/\+/.test(prefixIn(chan, nick)) && voiceIsSelective(chan)) return 'trusted';
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
/**
 * A nick built out of one of our regulars' names plus something filthy.
 *
 * This is the actual attack the room is under: somebody clones a known user's
 * name elsewhere and arrives wearing it — "NessieNangiBhabhi" is a regular's
 * nick with sexual words bolted on. Generic word screening catches the filth
 * but misses the point, which is that a specific person is being targeted, and
 * that the room reads the name before it reads anything else.
 *
 * Requires BOTH halves — a regular's name AND a filtered word — because a nick
 * merely containing a regular's name is usually that regular ("Nessie|away",
 * "Nessie_afk"). Demanding the pair keeps a nick change by the real person from
 * ever being read as an attack on themselves.
 *
 * @returns {{who:string, word:string}|null}
 */
function clonesARegular(nick) {
    const n = normalize(nick).replace(/\s+/g, '');
    if (!n) return null;
    const word = [...severeWords].find((w) => w && w.length >= 3 && n.includes(w))
        || [...badwords].find((w) => w && w.length >= 4 && n.includes(w));
    if (!word) return null;
    // The whitelist is not the list of people worth protecting from this. It is
    // the list of people with privileges, and most regulars are on neither.
    // NangiPoojaBhabhi was built out of a regular's name and a filtered word and
    // went unrecognised for exactly that reason. Anyone actually seen speaking
    // here recently counts as a regular for this purpose.
    const regulars = new Set([...whitelist]);
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const [k, at] of Object.entries(seenUsers)) if (at > cutoff) regulars.add(k);
    for (const who of regulars) {
        // Short names would match half the room by accident.
        if (!who || who.length < 4) continue;
        if (n === who) continue;                  // that IS them
        if (n.includes(who)) return { who, word };
    }
    return null;
}

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
    if (t === currentNick.toLowerCase() || PROTECTED_NICKS.has(t)) {
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

/**
 * Shut the doors for a while. Idempotent — a second raid signal while already
 * locked extends nothing and says nothing, rather than stacking timers.
 *
 * NOTE: this is refused outright by services if the channel's MLOCK carries
 * `-i`, which is how #batcave was configured during the raid that prompted
 * this. ChanServ reverts the mode within a second and the bot has no way to
 * know, so the lock silently does nothing. Check `ChanServ INFO <#chan>` before
 * trusting it: the mode lock must not forbid `i`.
 */
function lockDoors(chan, why) {
    const c = chanKey(chan);
    if (lockedByRaid.has(c)) return;
    lockedByRaid.add(c);
    send(`MODE ${chan} +i`);
    say(chan, `\x0304[MOD]\x03 ${why} — invite-only for ${raidLockSec}s while this passes. 🦇`);
    log('MOD', `Raid lock on ${c}: ${why}`);
    setTimeout(() => {
        lockedByRaid.delete(c);
        hostileJoins.set(c, []);
        send(`MODE ${chan} -i`);
        say(chan, '\x0309[MOD]\x03 Doors open again.');
    }, raidLockSec * 1000);
}

/**
 * Someone who arrived and had to be removed. Enough of those in a few minutes
 * is a raid however slowly they trickle in — which is the shape this room was
 * actually attacked in, and the shape a join-rate threshold cannot see.
 */
function noteHostileArrival(chan, why) {
    const c = chanKey(chan);
    const now = Date.now();
    const hist = (hostileJoins.get(c) || []).filter((t) => now - t < hostileWindowMs);
    hist.push(now);
    hostileJoins.set(c, hist);
    if (hist.length >= hostileLimit) lockDoors(chan, `${hist.length} hostile arrivals in ${Math.round(hostileWindowMs / 60000)}m`);
}

// Trust, held somewhere it can actually be edited. See trust.js.
const trust = new TrustList({
    channel: (process.env.TRUST_CHANNEL || '').trim(),
    flag: (process.env.TRUST_FLAG || 'V').replace(/[^A-Za-z]/g, '') || 'V',
    self: config.nsAccount || '',
    send: (l) => send(l),
    log,
});

// A refusal is worth saying ONCE, not once per name in a seed of thirty.
let lastTrustGripe = 0;
function reportTrustRefusal(line) {
    const why = trust.writeRefused(line);
    if (!why) return;
    log('WARN', why.replace(/\x02/g, ''));
    if (Date.now() - lastTrustGripe < 60000) return;
    lastTrustGripe = Date.now();
    for (const o of config.owners) notice(o, `\x0304[TRUST]\x03 ${why}`);
}

/**
 * How should this person be written into the trust channel?
 *
 * ChanServ keys on the services ACCOUNT and nothing else, so a regular who
 * never registered a nick cannot be stored under their name at all — which is
 * why a 73-name whitelist became 18 entries. It DOES accept a hostmask
 * (verified live: "Flags +V were set on Carmilla!*@*"), and that is the only
 * way to store the rest.
 *
 * Preference order, strongest identity first:
 *   1. their account          — cannot be impersonated
 *   2. *!*@their host         — survives a nick change, but a shared ISP cloak
 *                               covers more people than you meant
 *   3. nick!*@*               — last resort: an UNREGISTERED nick is free for
 *                               anyone to take, so this trusts whoever takes it
 *
 * @returns {{key:string, how:string, weak:boolean}}
 */
function trustKeyFor(nick) {
    const k = String(nick || '').toLowerCase();
    const acct = accountOf.get(k);
    if (acct) return { key: acct, how: `account ${acct}`, weak: false };
    // NOT a mask. We only know accounts for people we have SEEN; ChanServ
    // knows them for everybody, and resolves a nick to its account by itself —
    // that is how `Nessie` was stored as `MinaL`. Guessing a mask because WE
    // are ignorant would write a weak entry for somebody perfectly registered
    // who simply happens to be offline. Send the name and let ChanServ answer.
    return { key: nick, how: `name ${nick} (ChanServ resolves it to an account)`, weak: false };
}

/**
 * The fallback for somebody ChanServ genuinely cannot store: a hostmask.
 *
 * Only reached after ChanServ has actually refused the name, never on a guess.
 * A mask is not an identity — an unregistered nick is free for anyone to take,
 * so this trusts whoever takes it — which is why it is a second pass with the
 * owner told what happened, rather than a silent default.
 */
function maskKeyFor(nick) {
    const uh = hostOf.get(String(nick || '').toLowerCase());
    const host = uh && uh.includes('@') ? uh.split('@')[1] : '';
    return host
        ? { key: `*!*@${host}`, how: `*!*@${host} (their host)` }
        : { key: `${nick}!*@*`, how: `${nick}!*@* (nick only — anyone may take it)` };
}

/** Recompute the effective whitelist after anything changes. */
function refreshTrust() {
    whitelist = effective(trust, seedWhitelist, untrust);
    relayTrust();
}

/**
 * Pass the trust list to the standbys, signed.
 *
 * They have no services account — deliberately, because an unregistered nick
 * is what lets a spare stand in for a name already taken — so ChanServ will
 * not show them the list at all. Verified: an unidentified client asking gets
 * "You are not authorized to perform this operation." Without this they fall
 * back to their own WHITELIST secret, a second copy of the truth that drifts
 * from this one the moment either is edited.
 *
 * Only to peers that have PROVEN themselves. Sending the list to whoever
 * currently holds a standby's nick would hand an impostor the answer to "who
 * may I not moderate" — and those nicks are unregistered precisely so that
 * anyone can take them.
 */
let lastRelay = 0;
function relayTrust(force = false) {
    if (!process.env.PEER_SECRET || !provenPeers.size) return;
    if (!force && Date.now() - lastRelay < 20000) return;   // not once per name during a seed
    lastRelay = Date.now();
    const lines = pack(process.env.PEER_SECRET, {
        trusted: whitelist,
        denied: new Set([...untrust, ...trust.deniedList()]),
        masks: trust.masks,
        denyMasks: trust.denyMasks,
    });
    for (const peer of provenPeers) for (const l of lines) send(`NOTICE ${peer} :${l}`);
    log('OK', `Trust list relayed to ${provenPeers.size} peer(s): ${whitelist.size} trusted, `
        + `${trust.masks.size} by mask, in ${lines.length} piece(s).`);
}

// What people have actually been doing. See reputation.js for why earning
// leans on the services account rather than on anything this process counted.
const reputation = new Reputation({
    minAccountDays: Number(process.env.TRUST_EARN_DAYS || 30),
    minMessages: Number(process.env.TRUST_EARN_MESSAGES || 40),
    maxStrikes: Number(process.env.TRUST_LOSE_STRIKES || 3),
});
const autoTrust = onOff(process.env.AUTO_TRUST || 'on');
const promoted = new Set();     // announced once, not once per message

// When each account was registered, as NickServ reports it. This is the one
// fact that cannot be rushed: a process that restarts every forty minutes has
// no way to know somebody has behaved for a month, but the network does.
const registeredAt = new Map();
const askedRegistration = new Set();

/**
 * Ask NickServ how old an account is — once per nick per run.
 *
 * Only for people who might actually be promoted, because this is a services
 * round trip and asking about everybody who speaks would be a flood.
 */
function askRegistration(nick) {
    const k = nick.toLowerCase();
    if (askedRegistration.has(k) || registeredAt.has(k)) return;
    if (!accountOf.get(k)) return;                 // unregistered: nothing to ask
    askedRegistration.add(k);
    send(`PRIVMSG NickServ :INFO ${nick}`);
}

/**
 * Read NickServ's reply.
 *
 *   Information on Vikram (account Vikram):
 *   Registered : Aug 14 03:22:08 2026 (1 week, 5 days, 04:11:22 ago)
 *
 * The nick is remembered from the "Information on" line, because the
 * "Registered" line that follows does not repeat it.
 */
let nickInfoFor = '';
function readNickInfo(text) {
    const who = text.match(/Information on\s+(\S+)/i);
    if (who) { nickInfoFor = who[1].toLowerCase(); return; }
    if (!nickInfoFor) return;
    const reg = text.match(/Registered\s*:\s*([A-Za-z]{3}\s+\d{1,2}\s+[\d:]+\s+\d{4})/i);
    if (!reg) return;
    const at = Date.parse(`${reg[1]} UTC`);
    if (Number.isFinite(at)) {
        registeredAt.set(nickInfoFor, at);
        log('INFO', `${nickInfoFor} registered ${new Date(at).toISOString().slice(0, 10)}.`);
    }
    nickInfoFor = '';
}

/**
 * Take somebody's standing away for what they just did.
 *
 * Immediate and permanent-ish: it writes to the trust channel when one is
 * configured, so it survives the restart that lands within the hour. Without
 * that it can only hold for this run, and says so — a punishment that quietly
 * expires in forty minutes is worse than none, because everyone assumes it
 * stuck.
 */
function loseTrust(nick, what, chan) {
    if (!autoTrust) return;
    const reason = reputation.forfeits(nick, what);
    if (!reason) return;
    const k = nick.toLowerCase();
    if (!whitelist.has(k)) return;               // nothing to take

    if (trust.enabled && trust.loaded) {
        // deny(), not remove(). Somebody who lost standing for abuse should
        // stay on record — otherwise the auto-promotion in gainTrust() can
        // quietly hand it back a month later, having forgotten why it was
        // taken away.
        trust.deny(nick);
        refreshTrust();
    } else {
        whitelist.delete(k);
    }
    log('MOD', `Trust withdrawn from ${nick}: ${reason}`);
    for (const m of channelMods()) {
        notice(m, `\x0304[TRUST]\x03 \x02${nick}\x02 is no longer a trusted regular — ${reason}. `
            + (trust.enabled && trust.loaded
                ? `Stored on ${trust.channel}. \x02!!trust add ${nick}\x02 to undo.`
                : 'THIS RUN ONLY — set TRUST_CHANNEL to make it stick.'));
    }
}

/** Give somebody standing for having earned it, and say why. */
function gainTrust(nick, chan) {
    if (!autoTrust || !trust.enabled || !trust.loaded) return;
    const k = nick.toLowerCase();
    if (whitelist.has(k) || promoted.has(k) || isExempt(nick, chan)) return;
    // The deny list is a memory, and this is what it is for: without it,
    // somebody who lost trust for a slur is eligible again the moment their
    // account is old enough and they have said forty quiet things.
    if (isForfeited(nick)) return;
    const why = reputation.earns(nick, {
        account: accountOf.get(k) || '',
        registeredAt: registeredAt.get(k) || 0,
    });
    if (!why) return;
    promoted.add(k);
    // Deliberately the ACCOUNT, never a mask. reputation.earns() already
    // requires a registered account, and a mask is not an identity — auto
    // promotion writing `nick!*@*` would hand standing to whoever next takes
    // an unregistered nick, without a human ever seeing it happen. The mask
    // fallback belongs to the commands a person types.
    trust.add(accountOf.get(k) || nick);
    refreshTrust();
    log('MOD', `Trust granted to ${nick}: ${why}`);
    for (const m of channelMods()) {
        notice(m, `\x0306[TRUST]\x03 \x02${nick}\x02 is now a trusted regular — ${why}. `
            + `\x02!!trust del ${nick}\x02 if you disagree.`);
    }
}

// Two regulars going at each other. See feud.js for why this judges the SHAPE
// of an exchange rather than the words in it.
const feuds = new Feuds({
    devoiceMin: Number(process.env.FEUD_DEVOICE_MIN || 2),
    instigatorBonus: Number(process.env.FEUD_INSTIGATOR_BONUS || 3),
});

/**
 * Watch for a fight, and answer it the way the owner asked: a private word
 * first, and only then a visible one — with whoever started it serving longer.
 *
 * This deliberately DOES act on whitelisted regulars, which the ordinary ladder
 * never does. The exemption exists so a regular is not silenced mid-joke; it
 * was never meant to make two of them untouchable while the room watches them
 * tear into each other.
 */
function watchForFeud(chan, nick, message) {
    // isUntouchable, NOT isExempt. The exemption covers trusted regulars, and
    // two trusted regulars tearing into each other is precisely the case this
    // was written for — guarding it with isExempt made the whole thing inert
    // for the only people it was meant to catch.
    if (isUntouchable(nick, chan) || moderationOff(chan)) return false;
    const here = members.get(chanKey(chan)) || new Set();
    const isPresent = (n) => [...here].some((m) => m.toLowerCase() === n.toLowerCase());
    const target = aimedAt(message, isPresent);
    if (!target) return false;

    const sev = severityOf(message, { severe: severeWords, heavy: badwords });
    const verdict = feuds.see(chan, nick, message, { severity: sev, target });
    if (!verdict) return false;

    if (verdict.action === 'nudge') {
        // Privately, and to BOTH. Naming one of them in the room would pick a
        // side in front of an audience, which is the thing that turns an
        // argument into a grudge.
        for (const who of [verdict.a, verdict.b]) {
            notice(who, `\x0304[MOD]\x03 You and \x02${who === verdict.a ? verdict.b : verdict.a}\x02 `
                + 'are going at each other in front of the room. Take it to DM. '
                + 'Nothing has been done to either of you yet.');
        }
        log('MOD', `Feud nudge in ${chan}: ${verdict.a} vs ${verdict.b}`);
        return true;
    }

    // The one who STARTED it loses standing as well as voice. The one who
    // answered does not — being provoked is not an offence, and treating it as
    // one is how a room learns that defending yourself costs the same as
    // attacking somebody.
    loseTrust(verdict.instigator, 'feud', chan);

    // They carried on. Both lose voice; the instigator for longer, because
    // punishing the provoked exactly as hard as the provoker is unfair in a way
    // the room can see.
    for (const [who, mins] of [[verdict.instigator, verdict.instigatorMin],
                               [verdict.other, verdict.otherMin]]) {
        const key = `${chanKey(chan)}|${who.toLowerCase()}`;
        serving.set(key, Date.now() + mins * 60000);
        if (opped.has(chanKey(chan))) send(`MODE ${chan} -v ${who}`);
        notice(who, `\x0304[MOD]\x03 Voice off for ${mins} minutes. `
            + (who === verdict.instigator
                ? 'Longer, because you started it.'
                : 'Shorter, because you answered rather than started it.'));
        setTimeout(() => {
            serving.delete(key);
            if (opped.has(chanKey(chan)) && (members.get(chanKey(chan)) || new Set()).has(who)) {
                send(`MODE ${chan} +v ${who}`);
            }
        }, mins * 60000);
    }
    // The room is told only that it is over, and neither name is used.
    say(chan, '\x0306[MOD]\x03 That is enough — two of you are quiet for a few minutes. 🦇');
    log('MOD', `Feud devoice in ${chan}: ${verdict.instigator} ${verdict.instigatorMin}m, `
        + `${verdict.other} ${verdict.otherMin}m`);
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
            const key = `${chanKey(chan)}|${k}`;
            serving.set(key, Date.now() + devoiceMinutes * 60000);
            send(`MODE ${chan} -v ${nick}`);
            say(chan, `\x0304[MOD]\x03 ${nick} — ${reason}. Voice back in ${devoiceMinutes}m. `
                + `(${n}/${quota})`);
            setTimeout(() => {
                serving.delete(key);
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
// Who the AI has already given one chance to, and when. Deliberately NOT
// actedRecently(), whose window is ten seconds — long enough to stop a double
// action on one message and far too short to mean "we already warned them".
// With that, a second offence a minute later reads as a first offence and the
// ladder never climbs.
const aiWarned = new Map();
const AI_WARN_MEMORY_MS = 30 * 60000;
function aiWarnedRecently(nick) {
    const at = aiWarned.get(nick.toLowerCase()) || 0;
    return Date.now() - at < AI_WARN_MEMORY_MS;
}
setInterval(() => {
    const cutoff = Date.now() - AI_WARN_MEMORY_MS;
    for (const [n, at] of aiWarned) if (at < cutoff) aiWarned.delete(n);
}, 5 * 60000).unref?.();

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

/**
 * If this abuse was aimed at one of ours, arm them.
 *
 * The bot's own punishment still happens — this is an EXTRA layer, not a
 * substitute. Being abused and being powerless are separate injuries and the
 * ladder only ever addressed the first.
 */
function guardVictim(chan, attacker, message) {
    const ch = chanKey(chan);
    if (!opped.has(ch)) return;                      // nothing to give
    const here = members.get(ch) || new Set();
    const victim = victimOf(message, attacker, here, isTrusted);
    if (!victim) return;
    const why = guardian.refuse(ch, victim, tierOf(chan, attacker), /[~&@%]/.test(prefixIn(ch, victim)));
    if (why) return;

    guardian.grant(ch, victim);
    send(`MODE ${chan} +o ${victim}`);
    say(chan, `\x0309[GUARD]\x03 ${victim} — you are being targeted, so you have ops for `
        + `${guardian.minutes}m. Deal with ${attacker} however you see fit. 🦇`);
    log('MOD', `Guardian: opped ${victim} in ${chan} (targeted by ${attacker}).`);

    setTimeout(() => endGuard(chan, victim), guardian.minutes * 60000);
}

/** Take back a temporary grant. Safe to call twice; does nothing the second time. */
function endGuard(chan, victim) {
    const ch = chanKey(chan);
    if (!guardian.owes(ch, victim)) return;          // already taken back
    guardian.release(ch, victim);
    // Only take back what we gave, and only from someone still here.
    if ([...(members.get(ch) || [])].some((m) => m.toLowerCase() === victim.toLowerCase())) {
        send(`MODE ${chan} -o ${victim}`);
        notice(victim, `Your temporary ops in ${chan} have expired.`);
    }
    log('MOD', `Guardian: took ops back from ${victim} in ${chan}.`);
}

// A single setTimeout is not a promise. It dies with the process — and this one
// restarts every six hours — and a handler that throws takes the de-op with it.
// The sweep is the thing that actually guarantees the grant ends, so a missed
// timer costs a few seconds rather than leaving someone opped for good.
setInterval(() => {
    for (const [ch, nick] of guardian.due()) endGuard(ch, nick);
}, 20000);

// The room should see an abuser answered, not just processed. Spoken BEFORE the
// KICK so it is the last thing said while they are still present to read it.
/**
 * The parting line, and when it must stay unsaid.
 *
 * NOT on an AI verdict. The AI is a judgement call and it gets them wrong:
 * "Hum usko gayab kardenge" — a Hindi idiom for offering to deal with someone
 * bothering a friend, said protectively — was read as a threat and one of the
 * room's three most active regulars was kicked, then told "You had one job
 * here — be tolerable — and you fumbled it immediately." He rejoined, was
 * answered in corporate English, and left.
 *
 * A wrong removal is recoverable; being mocked on the way out is what makes
 * somebody not come back. A deterministic verdict — a slur from the word
 * list, a flood — is certain enough to earn a parting line. A model's opinion
 * is not.
 */
function retortBefore(chan, nick, reason, fromAI = false) {
    if (fromAI) return;
    const line = retort.lineFor(nick, reason, tierOf(chan, nick));
    if (line) say(chan, `${nick}: ${line}`);
}

function kickUser(chan, nick, reason, fromAI = false) {
    if (actedRecently(chan, nick, 'kick')) return;
    markActioned(chan, nick, 'kick');
    if (!requireOps(chan, `kick ${nick}`)) return;
    retortBefore(chan, nick, reason, fromAI);
    send(`KICK ${chan} ${nick} :${reason}`);
    // "Banished" is what a BAN is. Saying it for a kick told the room somebody
    // was gone for good when they could have walked straight back in —
    // observed live: one regular asked "how can he re enter", another
    // concluded the bot had banned their friend and took them to a different
    // room over it. The person kicked cannot see this line at all, so it is
    // written for the people who stayed.
    say(chan, `\x0304[MOD]\x03 ${nick} removed — ${reason}. They can rejoin. 🦇`);
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
    retortBefore(chan, nick, reason);
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
    // Severe language is checked for EVERYONE who is not an operator — trusted
    // regulars included. They used to be waved through before this line, which
    // meant a slur from a regular was not merely unpunished but INVISIBLE: no
    // log, no notice, and no way for standing to follow behaviour because the
    // behaviour was never seen. Losing trust is the response; the ordinary
    // ladder below then applies to them like anybody else, because by that
    // point they are no longer trusted.
    if (!isUntouchable(nick, chan) && wordHit(severeWords, message)) {
        loseTrust(nick, 'severe', chan);
    }

    // Solicitation, which the word list cannot see. Learned from the rooms the
    // recruiter invites from, where one message in five is an advert and
    // almost none of it contains a swear word. See solicit.js.
    const sol = solicits(message);
    if (sol.level === 'child' && !isUntouchable(nick, chan)) {
        // Checked BEFORE the trusted exemption, like severe language. There is
        // no standing in this room that makes soliciting around children a
        // matter for a warning.
        loseTrust(nick, 'severe', chan);
        banUser(chan, nick, 'soliciting, referring to minors');
        for (const m of channelMods()) {
            notice(m, `\x0304[ALERT]\x03 \x02${nick}\x02 banned — solicitation referring to `
                + `minors: "${String(message).slice(0, 80)}"`);
        }
        return true;
    }

    if (isExempt(nick, chan)) return false;

    if (sol.level === 'solicit') {
        // Advertising, not conversation. Removed rather than warned: nobody
        // posts a rate card by accident, and the ladder exists for people who
        // might have been joking.
        log('MOD', `Solicitation from ${nick}: ${sol.why.join(', ')} — "${message.slice(0, 60)}"`);
        kickUser(chan, nick, `advertising (${sol.why.slice(0, 2).join(', ')})`);
        return true;
    }

    // Severe language is always actioned — including inside a game. Switching
    // moderation off is about avoiding accidental kicks, not tolerating slurs.
    const severe = wordHit(severeWords, message);
    if (severe) { banUser(chan, nick, 'severe language'); return true; }

    if (moderationOff(chan)) return false;

    // "stupid" and "idiot" are on the filter list and are NOT abuse in this
    // room — people were being warned for the way their friends talk to them.
    // A single light word is left alone entirely; three of them at once is
    // still a pile-on and falls through to the count below.
    const sev = severityOf(message, { severe: severeWords, heavy: badwords });
    if (sev === 'light') return false;

    // Count DISTINCT filtered words. One swear is someone being rude; a message
    // carrying several is a tirade, and treating it as "watch your language"
    // under-reacts badly — that is what happened to a threat-laden wall of abuse
    // which earned a kick when it warranted a ban.
    const hits = distinctHits(badwords, message);
    if (hits.length >= 3) {
        banUser(chan, nick, `sustained abuse (${hits.length} slurs in one message)`);
        return true;
    }
    if (hits.length) {
        reputation.offended(nick);
        loseTrust(nick, 'strikes', chan);
        warnUser(chan, nick, 'watch your language');
        return true;
    }

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
/**
 * May we spend a Groq call right now?
 *
 * Two limits, because they fail differently. The per-minute one stops a burst
 * from tripping Groq's rate limiter. The DAILY one is the important one and did
 * not exist: at 20 calls a minute, with a system prompt of roughly 500 tokens
 * sent on every message, a free-tier day's token allowance is gone in well
 * under an hour — after which moderation is dead until UTC midnight and the
 * room spends 23 hours uncovered. The alert reported this as "key rejected",
 * which sent the owner looking for a broken key that was never broken.
 *
 * Spending the budget slowly is strictly better than spending it early: the
 * word filter covers the ordinary cases either way, and what the AI is FOR is
 * the serious thing that might arrive at any hour.
 */
function aiRateOk() {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);   // UTC, as Groq resets
    if (day !== aiDayKey) { aiDayKey = day; aiDayCount = 0; }
    if (aiDayCount >= config.aiMaxPerDay) return false;
    aiCalls = aiCalls.filter((t) => now - t < 60000);
    if (aiCalls.length >= config.aiMaxPerMin) return false;
    aiCalls.push(now);
    aiDayCount += 1;
    return true;
}

/** For !!status — how much of today's allowance is left. */
function aiBudgetLeft() {
    const day = new Date().toISOString().slice(0, 10);
    const used = day === aiDayKey ? aiDayCount : 0;
    return `${Math.max(0, config.aiMaxPerDay - used)}/${config.aiMaxPerDay} left today`;
}
// One place that talks to Groq, so both callers get key failover for free.
// gpt-oss and qwen3 are REASONING models: they spend tokens on an internal
// "reasoning" field first and leave `content` empty until that finishes. With a
// small max_tokens they hit the cap mid-thought and return "" — which would have
// made the fallback model silently produce nothing. max_tokens is a ceiling, not
// a spend, so raising it costs the non-reasoning primary nothing.
const REASONING_MIN_TOKENS = 320;
function needsRoomToThink(model) { return /gpt-oss|qwen3|reason/i.test(model || ''); }

// The actual fix, measured against the live API rather than guessed at.
//
// These models think before they answer, and on a hard prompt they think
// FOREVER: the moderation call returned empty at 320 tokens, at 800, at 1200
// and at 1600 — every one of them finish_reason=length, the whole budget spent
// reasoning with nothing emitted. Raising max_tokens does not fix it, it just
// costs more before failing.
//
// reasoning_effort:"low" answers the same prompt in 73 tokens. Without it, a
// call like the moderation one below — max_tokens 80 — could never have
// returned anything at all, which is why "AI healthy" and "the model returned
// nothing" were both true at once.
const REASONING_EFFORT = process.env.GROQ_REASONING_EFFORT || 'low';

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
                        ...(needsRoomToThink(model) ? { reasoning_effort: REASONING_EFFORT } : {}),
                    }),
                });
                // Both mean "try the other key", but they are NOT the same
                // problem and reporting them identically sent the owner hunting
                // for a bad key when the account had simply run out of quota.
                //
                // Worth knowing when the alert fires: Groq meters per ACCOUNT,
                // not per key. A second key from the same account shares the
                // same allowance, so two keys 429-ing together is the expected
                // shape of "the daily limit is gone", not two broken keys.
                if (res.status === 401 || res.status === 403) {
                    lastErr = new Error(`key rejected (${res.status}) — bad or revoked key`);
                    if (keys.length > 1) continue;
                }
                if (res.status === 429) {
                    lastErr = new Error('rate limited (429) — account quota, not a bad key');
                    if (keys.length > 1) continue;
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
    // Groq is spent or broken. Try the other meter before giving up: a 429 here
    // means the ACCOUNT's day is gone, and no amount of retrying Groq fixes that.
    if (config.geminiKey) {
        try {
            const out = await geminiChat(body, config.geminiKey, config.geminiModel);
            if (out) {
                if (!geminiNoted) { geminiNoted = true; log('AI', `Groq unavailable (${lastErr && lastErr.message}) — serving from Gemini.`); }
                return out;
            }
        } catch (e) { lastErr = e; }
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
                        + 'and "bakchodi"/"bkchodi" simply means idle chat, "bakwas" means '
                        + 'nonsense, "timepass" and "faltu" are ordinary words. None of those '
                        + 'is a slur, whatever they look like. '
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

        // Gate 0b — we are not going to remove somebody for quoting us.
        if (isOurOwnWords(message)) {
            log('AI', `Ignoring ${action} on ${nick}: that is our own line quoted back.`);
            return;
        }

        // Gate 1 — the model must be sure. A hedged verdict is banter.
        if (verdict.confident !== true) {
            log('AI', `Flagged ${nick} (${action}) without confidence — leaving it.`);
            return;
        }
        // Gate 2 — it must point AT the abuse, and the quote must really be in
        // the message. A model that cannot quote what it is punishing is
        // inventing it: that is how a friendly ":D" was read as harassment and
        // a trusted regular got thrown out mid-joke.
        // An ELLIPSIS means the model quoted two fragments of one message, and
        // both halves have to be checked separately or genuine abuse is thrown
        // away on punctuation. It happened, on the worst message of the day:
        //
        //   Flagged Nayan_M41 (kick) but quoted
        //   "Iski Gashti Maa ko pelte hai ... Nude fingering"
        //   which is not in the message — ignoring.
        //
        // Both halves were in it. The joined string was not, so the check
        // failed and the bot did nothing; the owner banned by hand two minutes
        // later. Every other failure today was the model punishing a joke —
        // this is the opposite one, and it is the more expensive kind.
        const flatMsg = flatten(message);
        const parts = String(verdict.quote || '').split(/\s*(?:\.{2,}|…)\s*/)
            .map((q) => flatten(q)).filter((q) => q.length >= 3);
        const quote = flatten(verdict.quote || '');
        const quoted = parts.length > 1
            ? parts.every((q) => flatMsg.includes(q))
            : Boolean(quote) && flatMsg.includes(quote);
        if (!quoted) {
            log('AI', `Flagged ${nick} (${action}) but quoted "${verdict.quote || ''}" `
                + `which is not in the message — ignoring.`);
            return;
        }

        const reason = `AI: ${String(verdict.reason || 'abuse').slice(0, 40)}`;
        const tier = tierOf(chan, nick);
        // Arm the target, if the target is one of ours. Placed here rather than
        // beside each punishment below because every path from this point ends
        // in an action, and the shield should not depend on WHICH one.
        guardVictim(chan, nick, message);
        log('AI', `${nick} [${tier}] → ${action} (${reason}) quote="${verdict.quote}"`);

        // Gate 3 — the model's evidence must be more than the name of the
        // offence. This is the exact shape of the live false positive.
        if (quoteNamesTheProblem(verdict.quote || '')) {
            log('AI', `Ignoring ${action} on ${nick}: quoted "${verdict.quote}", which names abuse rather than being it.`);
            return;
        }

        // Gate 3b — the evidence is ordinary Hinglish that reads vulgar.
        //
        // "bkchodi" means idle chat. A newcomer said "just friendships and
        // bkchodi" in her first two minutes here and was kicked for a SLUR,
        // while the owner — exempt — was typing "we like doing bkchodi" in the
        // same conversation. A regular said what everyone saw: "Gyi ab nahi
        // aaye gyi vo", she's gone, she won't come back. The recruiter had
        // brought her in eleven minutes earlier.
        //
        // Checked against the QUOTE, not the message, so a real slur sitting
        // beside an ordinary word still counts.
        if (isBenignHinglish(verdict.quote || '')) {
            log('AI', `Ignoring ${action} on ${nick}: quoted "${verdict.quote}", `
                + 'which is ordinary Hinglish here.');
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

        // Gate 4b — an OPINION about a group is the category this model gets
        // wrong most often, and the one where being wrong is most visible.
        // Observed live: somebody generalising about how Indians argue was
        // removed on a first offence, in a room of Indians who read it as
        // commentary rather than hate — one of them left with him. Threats,
        // sexual harassment and doxxing are unambiguous and still act at once.
        // Everything else gets the room's own ladder: a warning first, and
        // removal only if they do it again.
        // Gate 4c — the "unambiguous" categories are where the model's worst
        // mistakes land, because they are the ones that act at once.
        //
        // Both live failures were here. "Hum usko gayab kardenge" is Hindi for
        // offering to make somebody's problem disappear, said protectively
        // about a friend; read as a THREAT, it kicked one of the room's three
        // most active regulars. Shayari — "mujhe apna haath bhi chu gyaa" —
        // read as SEXUAL harassment, devoiced a whitelisted regular mid-verse.
        //
        // Two conditions, both cheap and both deterministic:
        //   - the room's own affectionate hostility is never an offence
        //   - a threat or harassment is DIRECTED. If the model cannot point at
        //     somebody in the room, what it is reading is very likely idiom.
        if (isBanter(message)) {
            log('AI', `Ignoring ${action} on ${nick}: reads as this room's banter.`);
            return;
        }
        // Laughing while saying it. Only for the categories that turn on
        // INTENT — a joke and an attack use the same words there. It does
        // nothing for slurs, sexual content or doxxing, which are the same act
        // whether or not the speaker found them funny.
        const intentBased = /harass|threat|insult|hate|rude|toxic/i.test(String(verdict.reason || ''))
            && !/slur|sexual|doxx/i.test(String(verdict.reason || ''));
        if (intentBased && hasLaughter(message)) {
            log('AI', `Ignoring ${action} on ${nick}: they were laughing (${verdict.reason}).`);
            return;
        }
        const directed = /threat|harass/i.test(String(verdict.reason || ''))
            ? aimedAt(message, (n) => [...(members.get(chanKey(chan)) || new Set())]
                .some((m) => m.toLowerCase() === n.toLowerCase()))
            : true;
        if (!directed) {
            log('AI', `Ignoring ${action} on ${nick}: a ${verdict.reason} aimed at nobody present.`);
            return;
        }

        // THREAT is no longer "act at once", and that is a considered change.
        //
        // Three removals in one day, all of them Hinglish figures of speech
        // the model read literally:
        //   "Hum usko gayab kardenge"          — offering to sort out a friend's problem
        //   "I will kill u johnny" 🤣          — two friends joking
        //   "kisi or ka head eat kro jaoo"     — "go bother someone else"
        // The last one cost a user: "mai nhi aane wali ab yaha 😭". A regular
        // in the room asked directly, "can you be easier on these people for
        // devoicing and kicking because every small things are detected as
        // threat?" — and he is right.
        //
        // In a room that argues in Hinglish, figurative violence is ordinary
        // speech, so "threat" is the category this model is WORST at, not
        // best. It now takes the ordinary ladder: a warning first, removal if
        // they do it again. A real threat repeated is still caught; an idiom
        // now costs a warning instead of a person.
        //
        // The exception is a threat with something CONCRETE in it — a place, a
        // time, personal details, or coming to find someone. Nobody says those
        // as a figure of speech, and the cost of being slow there is real.
        const CREDIBLE = /\b(i know where (you|u) live|your address|come to your (house|home|place)|find (you|u) and|leak (your|ur) (photos|pics|nudes)|post (your|ur) (address|number)|doxx?)\b/i;
        const reasonText = String(verdict.reason || '');
        const unambiguous = /sexual|doxx|slur/i.test(reasonText)
            || (/threat/i.test(reasonText) && CREDIBLE.test(message));
        if (!unambiguous && action !== 'warn' && !aiWarnedRecently(nick)) {
            aiWarned.set(nick.toLowerCase(), Date.now());
            log('MOD', `AI wanted to ${action} ${nick} on a first ${verdict.reason} — warning instead.`);
            warnUser(chan, nick, reason);
            return;
        }

        // Gate 0 of the acting half — cool mode. Everything above still runs,
        // so the mods get the full report and the log; only the ACTION stops.
        // A moderator turns this on with !!active on when a room needs it.
        if (!aiActive) {
            log('AI', `COOL MODE — would ${action} ${nick} (${reason}); reporting only.`);
            for (const m of channelMods()) {
                notice(m, `\x0307[AI]\x03 would \x02${action}\x02 \x02${nick}\x02 — ${reason}. `
                    + `Quoted: "${String(verdict.quote || '').slice(0, 60)}". `
                    + '\x02!!active on\x02 if the room needs the model acting.');
            }
            return;
        }

        // Gate 5 — the AI may never ban. A ban is the one action the person
        // cannot undo by coming back, and it should rest on something
        // deterministic: the word list bans, the model at most removes. Same
        // rule already applied to nickname screening.
        if (action === 'ban') {
            log('MOD', `AI wanted to ban ${nick} — capped at a kick.`);
            if (tier === 'stranger') { kickUser(chan, nick, reason, true); return; }
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
        if (action === 'kick') kickUser(chan, nick, reason, true);   // true = AI: no parting taunt
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
    // Redundant with isExempt() above now that whitelisted users are fully
    // exempt, but kept: a trusted regular's NAME is settled, and screening it
    // once banned a user seconds after the owner whitelisted them.
    if (isTrusted(nick)) return;
    // A registered nick is an identity someone owns; leave those to a human.
    if (isRegistered(nick)) return;
    // Impersonation is judged before ordinary screening and answered harder:
    // a cloned name is aimed at one person, and asking the attacker to "pick a
    // different nick" invites them to try the next variation.
    const clone = clonesARegular(nick);
    if (clone) {
        banUser(chan, nick, `impersonating ${clone.who} with an abusive nick`);
        noteHostileArrival(chan, 'clone');
        say(chan, `\x0304[MOD]\x03 That nick was built to target \x02${clone.who}\x02. `
            + `Banned on sight — ${clone.who}, you did not have to see that. 🦇`);
        log('MOD', `Clone attack: ${nick} targeted ${clone.who} (matched "${clone.word}").`);
        return;
    }
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
    noteHostileArrival(chan, bad);
}

// --- Witty AI reply (for mentions when sentient mode is off) ---
async function getAIResponse(prompt, who) {
    if (!config.groqKey) return null;
    try {
        const data = await groqChat({
            model: config.groqModel, temperature: 0.9, max_tokens: 120,
            messages: [
                { role: 'system', content:
                    'You are Dracula, a witty gothic vampire haunting an IRC channel. '
                    + 'ANSWER THE QUESTION FIRST, truthfully and specifically, in plain '
                    + 'words; add the gothic flourish afterwards and only if it fits. If '
                    + 'you do not know, say so plainly. Never dodge a factual question '
                    + 'with atmosphere — asked something real and answered with mood, you '
                    + 'are simply unhelpful.\n'
                    + 'People ask who the other bots are: Carmilla is from Sheridan Le '
                    + "Fanu's 1872 novella, Drusilla is from Buffy the Vampire Slayer and "
                    + 'Angel, Katerina (Katerina Petrova, also called Katherine Pierce) IS '
                    + 'from The Vampire Diaries, and Renfield was your servant in Bram '
                    + "Stoker's novel.\n"
                    + 'Never admit to being a bot. Keep replies to 1-2 sharp sentences.' },
                { role: 'user', content: `${who} says: ${prompt}` },
            ],
        });
        return (data?.choices?.[0]?.message?.content || '').replace(/\s+/g, ' ').trim().slice(0, 380) || null;
    } catch (e) { return null; }
}

/** One real AI call at startup. Silence from this layer is indistinguishable
 *  from an absence of abuse, so its health has to be asserted, not assumed. */
// What the AI layer's health actually is, so it can be reported late and on
// demand rather than only shouted once into an empty room.
let aiHealth = 'unknown';
let aiHealthTold = false;

/** Tell the moderators the AI is down — once, and only when there IS one to tell. */
function reportAiHealth() {
    if (aiHealthTold || !aiHealth.startsWith('down')) return;
    const mods = channelMods();
    if (!mods.length) return;                       // nobody here yet; try again later
    aiHealthTold = true;
    for (const n of mods) {
        notice(n, `\x0304[ALERT]\x03 AI moderation is offline (${aiHealth.slice(5, 70)}). `
            + 'The word filter still stands, but anything it does not list gets through. '
            + 'Check the Groq key.');
    }
}

async function selfCheckAI() {
    if (!config.groqKey) {
        aiHealth = 'down: no Groq key configured';
        log('WARN', 'No Groq key — AI moderation is OFF.');
        reportAiHealth();
        return;
    }
    try {
        const data = await groqChat({
            model: config.groqModel, temperature: 0, max_tokens: 8,
            messages: [{ role: 'user', content: 'reply with the single word: ok' }],
        });
        const txt = (data?.choices?.[0]?.message?.content || '').trim();
        if (txt) { aiHealth = 'ok'; log('OK', `AI layer healthy (${config.groqModel}).`); return; }
        throw new Error('empty response');
    } catch (e) {
        // This used to shout once, immediately after joining — BEFORE NAMES had
        // arrived, so channelMods() was empty and the alert reached nobody at
        // all. A dead key then looked exactly like a quiet room: the AI simply
        // stopped having opinions and the first anyone knew was abuse walking
        // straight through the word list.
        aiHealth = `down: ${e.message}`;
        log('ERR', `AI layer FAILED at startup: ${e.message}`);
        reportAiHealth();
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

/**
 * Give every proven peer ops in every room where we can.
 *
 * Called from three places on purpose — after a successful handshake, when a
 * proven peer joins anywhere, and when WE gain ops — because any one of those
 * three can be the last precondition to fall into place, and which one it is
 * depends on join order and on how quickly ChanServ answers. Re-sending +o to
 * somebody who already has it costs one line and the server ignores it, which
 * is a far better failure than a bot silently unopped in one of two rooms.
 *
 * @param {string} [only] restrict to a single channel, when that is all that changed
 */
function opProvenPeers(only) {
    if (!provenPeers.size) return;
    for (const c of config.channels) {
        const ch = chanKey(c);
        if (only && ch !== chanKey(only)) continue;
        if (!opped.has(ch)) continue;
        for (const m of members.get(ch) || []) {
            const low = m.toLowerCase();
            if (!provenPeers.has(low)) continue;
            if ((prefixOf.get(`${ch}|${low}`) || '').includes('@')) continue;   // already opped
            send(`MODE ${c} +o ${m}`);
            log('OK', `Opped proven peer ${m} in ${c}.`);
        }
    }
}

// People heard organising against us elsewhere, and when we heard it. This is
// the difference between knowing and preparing: a single name is noted quietly,
// but several inside one window means something is being assembled, and the
// doors close before it arrives instead of during it.
const incoming = new Map();
const INCOMING_WINDOW_MS = 10 * 60000;
const INCOMING_FOR_LOCK = Number(process.env.WATCH_LOCK_AT || 3);
// How long a flagged arrival stays muted without a moderator acting. Long
// enough to outlast the auto-voice sweep and the person's patience for
// spamming, short enough that a false positive fixes itself.
const watchMuteMin = Number(process.env.WATCH_MUTE_MIN || 30);

function stageIncoming(nick, why) {
    const now = Date.now();
    incoming.set(nick.toLowerCase(), now);
    for (const [n, at] of incoming) if (now - at > INCOMING_WINDOW_MS) incoming.delete(n);
    if (incoming.size < INCOMING_FOR_LOCK) return;
    for (const c of config.channels) {
        if (game.isGameChannel(chanKey(c))) continue;
        // lockDoors already announces itself in a way that explains the room's
        // own experience — invite-only for a moment — without naming anybody.
        lockDoors(c, `${incoming.size} people organising about this room elsewhere`);
    }
    incoming.clear();
}

/**
 * Answer "who is X" / "whois X" / "who is cloning X" from what we actually know.
 *
 * Deliberately NOT the AI. Every fact here comes from a record: the host the
 * server told us, the account ChanServ confirmed, strikes we counted,
 * where the watcher heard them, and whether the nick is built out of somebody
 * else's name. An invented answer to this question is worse than no answer,
 * because it will be believed and acted on.
 *
 * @returns {boolean} true when it answered, so the caller stops
 */
function answerWhoIs(chan, asker, msg) {
    const name = config.nick.toLowerCase().replace(/[^a-z0-9]/g, '');
    const lower = msg.toLowerCase();
    // Only when WE are the one being asked. Merely containing our name meant a
    // question put to Drusilla was answered by Dracula instead — and answered
    // wrongly, which is worse than not answering.
    if (!addressedTo(msg, config.nick)) return false;
    if (!new RegExp(`(^|[^a-z0-9])${name}([^a-z0-9]|$)`).test(lower)) return false;

    const body = lower.replace(new RegExp(name, 'gi'), ' ').replace(/[?.!,]+$/, '').trim();
    // "who is cloning aloo" asks the opposite question: not about the name
    // given, but about who is wearing it.
    const cloning = body.match(/\bwho(?:'s| is| are)?\s+(?:cloning|copying|impersonating|pretending to be)\s+(\S+)/);
    if (cloning) return answerCloning(chan, asker, cloning[1]);

    // "who is X" — NOT a bare "who". Making the verb optional meant "who wrote
    // dracula and in what year" was read as a lookup for a user called
    // "wrote", and the bot answered a literary question with "ordinary user,
    // never seen by me". Twice, in front of the room.
    const m = body.match(/\b(?:who(?:'s|\s+(?:is|was|are))|whois|what about|tell me about|info(?:\s+(?:on|about))?)\s+(\S+)/);
    if (!m) return false;
    const who = m[1].replace(/^[@+~&%]/, '');
    if (!who || who.length < 2 || who === name) return false;
    // Common words that follow "who is" in an ordinary question and are never
    // nicknames. Without this, "who is the author of dracula" answers about a
    // user called "the".
    if (/^(the|a|an|this|that|it|he|she|they|your|my|our|going|coming|here|there|best|worst)$/.test(who)) return false;

    const k = who.toLowerCase();
    const bits = [];
    const role = isOwner(who) ? 'owner' : isAdmin(who) ? 'admin'
        : whitelist.has(k) ? 'whitelisted' : 'ordinary user';
    bits.push(role);
    const acct = accountOf.get(k);
    bits.push(acct ? `logged in as ${acct}` : 'not identified to services');
    const host = hostOf.get(k);
    if (host) bits.push(`host ${host}`);
    const here = [...(members.get(chanKey(chan)) || new Set())]
        .some((n) => n.toLowerCase() === k);
    bits.push(here ? 'here now' : (seenUsers[k] ? `last seen ${ago(seenUsers[k])}` : 'never seen by me'));
    const strikes = warns.get(k) || 0;
    if (strikes) bits.push(`${strikes} strike${strikes === 1 ? '' : 's'}`);

    const clone = clonesARegular(who);
    if (clone) bits.push(`\x0304nick is built from "${clone.who}" plus "${clone.word}"\x03`);
    const bad = badNick(who);
    if (bad && !clone) bits.push(`\x0304nick contains "${bad}"\x03`);
    const seenElsewhere = watch.seenIn(who);
    if (seenElsewhere.length) bits.push(`heard talking about this room in ${seenElsewhere.join(', ')}`);
    if (ignored.has(k)) bits.push('ignored by me');

    say(chan, `\x0306[who]\x03 \x02${who}\x02 — ${bits.join(' · ')}. 🦇`);
    return true;
}

/** "who is cloning aloo" — search the room for nicks wearing someone's name. */
function answerCloning(chan, asker, victim) {
    const v = normalize(victim).replace(/\s+/g, '');
    if (!v || v.length < 3) return false;
    const hits = [];
    for (const c of config.channels) {
        for (const n of members.get(chanKey(c)) || []) {
            const nn = normalize(n).replace(/\s+/g, '');
            if (nn === v) continue;                       // that IS them
            if (nn.includes(v)) hits.push(n);
        }
    }
    say(chan, hits.length
        ? `\x0306[who]\x03 wearing \x02${victim}\x02's name right now: `
          + `\x02${[...new Set(hits)].join('\x02, \x02')}\x02. 🦇`
        : `\x0306[who]\x03 nobody here is using \x02${victim}\x02's name at the moment. 🦇`);
    return true;
}

/**
 * Is this message ADDRESSED to `me`, or does it merely mention me?
 *
 * A name in the middle of a sentence is being talked ABOUT; a name at the start
 * or the very end is being talked TO. Getting this wrong is how a bot ends up
 * interrupting two people discussing it.
 */
function addressedTo(text, me) {
    const n = String(me || '').replace(/[^a-z0-9]/gi, '');
    if (!n) return false;
    const t = String(text || '').trim();
    // "carmilla n drusilla me se" starts with a name and is not addressed to
    // anybody — it is two names being LISTED while somebody explains which is
    // which. A conjunction and a second bot name right after ours is a list,
    // not a greeting.
    if (new RegExp(`^${n}\\s*(,|&|\\bn\\b|\\band\\b|\\bor\\b)\\s*[a-z0-9_]{3,}`, 'i').test(t)) return false;
    return new RegExp(`^${n}\\b[\\s,:;–-]*`, 'i').test(t)
        || new RegExp(`\\b${n}\\s*[?!.]*$`, 'i').test(t);
}

/** When several bots are named, the first one named answers and the rest do not. */
function firstNamed(text, names) {
    let best = null;
    let at = Infinity;
    for (const n of names) {
        const m = String(text || '').toLowerCase().indexOf(String(n).toLowerCase());
        if (m >= 0 && m < at) { at = m; best = String(n).toLowerCase(); }
    }
    return best;
}

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
    // If we do not know somebody's account, ASK — do not silently withhold.
    //
    // Auto-voice for a registered user depends entirely on accountOf, which is
    // filled by extended-join. Somebody who was already in the room when we
    // connected never sends us a JOIN, so we never learn their account and
    // never voice them — for as long as they stay. Live: ishi and Lord are
    // both registered (ishi/ishi, LorD/EXTINCT), neither is in the whitelist,
    // and both had to be voiced by hand twice, an hour apart, across several
    // restarts.
    //
    // One WHO per sweep at most, and only when somebody is actually unknown.
    let unknown = 0;
    for (const n of members.get(ch) || []) {
        if (/[~&@%+]/.test(prefixIn(ch, n))) continue;          // already has something
        if (deservesVoice(n, ch)) { send(`MODE ${ch} +v ${n}`); continue; }
        if (!accountOf.has(String(n).toLowerCase())) unknown += 1;
        else noteVoiceDenial(n, ch);                            // known, and still no
    }
    if (unknown) {
        log('MOD', `${unknown} member(s) of ${ch} have no account on file — asking the server.`);
        send(`WHO ${ch} %cuhnar,152`);
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
                + '!!active on|off (AI moderation; off = cool), '
                + '!!trust add|del|seed|reload <nick> (sticks), !!untrust add|del|seed <nick>, '
            + '!!whitelist add|remove <nick> (this run only), '
            + '!!announce <msg>.');
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
                + `AI: ${aiHealth === 'ok' ? 'healthy' : aiHealth} (budget ${aiBudgetLeft()}). `
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
            // Say WHY they hold the tier they hold. Reporting only the raw
            // whitelist produced "role: user (trusted) ... not whitelisted",
            // which is two true statements that read as a contradiction and
            // sent the owner looking for a list entry that was never the
            // reason. Trust has three sources and they fail differently.
            const why = whitelist.has(k) ? 'whitelisted'
                : hostIsTrusted(who) ? 'trusted by host mask (TRUSTED_MASKS)'
                : /\+/.test(prefixIn(chan, who)) && voiceIsSelective(chan) ? 'trusted by voice'
                : 'not trusted';
            // Voice, and the REASON. "Why did this person not get auto-voice"
            // was unanswerable: four separate ways for the decision to come out
            // false and no record of which fired.
            const v = voiceReason(who, chan);
            reply( `${who} — role: ${role} (${tier} — ${why}), strikes: ${warns.get(k) || 0}/${quota}, `
                + `account: ${accountOf.get(k) || 'none seen'}, `
                + `host: ${hostOf.get(k) || 'unknown'}`
                + `${ignored.has(k) ? ', ignored' : ''}, last active: ${seenUsers[k] ? ago(seenUsers[k]) : 'never'}.`);
            reply( `${who} — auto-voice: ${v.ok ? 'YES' : 'NO'} (${v.why}).`);
            break;
        }
        // The switch a moderator actually reaches for, rather than a redeploy.
        case 'active': {
            if (!admin) { reply('Access denied.'); break; }
            const arg = (target || '').toLowerCase();
            if (arg === 'on' || arg === 'off') {
                aiActive = arg === 'on';
                log('MOD', `${nick} set AI moderation ${arg}.`);
                say(chan, `\x0306[MOD]\x03 AI moderation is \x02${arg.toUpperCase()}\x02`
                    + `${aiActive ? ' — the model can now remove people.'
                                  : ' — the model watches and reports; the word list still acts.'} 🦇`);
            } else {
                reply(`AI moderation is \x02${aiActive ? 'ON' : 'OFF (cool)'}\x02. `
                    + 'In cool mode the severe word list, solicitation, raid guard and auto-bans '
                    + 'still act — only the model stops removing people. !!active on|off');
            }
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
            serving.delete(`${chanKey(chan)}|${k}`);
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
                    ? `Recruiting from ${recruiter.channels.join(', ')} — ${recruiter.perRound} per attempt, `
                      + `next attempt ${recruiter.dueIn()}.`
                    : 'No RECRUIT_CHANNELS set.');
            }
            else if (args[0] === 'off') { recruiter.enabled = false; reply('Recruiting off.'); }
            else if (args[0] === 'now') {
                // A number invites that many at once: !!recruit now 10.
                const want = Math.min(25, Math.max(0, parseInt(args[1] || '0', 10))) || undefined;
                const sent = recruiter.inviteRound(want);
                if (sent.length) {
                    reply(`Invited ${sent.length}: ${sent.map((r) => `${r.target} (${r.chan})`).join(', ')}.`);
                    break;
                }
                // Say WHY. "Nobody eligible" cannot tell four different
                // problems apart, and each needs a different fix.
                reply(`Nobody eligible. ${recruiter.enabled ? '' : 'Recruiting is OFF. '}`);
                recruiter.explain().forEach((l) => reply(l));
            } else {
                reply(`Recruiting is ${recruiter.enabled ? 'ON' : 'OFF'}`
                    + `${recruiter.channels.length ? ` from ${recruiter.channels.join(', ')}` : ' (no channels set)'}`
                    + `; ${recruiter.invited.size} invited so far, ${recruiter.perRound} per attempt, `
                    + `next attempt ${recruiter.dueIn()}. `
                    + '!!recruit on|off|now [n]');
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
        // Trust, edited from the room and kept on the server. `!!whitelist`
        // still works and still only lasts the run; this is the one that sticks.
        case 'trust': {
            if (!admin) { reply('Access denied.'); break; }
            if (!trust.enabled) {
                // Tell them the actual commands, with our own account filled
                // in. "Set it to a registered channel this bot holds +f on" is
                // true and completely unactionable if you do not already know
                // what this bot's account is called.
                const me = config.nsAccount || currentNick;
                reply('Trust is still in the WHITELIST secret. To move it somewhere '
                    + 'you can edit from here, three steps:');
                reply(`1. \x02/msg ChanServ REGISTER #batcave-trust\x02`);
                reply(`2. \x02/msg ChanServ FLAGS #batcave-trust ${me} +Af\x02`);
                reply('3. set the \x02TRUST_CHANNEL\x02 secret to \x02#batcave-trust\x02 and restart me.');
                reply('Then \x02!!trust seed\x02 copies the current whitelist across, and '
                    + '\x02!!trust add|del\x02 works from the room.');
                break;
            }
            const who = args[1];
            if (args[0] === 'add' && who) {
                trust.add(trustKeyFor(who).key); refreshTrust();
                reply(`${who} is trusted as ${trustKeyFor(who).how} — stored on `
                    + `${trust.channel}, survives restarts. 🩸`);
            } else if ((args[0] === 'del' || args[0] === 'remove') && who) {
                trust.remove(who); refreshTrust();
                reply(`${who} is no longer trusted — stored on ${trust.channel}.`);
            } else if (args[0] === 'reload') {
                trust.refresh();
                reply(`Re-reading ${trust.channel}…`);
            } else if (args[0] === 'seed') {
                // The migration step. Without it, moving to a trust channel
                // means every regular loses their standing until somebody adds
                // them back by hand, one at a time, from a list nobody can read.
                // The WHITELIST SECRET, deliberately — not the effective list.
                //
                // `whitelist` is what the bot is currently enforcing, and once
                // the channel holds anybody it IS the channel. Seeding from it
                // therefore re-sends the names already stored and can never add
                // the rest: "Sent 18 names" on a 73-name whitelist, every time,
                // forever. Seeding means "copy the secret across", so it reads
                // the secret.
                const names = [...seedWhitelist].filter((n) => !untrust.has(n));
                if (!names.length) { reply('Nothing to seed — the whitelist is empty.'); break; }
                for (const n of names) trust.add(trustKeyFor(n).key);
                refreshTrust();
                reply(`Sent ${names.length} name${names.length === 1 ? '' : 's'} to `
                    + `${trust.channel}: ${names.join(', ')}.`);
                // ChanServ access lists work on ACCOUNTS, not nicks. A regular
                // who has never registered with NickServ cannot be added by
                // name, and ChanServ says so per name rather than failing the
                // batch — so the count sent is not the count stored. Read it
                // back rather than assuming, and say which ones landed.
                reply('ChanServ keys on ACCOUNTS and resolves each name itself. '
                    + `Waiting for ${names.length} writes to drain, then checking what `
                    + 'actually landed and masking whatever it refused…');
                trust.verify(names.length, () => {
                    const got = trust.list();
                    const missing = names.filter((n) => !got.includes(trustKeyFor(n).key.toLowerCase()));
                    reply(`Verified on ${trust.channel}: \x02${got.length}\x02 by account`
                        + `${trust.masks.size ? `, \x02${trust.masks.size}\x02 by mask` : ''}. `
                        + `${names.length - missing.length} of ${names.length} names covered.`);
                    if (!missing.length) return;
                    // These are the ones ChanServ genuinely refused — no
                    // account exists for them — so a mask is the only way left
                    // to store them, and it is now a fact rather than a guess.
                    reply(`\x0307${missing.length} have no services account\x03: `
                        + `${missing.slice(0, 12).join(', ')}`
                        + `${missing.length > 12 ? ` +${missing.length - 12} more` : ''}. `
                        + 'Storing as host masks — weaker, because a mask is not an identity. '
                        + 'Ask them to register to make it solid.');
                    for (const n of missing) trust.add(maskKeyFor(n).key);
                    trust.verify(missing.length, () => {
                        refreshTrust();
                        reply(`Done: \x02${trust.size}\x02 by account and \x02${trust.masks.size}\x02 `
                            + `by mask on ${trust.channel}. Grouped nicks share one account, so this `
                            + 'is fewer entries than names — that is correct, not missing.');
                    });
                });
            } else {
                const live = trust.loaded && trust.size > 0;
                reply(`Trusted (${trust.size}, from ${trust.channel}`
                    + `${live ? '' : trust.loaded
                        ? ' — EMPTY, so the WHITELIST secret is still in charge; run !!trust seed'
                        : ' — NOT yet read, using the WHITELIST secret'}): `
                    + `${trust.list().join(', ') || '(empty)'}.`);
            }
            break;
        }
        // Kept deliberately alongside !!trust: this is the fast, blunt one for
        // "not this person, not today", and it does not need a trust channel.
        case 'untrust': {
            if (!admin) { reply('Access denied.'); break; }
            const who = (args[1] || '').toLowerCase();
            if (args[0] === 'add' && who) {
                untrust.add(who);
                // Written to the channel as a +b entry, so a repeat offender
                // stays known across every restart and every bot — not just
                // for this run, and not in a secret nobody can read back.
                const stuck = trust.enabled && trust.loaded && trust.deny(args[1]);
                refreshTrust();
                reply(`${args[1]} is untrusted`
                    + (stuck ? ` — recorded on ${trust.channel}, survives restarts.`
                             : ' for THIS run. Set TRUST_CHANNEL to make it stick.'));
            } else if ((args[0] === 'del' || args[0] === 'remove') && who) {
                untrust.delete(who);
                if (trust.enabled && trust.loaded) trust.allow(args[1]);
                refreshTrust();
                reply(`${args[1]} is no longer on the untrust list.`);
            } else if (args[0] === 'seed') {
                // The other half of `!!trust seed`, which was missing — so the
                // trusted moved to the channel and the offenders stayed behind
                // in a secret, which is exactly the split this was meant to end.
                const names = [...untrust];
                if (!names.length) { reply('Nothing to seed — the untrust list is empty.'); break; }
                if (!trust.enabled || !trust.loaded) {
                    reply(`Cannot seed: ${trust.channel || 'no trust channel'} is not readable yet.`);
                    break;
                }
                for (const n of names) trust.deny(n);
                refreshTrust();
                reply(`Sent ${names.length} name${names.length === 1 ? '' : 's'} to `
                    + `${trust.channel} as +${trust.denyFlag}. Verifying…`);
                trust.verify(names.length, () => {
                    const got = trust.deniedList();
                    const missing = names.filter((n) => !got.includes(n.toLowerCase()));
                    reply(`Denied (${got.length} by account`
                        + `${trust.denyMasks.size ? `, ${trust.denyMasks.size} by mask` : ''}): `
                        + `${got.join(', ') || '(none)'}.`);
                    if (!missing.length) return;
                    // An offender with no account is exactly the case a mask
                    // handles best — and unlike trust, a mask here is the RIGHT
                    // tool: you want to catch them however they come back.
                    reply(`${missing.length} have no account — denying by mask instead: `
                        + `${missing.join(', ')}.`);
                    for (const n of missing) trust.deny(maskKeyFor(n).key);
                    trust.verify(missing.length, () => {
                        refreshTrust();
                        reply(`Done: ${trust.deniedList().length} denied by account, `
                            + `${trust.denyMasks.size} by mask.`);
                    });
                });
            } else {
                const onChannel = trust.enabled && trust.loaded ? trust.deniedList() : [];
                reply(`Untrusted (${onChannel.length || untrust.size}): `
                    + `${(onChannel.length ? onChannel : [...untrust]).join(', ') || '(nobody)'}`
                    + `${onChannel.length ? ` — from ${trust.channel}` : ''}. `
                    + '!!untrust add|del <nick>');
            }
            break;
        }
        case 'whitelist':
            if (!admin) { reply('Access denied.'); break; }
            if (args[0] === 'add' && args[1]) { whitelist.add(args[1].toLowerCase()); reply( `${args[1]} is trusted now — immune to auto-mod. 🩸`); }
            else if (args[0] === 'remove' && args[1]) {
                whitelist.delete(args[1].toLowerCase());
                // Say plainly that this does not survive a restart. Somebody
                // removing a name and assuming it stuck would find them trusted
                // again within the hour, with nothing to explain why.
                reply(`${args[1]} removed from the whitelist — for THIS run only. `
                    + `Add them to the UNTRUST secret to make it stick.`);
            }
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
    connectTime = Date.now();          // the replay guard's reference point
    connectStartedAt = Date.now();     // the stall watchdog's reference point
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
        // Clear the handle before reconnecting. scheduleReconnect() opens with
        // `if (reconnectTimer) return;`, so leaving it set means the FIRST
        // pre-registration failure is also the last: every later close returns
        // at that guard, the counter never advances, and the five-strike exit
        // never fires. Observed 2026-08-25 on a blocked runner address — one
        // retry, then four minutes of silence until the startup watchdog
        // stepped in. The registered branch below always got this right.
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 20000);
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
        // Same reasoning as QUIT: whoever picks up the abandoned name has
        // proved nothing, and proof does not travel to the new one either.
        provenPeers.delete(nick.toLowerCase());
        provenPeers.delete((newNick || '').toLowerCase());
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
        lastHealthy = Date.now();
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
    // +g closes DMs against flood, which also blocks the peer handshake in BOTH
    // directions: our challenge never arrives, and their answer would be
    // refused coming back. ACCEPT lets exactly the standby bots through and
    // nobody else, so the flood protection stays and the handshake works.
    // The server advertises ACCEPT=30 in 005, so a short peer list fits easily.
    // NOT here — see acceptPeer(). The server can only accept a nick that
    // exists, and at registration the standbys may not have connected yet.
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
            if (trust.enabled) {
                // After registration, not before: a FLAGS request fired during
                // the join burst sits behind twenty other lines and times out
                // on our own traffic.
                setTimeout(() => trust.refresh(), 8000);
                // Sit in the storage channel. Not to talk — to EXIST there.
                // ChanServ expires a channel after 365 days with nobody
                // holding +FORforsv present, and a room nobody ever joins is
                // exactly that. We hold +f, so simply being here keeps the
                // trust list from being deleted out from under us.
                //
                // But only once we have READ our own row: we carry +b so that
                // we are permitted to grant it, and +b is automatic kickban.
                // Joining without +e would have ChanServ throw us out of our
                // own store.
                // Retry rather than announce. The first check lands before the
                // listing has arrived on most restarts.
                const trySit = (attempt = 1) => {
                    const sit = trust.canSit();
                    if (sit.ok) { send(`JOIN ${trust.channel}`); return; }
                    if (sit.quiet && attempt < 6) { setTimeout(() => trySit(attempt + 1), 15000); return; }
                    if (sit.quiet) return;              // never read it; say nothing, it is not an error
                    log('WARN', `Not joining ${trust.channel}: ${sit.why.replace(/\x02/g, '')} `
                        + '(the channel can expire after 365 days with nobody in it).');
                    for (const o of config.owners) {
                        notice(o, `\x0304[TRUST]\x03 Not sitting in ${trust.channel}: ${sit.why}`);
                    }
                };
                setTimeout(() => trySit(), 20000);
                // Cheap poll: COUNT is two lines and carries a per-flag
                // histogram, where FLAGS costs a row per entry. Check often,
                // and pull the whole listing only when the numbers move —
                // which notices a hand-edit in 5 minutes instead of 15 while
                // sending a fraction of the traffic.
                setInterval(() => trust.poll(), 5 * 60000).unref?.();
                // A slow full re-read anyway, so a missed COUNT cannot leave
                // us wrong forever.
                setInterval(() => trust.refresh(), 60 * 60000).unref?.();
            }
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
            // Re-read the membership of the source rooms periodically.
            //
            // Tracking JOIN and PART keeps a list roughly right; it cannot
            // keep it right for hours. A netsplit, a missed line, or the bot
            // being briefly disconnected loses people permanently, and the
            // error only ever goes one way — downward — because departures are
            // observed and arrivals can be missed. NAMES is one round trip and
            // replaces the whole list, so the drift cannot accumulate.
            setInterval(() => {
                for (const c of recruiter.channels) send(`NAMES ${c}`);
            }, 600000);
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
        // 900 is RPL_LOGGEDIN and its last parameter is the account the server
        // says we are. Take it from there, never from config: NICKSERV_ACCOUNT
        // held a value that did not match, so the bot failed to recognise its
        // OWN row in the trust list and reported itself as a trusted regular.
        // The server is the authority on who we are; a secret is a guess.
        const acct = command === '900' ? (params[2] || params[params.length - 1] || '') : '';
        if (acct && acct !== '*') {
            accountOf.set(currentNick.toLowerCase(), acct);
            if (trust.self !== acct.toLowerCase()) {
                log('OK', `Logged in as account ${acct} — using it to recognise my own trust entry.`);
                trust.self = acct.toLowerCase();
            }
        }
    }
    // ChanServ talks back in NOTICEs. Both the history command and the services
    // health check listen here; each is inert unless it is actually waiting.
    // The answer to a challenge. Only ever grants ops — never anything else,
    // and only to a nick we ourselves challenged moments ago.
    if (command === 'NOTICE' && nick && /^AUTH\s+\S+$/.test(msg.trim())) {
        const answer = msg.trim().split(/\s+/)[1];
        if (handshake.isPending(nick)) {
            if (handshake.verify(nick, answer)) {
                log('OK', `${nick} proved itself — granting ops.`);
                provenPeers.add(nick.toLowerCase());
                // Now, not at the next refresh: a standby that has just come
                // up is exactly the one holding no list at all.
                setTimeout(() => relayTrust(true), 1500);
                opProvenPeers();
            } else {
                // Somebody wearing the standby's name who cannot answer for it.
                // Worth saying out loud: nobody else should ever be receiving
                // this challenge, so a wrong answer is an attempt, not a slip.
                log('ERR', `${nick} failed the peer challenge: ${handshake.lastFailure}`);
                // This used to stay silent whenever the failure MIGHT have been
                // a key rotation — which is every wrong answer, since the two
                // are indistinguishable from here. The result was that a
                // genuine attempt to wear a standby's name produced nothing in
                // the room at all. Both cases are worth saying out loud: one is
                // an impersonation, the other means our own mesh has split, and
                // the owner needs to know either way. The wording is true of
                // both, and accuses nobody.
                if (!recentlyCalledOut.has(nick.toLowerCase())) {
                    recentlyCalledOut.set(nick.toLowerCase(), Date.now());
                    for (const c of config.channels) {
                        say(c, `\x0304[MOD]\x03 \x02${nick}\x02 is using our standby's name and `
                            + 'could not prove it. Granting nothing. 🦇');
                    }
                }
            }
        }
        return;
    }

    if (command === 'NOTICE' && /^chanserv$/i.test(nick || '')) {
        if (servicesReport) servicesReport(msg);
        if (trust.absorb(msg)) refreshTrust();
        if (trust.countChanged(msg)) trust.refresh();
        // absorb() only looks at notices while a LISTING is open, so a refused
        // WRITE used to fall straight through here and vanish.
        reportTrustRefusal(msg);
    }
    if (command === 'NOTICE' && /^nickserv$/i.test(nick || '')) readNickInfo(msg);
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
            // A hostile channel mode from somebody who was handed ops.
            //
            // Live: LiBu gave ops to Lucifer, who banned R:Vampire — an extban
            // on the OWNER'S ACCOUNT — kicked him, and then set +R +u +c +i on
            // the room. +i is invite-only: nobody new can get in at all. The
            // bot restored the owner (that part worked) and did nothing about
            // the lockdown; the owner had to ask twice in the room for it to
            // be undone by hand.
            //
            // Ops are transitive here — any op can make another op — so the
            // trust model has no say in who ends up holding them. This is the
            // backstop: a mode that closes the room, set by somebody the bot
            // does not trust, is reverted once and reported.
            //
            // Once, deliberately. Reverting in a loop against a determined op
            // is a mode war that fills the room with noise and ends when one
            // side is deopped anyway.
            if ('ikmlR'.includes(ch) && adding && nick
                && !isTrusted(nick) && !isAdmin(nick) && !isOwner(nick)
                && nick.toLowerCase() !== currentNick.toLowerCase()
                && !/serv$|^chanbot$/i.test(nick)) {
                const key = `${chanKey(tgt)}|lockdown`;
                if (!actedRecently(key, ch, 'revert')) {
                    markActioned(key, ch, 'revert');
                    log('MOD', `${nick} set +${ch} on ${tgt} without standing — reverting.`);
                    send(`MODE ${tgt} -${ch}`);
                    for (const o of config.owners) {
                        notice(o, `\x0304[GUARD]\x03 \x02${nick}\x02 set \x02+${ch}\x02 on ${tgt} `
                            + '— reverted. They hold ops without being on the trust list; '
                            + `\x02/msg ChanServ DEOP ${tgt} ${nick}\x02 if that was not deliberate.`);
                    }
                }
            }
            if ('ovhbeIkl'.includes(ch)) {
                const who = targets[ti++] || '';
                // A HUMAN op giving voice back ENDS the sentence.
                //
                // Live: vergil was devoiced, the owner voiced him at 12:41:07,
                // and the bot took it away again at 12:41:08 — then repeated it
                // on the next rejoin. The enforcement is there so somebody
                // cannot shed a devoice by cycling, and it cannot tell that
                // apart from a moderator overruling it.
                //
                // A moderator's decision outranks a timer the bot set. Anyone
                // else handing voice back is still treated as evasion.
                if (ch === 'v' && adding && who && nick
                    && nick.toLowerCase() !== currentNick.toLowerCase()
                    && (isAdmin(nick) || isOwner(nick) || isChannelMod(tgt, nick))) {
                    const skey = `${chanKey(tgt)}|${who.toLowerCase()}`;
                    if (serving.has(skey)) {
                        serving.delete(skey);
                        log('MOD', `${nick} voiced ${who} in ${tgt} — devoice cleared, they outrank the timer.`);
                    }
                }
                if ('ovhq'.includes(ch) && who) {          // track everyone's status
                    const key = `${chanKey(tgt)}|${who.toLowerCase()}`;
                    const sym = { o: '@', v: '+', h: '%', q: '~' }[ch];
                    const cur = prefixOf.get(key) || '';
                    prefixOf.set(key, adding ? (cur.includes(sym) ? cur : cur + sym)
                                             : cur.split(sym).join(''));
                }
                if (ch === 'o' && who.toLowerCase() === currentNick.toLowerCase()) {
                    if (adding) {
                        opped.add(chanKey(tgt));
                        log('OK', `Got ops in ${tgt}.`);
                        // Peers may have proved themselves while we were
                        // powerless here. Now we can act on it.
                        opProvenPeers(tgt);
                    }
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

    // The room's real topic, so a game that borrows the topic line can put it
    // back. Captured from both the reply on join (332) and any later change.
    if (command === '332' && params[2] !== undefined) {
        game.rememberTopic(params.slice(2).join(' ').replace(/^:/, ''));
    }
    if (command === 'TOPIC' && nick) {
        game.rememberTopic(msg);
    }

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
                setTimeout(reportAiHealth, 1500);   // now there is somebody to tell
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
        // Proof belongs to a CONNECTION, not to a name. These bots run on
        // runners that die every six hours, and this room is under attack by
        // somebody whose entire method is wearing other people's names — so a
        // standby that leaves must prove itself again when it returns.
        // Otherwise the first person to grab the freed nick is handed ops.
        if (provenPeers.delete(nick.toLowerCase())) {
            log('INFO', `${nick} left — it must prove itself again to be trusted.`);
        }
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
        const ch = chanKey(params[1] || '');
        voiceSweep(ch);
        // Challenge any standby ALREADY in the room. Challenging only on JOIN
        // meant a peer that was here before we restarted was never asked at
        // all — and since this bot restarts every six hours while the standbys
        // persist, that is the normal case, not the edge one. Observed live:
        // three standbys sat voiced and un-opped because they had simply
        // arrived first.
        for (const n of members.get(ch) || []) {
            if (!handshake.isCandidate(n) || handshake.isPending(n)) continue;
            if (/[~&@%]/.test(prefixIn(ch, n))) continue;      // already has status
            acceptPeer(n);                 // so their answer can reach us
            const nonce = handshake.challenge(n);
            if (nonce) {
                send(`NOTICE ${n} :AUTH ${nonce}`);
                log('INFO', `Challenged ${n}, already present in ${ch}.`);
            }
        }
    } else if (command === 'JOIN' && nick) {
        const c = chanKey((tgt || msg).replace(/^:/, ''));
        // Membership is tracked for the SOURCE rooms too, not just our own.
        //
        // This guard was the reason the recruiter kept answering "0 eligible"
        // in a room with people in it. Arrivals in a recruit room were never
        // added — but PART and QUIT have no such guard and remove from any
        // channel — so the member list was filled once by NAMES at join and
        // then only ever shrank. Measured: 1439 people actually in
        // #allindiachat.com, 288 in the bot's view, and the count resetting
        // high after every restart and decaying again. Every new arrival, who
        // is precisely the person nobody has invited yet, was invisible.
        const sourceRoom = recruiter.channels.some((r) => chanKey(r) === c);
        if (!isOurChannel(c) && !sourceRoom) return;
        (members.get(c) || members.set(c, new Set()).get(c)).add(nick);
        // The rest of this block — voicing, guards, the ladder — is for OUR
        // rooms. A source room is only ever watched, never acted in.
        if (!isOurChannel(c)) return;
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
        // Rejoining does not end a sentence. ChanServ's access list carries
        // `*!*@* +V`, so it voices everyone the moment they arrive — including
        // somebody who left thirty seconds ago precisely to shed a de-voice.
        // Take it back, twice, because our -v and ChanServ's +v race and the
        // loser is whichever lands second.
        const stillServing = () => {
            const until = serving.get(`${c}|${nick.toLowerCase()}`);
            if (!until || Date.now() >= until) return;
            if (!opped.has(c)) return;
            if (!(members.get(c) || new Set()).has(nick)) return;
            send(`MODE ${c} -v ${nick}`);
        };
        setTimeout(stillServing, 1500);
        setTimeout(stillServing, 6000);

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
        // A nick claiming to be our standby. Ask it to prove that.
        if (ready && handshake.isCandidate(nick)) {
            acceptPeer(nick);              // so their answer can reach us
            // The shortcut applies ONLY to a peer we can already see in a
            // DIFFERENT room. That is the real case — one connection joining
            // its second channel — and it is the one that races. An arrival we
            // cannot already account for is challenged however familiar the
            // name looks, because a familiar name is exactly what an impostor
            // brings.
            const seenElsewhere = [...members.entries()]
                .some(([ch, set]) => ch !== chanKey(c)
                    && [...set].some((m) => m.toLowerCase() === nick.toLowerCase()));
            if (provenPeers.has(nick.toLowerCase()) && seenElsewhere) {
                setTimeout(() => opProvenPeers(c), 1500);
                return;
            }
            const nonce = handshake.challenge(nick);
            if (nonce) {
                send(`NOTICE ${nick} :AUTH ${nonce}`);
                log('INFO', `Challenged ${nick} in ${c}.`);
            }
            return;                      // never nick-screen a peer under test
        }

        if (ready && strictNicks && !moderationOff(c)) { screenNick(c, nick); }

        // Somebody we heard organising this, arriving. Not a ban: advertising a
        // channel is not yet an offence, and a pre-emptive ban on a suspicion
        // formed in someone else's room is exactly the overreach that gets a
        // real person thrown out. But they arrive without voice in a moderated
        // room, so the first thing they say is read before the room hears it,
        // and the moderators are told who walked in and why.
        if (ready && watch.isFlagged(nick) && !isTrusted(nick) && !isAdmin(nick)) {
            const where = watch.seenIn(nick).join(', ');
            watch.forget(nick);                  // one greeting, not every join
            noteHostileArrival(c, 'flagged arrival');
            // The de-voice MUST be recorded, or it does not survive five
            // seconds. Observed live: Dracula took Bilal's voice at 14:58:33
            // and handed it straight back at 14:58:38, because the room is
            // moderated, deservesVoice() returns true for everyone in a
            // moderated room, and only `serving` overrides that. The mute was
            // real, announced, and completely undone before anyone read it.
            if (opped.has(c)) {
                serving.set(`${c}|${nick.toLowerCase()}`, Date.now() + watchMuteMin * 60000);
                send(`MODE ${c} -v ${nick}`);
            }
            // Not announced to the room. The owner's objection stands here as
            // much as before arrival: naming somebody to everybody, for what
            // they said in a different channel, reads badly and gives the room
            // nothing to do. The PERSON is told why they cannot speak, which is
            // the only thing they actually need, and the moderators are told
            // who walked in.
            notice(nick, `\x0304[BatCave]\x03 You arrive without voice: you were heard `
                + `advertising this room in ${where}. A moderator can restore it. `
                + 'This is not a ban.');
            for (const m of channelMods()) {
                notice(m, `\x0304[WATCH]\x03 \x02${nick}\x02 just arrived in ${c} — heard `
                    + `advertising this room in ${where}. Muted for ${watchMuteMin}m. `
                    + `\x02!!unwarn ${nick}\x02 to clear it.`);
            }
            log('MOD', `Watch: flagged arrival ${nick} in ${c} (seen in ${where})`);
        }

        // Raid guard: a burst of joins in a few seconds is a raid, not traffic.
        if (ready && raidGuard && !game.isGameChannel(c)) {
            const now = Date.now();
            const hist = (joinLog.get(c) || []).filter((t) => now - t < raidWindowMs);
            hist.push(now); joinLog.set(c, hist);
            if (hist.length >= raidJoins) {
                joinLog.set(c, []);
                lockDoors(c, `${hist.length} joins in ${raidWindowMs / 1000}s`);
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

    // A room that is not ours. We are a guest: never speak, never set a mode,
    // never moderate. Only listen for our own channel being advertised, which
    // is how the last raid was assembled before any of it reached home.
    if (command === 'PRIVMSG' && nick && /^#/.test(tgt || '') && !isOurChannel(tgt)) {
        const heard = watch.hear(tgt, nick, msg, {
            trusted: isTrusted(nick) || isAdmin(nick) || isOwner(nick)
                || nick.toLowerCase() === currentNick.toLowerCase(),
            abusive: Boolean(wordHit(badwords, msg) || wordHit(severeWords, msg)),
            badNick: Boolean(badNick(nick)),
        });
        if (heard.level === 'alert') {
            const where = watch.seenIn(nick).join(', ') || tgt;
            // NOT announced to the room any more. It named a stranger to
            // everybody, about something they had done somewhere else, before
            // they had even arrived — which reads as paranoid, tells the room
            // nothing it can act on, and hands the person a grievance if they
            // do turn up. The moderators get the detail privately; the room
            // gets a quieter door instead of a warning.
            const mods = channelMods().filter((m) => isAdmin(m) || isOwner(m));
            for (const m of mods) {
                notice(m, `\x0304[WATCH]\x03 \x02${nick}\x02 is ${heard.why} in ${where}. `
                    + `Not here yet — they will arrive without voice. `
                    + `\x02!!info ${nick}\x02 for detail, \x02!!unwarn ${nick}\x02 to clear it.`);
            }
            log('MOD', `Watch: ${nick} ${heard.why} in ${tgt}`);
            // The precaution, which is the part that was missing. One hostile
            // being assembled elsewhere is noted and nothing more; several at
            // once is a raid forming, and the door closes BEFORE it lands
            // rather than after the first twenty joins.
            stageIncoming(nick, heard.why);
        }
        return;
    }

    if (command === 'PRIVMSG' && isOurChannel(tgt) && nick) {
        if (isReplay(tags)) return;                       // +H backlog, not live
        seenUsers[nick.toLowerCase()] = Date.now();
        // Standing follows behaviour. Counting happens for everyone; the
        // promotion check only does anything once they are past the bar.
        reputation.spoke(nick);
        if (reputation.messages(nick) >= Number(process.env.TRUST_EARN_MESSAGES || 40)) {
            askRegistration(nick);
            gainTrust(nick, tgt);
        }
        if (!ready) return;                                   // ignore replayed backlog
        if (ignored.has(nick.toLowerCase())) return;          // !!ignore

        if (msg.startsWith('!!')) { handleCommand(tgt, nick, msg); return; }
        // A plain-English order from someone who already holds authority.
        // Before the filters, because a moderator saying "Dracula ban troll42
        // for racism" must not be screened as if THEY said something abusive.
        if (handleOrder(tgt, nick, msg)) return;
        // Someone trying to aim the bot at one of our own. Must come BEFORE the
        // "said my name" reply below: that path hands the message to the AI,
        // which would happily write the roast it was asked for.
        {
            const shield = shieldLine(msg, nick,
                (n) => isTrusted(n) || isAdmin(n) || isOwner(n),
                (n) => [...(members.get(chanKey(tgt)) || new Set())].some((m) => m.toLowerCase() === n.toLowerCase()));
            if (shield && !isTrusted(nick) && !isAdmin(nick)) { say(tgt, shield); return; }
        }
        // Before the ordinary ladder: a fight between two people is its own
        // thing, and answering it with a generic "watch your language" at
        // whichever of them happened to speak last misses what is happening.
        if (watchForFeud(tgt, nick, msg)) return;
        if (scriptedModeration(tgt, nick, msg)) { guardVictim(tgt, nick, msg); return; }
        // Sentient screening runs in the background. It must NOT return here:
        // doing so silenced every reply once sentient mode became the default.
        if (sentientMode) sentientModeration(tgt, nick, msg);

        // Reply if mentioned by name — but never to another bot. The standbys
        // report their status as "dracula: here, luna1: here", which names us
        // and so tripped this on every status command: the room filled with the
        // bot answering machines in character. Two bots holding a conversation
        // is noise nobody asked for, and it costs an AI call each time.
        if (PROTECTED_NICKS.has(nick.toLowerCase()) || handshake.isCandidate(nick)) return;
        // "dracula who is telugu_m23" — a QUESTION about somebody, which is not
        // an order and was therefore reaching the AI, which cheerfully invented
        // an answer in character. Asking who is cloning aloo got a joke about
        // potatoes. This is the one thing the bot genuinely knows and it was
        // the one thing it would not say. Answered from real records, never
        // from the model, and it works for people who have already left —
        // orders require the target to be PRESENT, which is exactly backwards
        // for a question about someone who just vanished.
        if (answerWhoIs(tgt, nick, msg)) return;
        // ADDRESSED, not merely mentioned — and only one of us answers.
        //
        // Matching the name anywhere in the message meant the bots barged into
        // a conversation ABOUT them: somebody explaining to a newcomer which of
        // Carmilla and Drusilla was which had two bots interrupt to say nothing.
        // And a question naming all three produced three replies in the same
        // second. Whoever is named first takes it; every bot reaches the same
        // answer from the same text without needing to agree on anything.
        if (addressedTo(msg, config.nick)) {
            const everyBot = [...PROTECTED_NICKS, ...(handshake.peers || [])];
            const speaker = firstNamed(msg, everyBot);
            if (!speaker || speaker === config.nick.toLowerCase()) {
                getAIResponse(msg, nick).then((r) => { if (r) say(tgt, `${nick}: ${r}`); });
            }
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
// Last line of defence. Whatever else goes wrong, a process that has never
// once registered is not a bot — it is a job holding the concurrency slot shut
// against the run that would replace it. Exiting non-zero ends the job, frees
// the slot, and the queued run starts within minutes on a different runner.
// Five minutes is generous: a healthy start reaches 001 in under ten seconds.
// A bot that cannot get back is worth no more than one that never arrived, and
// the remedy is the same: end the job so a fresh runner — with a fresh address —
// takes the slot. Checked on the health interval rather than once, because the
// failure can begin at any point in a six-hour shift.
setInterval(() => {
    if (ready && socket && socket.writable) { lastHealthy = Date.now(); return; }
    const down = Date.now() - lastHealthy;
    if (down > DOWN_TOO_LONG_MS) {
        log('ERR', `No working connection for ${Math.round(down / 60000)}m. Exiting so the `
            + 'queued run takes the slot instead of waiting behind a bot that is not there.');
        process.exit(1);
    }
}, 30000);

setTimeout(() => {
    if (!everRegistered) {
        log('ERR', 'Five minutes without ever registering. Exiting so the queued '
            + 'run can take the slot rather than waiting six hours behind a dead one.');
        process.exit(1);
    }
}, 5 * 60000);

setInterval(() => {
    if (!connecting && !reconnectTimer && (!socket || socket.destroyed || !socket.writable)) {
        connect();
        return;
    }
    // Checked BEFORE the `connecting` guard below, because this is the one
    // failure that happens while connecting is stuck true. Destroying the
    // socket makes it fire 'close', which routes into scheduleReconnect() and
    // the existing pre-registration counter — so a genuinely blocked address
    // still exits after five tries and hands over to a fresh runner.
    // NOT gated on `connecting`. That flag is cleared the instant TCP
    // connects, which is BEFORE registration — so the one zombie shape this
    // was written for, a server that accepts the connection and then never
    // says another word, sailed straight past it. The bot sat with a writable
    // socket and an unfinished handshake, and every other check here saw a
    // healthy connection. `ready` is the honest signal: it is reset per
    // attempt in connect() and only set once the server has actually
    // registered us, so this now covers a stalled TCP connect and a stalled
    // registration with the same condition.
    if (!ready && connectStartedAt && Date.now() - connectStartedAt > CONNECT_DEADLINE_MS) {
        log('WARN', `Stuck connecting for ${Math.round((Date.now() - connectStartedAt) / 1000)}s `
            + '(no registration) — giving up on this attempt.');
        connectStartedAt = 0;
        connecting = false;
        try { socket && socket.destroy(); } catch (e) { /* close handler takes it from here */ }
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
