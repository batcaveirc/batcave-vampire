const net = require('net');
const tls = require('tls');

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
    realname: process.env.IRC_REALNAME || 'BatCave Vampire Bot',
    password: process.env.NICKSERV_PASS || '',
    nsAccount: process.env.NICKSERV_ACCOUNT || '',
    channels,
    owners: list(process.env.OWNERS),
    admins: list(process.env.ADMINS),
    groqKey: process.env.GROQ_API_KEY || '',
    // Free Groq tiers rate-limit fast; a second key keeps moderation alive.
    groqKey2: process.env.GROQ_API_KEY_2 || process.env.GROQ_API_KEY1 || '',
    groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    linkFilter: onOff(process.env.LINK_FILTER),
    warnLimit: parseInt(process.env.WARN_LIMIT || '3', 10),
};

// Default moderation vocab (EN + Hinglish). Extend at runtime with !!badword, or
// via the BADWORDS / SEVERE_WORDS secrets. Severe words are kept OUT of the repo
// on purpose — add slurs there via the SEVERE_WORDS secret.
const DEFAULT_BADWORDS = ['fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt',
    'slut', 'whore', 'retard', 'stupid', 'idiot', 'moron', 'dumbass', 'loser', 'scum',
    'kutta', 'kutte', 'chutiya', 'madarchod', 'bhenchod', 'gandu', 'harami', 'kamina', 'kaminey'];
const badwords = new Set([...DEFAULT_BADWORDS, ...list(process.env.BADWORDS)]);
const severeWords = new Set(list(process.env.SEVERE_WORDS));
const whitelist = new Set(list(process.env.WHITELIST));

// IRC channel names are case-insensitive: the server may echo "#BatCave" while
// the secret says "#batcave". Comparing them with === / includes() silently
// drops every message in the room, which looks exactly like the bot "hanging".
const chanKey = (c) => (c || '').toLowerCase();
const channelSet = new Set(config.channels.map(chanKey));
const isOurChannel = (c) => channelSet.has(chanKey(c));

// --- State (in-memory; resets each restart — fine for an ephemeral host) ---
let socket = null;
let currentNick = config.nick;
let connecting = false;
let reconnectAttempts = 0;
let hasJoined = false;
let ready = false;                 // replay guard: ignore backlog on (re)join
let sentientMode = onOff(process.env.SENTIENT_ON);
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
let aiCalls = [];                  // recent Groq call timestamps (rate limit)
let reconnectTimer = null;
let lastRx = Date.now();           // last byte received — drives the health check
let pingProbeSent = false;
const connectTime = Date.now();

// Persistent auto-ban masks, enforced on every join (glob, e.g. *!*@1.2.3.*).
const autobanMasks = new Set(list(process.env.AUTOBAN_MASKS));
// Strict mode: kick joiners whose NICK itself contains filtered words.
let strictNicks = onOff(process.env.STRICT_NICKS);
const channelRules = process.env.CHANNEL_RULES || '';

// Raid protection: N joins inside the window trips a temporary invite-lock.
const raidJoins = parseInt(process.env.RAID_JOINS || '7', 10);
const raidWindowMs = parseInt(process.env.RAID_WINDOW_SEC || '10', 10) * 1000;
const raidLockSec = parseInt(process.env.RAID_LOCK_SEC || '60', 10);
let raidGuard = onOff(process.env.RAID_GUARD || 'on');

// --- Helpers ---
function log(type, msg) { console.log(`[${type}] ${msg}`); }
function send(data) { if (socket && socket.writable) socket.write(data + '\r\n'); }
function say(chan, msg) { send(`PRIVMSG ${chan} :${msg}`); }
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
function isExempt(nick) {
    const n = nick.toLowerCase();
    return n === config.nick.toLowerCase() || isAdmin(nick) || whitelist.has(n);
}

// Normalize leet/obfuscation so "st00pid" and "f-u-c-k" still match a whole word.
function normalize(t) {
    return (t || '').toLowerCase()
        .replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e')
        .replace(/4/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't')
        .replace(/[^a-zऀ-ॿ ]/g, ' ')     // keep latin + devanagari
        .replace(/(.)\1{2,}/g, '$1$1');
}
function wordHit(wordSet, msg) {
    if (!wordSet.size) return null;
    const words = new Set((' ' + normalize(msg) + ' ').split(/\s+/));
    for (const w of wordSet) if (w && words.has(w)) return w;
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

// --- Punishment / escalation ---
function warnUser(chan, nick, reason) {
    const k = nick.toLowerCase();
    const n = (warns.get(k) || 0) + 1;
    warns.set(k, n);
    if (n >= config.warnLimit) {
        warns.set(k, 0);
        send(`KICK ${chan} ${nick} :${config.warnLimit} strikes — ${reason}`);
        say(chan, `\x0304[MOD]\x03 ${nick} banished after ${config.warnLimit} warnings (${reason}). 🦇`);
    } else {
        say(chan, `\x0304[MOD]\x03 ${nick} warned (${n}/${config.warnLimit}) — ${reason}.`);
    }
}
function kickUser(chan, nick, reason) {
    if (!requireOps(chan, `kick ${nick}`)) return;
    send(`KICK ${chan} ${nick} :${reason}`);
    say(chan, `\x0304[MOD]\x03 ${nick} banished — ${reason}. 🦇`);
}

// A "nick!*@*" ban stops nobody — they rejoin under any other nick two seconds
// later. Ban the HOST when we know it (learned from their messages/joins) and
// fall back to the nick mask only when we don't.
function banMask(nick) {
    const host = hostOf.get(nick.toLowerCase());
    return host ? `*!*@${host.split('@')[1]}` : `${nick}!*@*`;
}
function banUser(chan, nick, reason) {
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

// --- Scripted moderation (ALWAYS on): severe, badwords, links, caps, flood, repeat ---
function scriptedModeration(chan, nick, message) {
    if (isExempt(nick)) return false;

    const severe = wordHit(severeWords, message);
    if (severe) { banUser(chan, nick, 'severe language'); return true; }

    const bad = wordHit(badwords, message);
    if (bad) { warnUser(chan, nick, 'watch your language'); return true; }

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
async function groqChat(body) {
    const keys = [config.groqKey, config.groqKey2].filter(Boolean);
    let lastErr = null;
    for (const key of keys) {
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            // 401 = bad key, 429 = rate-limited → try the backup instead of giving up
            if ((res.status === 401 || res.status === 429) && keys.length > 1) {
                lastErr = new Error(`key rejected (${res.status})`);
                continue;
            }
            return await res.json();
        } catch (e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    return null;
}

async function sentientModeration(chan, nick, message) {
    if (isExempt(nick) || !config.groqKey || message.length < 4) return;
    if (!aiRateOk()) return;                        // busy → scripted filter still covers it
    try {
        const data = await groqChat(({
                model: config.groqModel, temperature: 0, max_tokens: 60,
                messages: [
                    { role: 'system', content: 'You are a strict but fair IRC moderator. Decide if the user message is abusive, harassing, hateful, or threatening. Reply with ONLY compact JSON: {"action":"none|warn|kick","reason":"few words"}. Use "kick" only for severe abuse, slurs, threats or hate; "warn" for insults or mild toxicity; otherwise "none".' },
                    { role: 'user', content: message },
                ],
        }));
        const txt = data?.choices?.[0]?.message?.content || '';
        const m = txt.match(/\{[\s\S]*\}/);
        if (!m) return;
        let verdict;
        try { verdict = JSON.parse(m[0]); } catch (e) { return; }   // fail-safe: never act on unparseable output
        const reason = `AI: ${String(verdict.reason || 'abuse').slice(0, 40)}`;
        if (verdict.action === 'kick') kickUser(chan, nick, reason);
        else if (verdict.action === 'warn') warnUser(chan, nick, reason);
    } catch (e) {
        log('AI', 'moderation error: ' + e.message);
    }
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

// --- Command handler (!! prefix) ---
function handleCommand(chan, nick, message) {
    const args = message.slice(2).trim().split(/\s+/);
    const cmd = (args.shift() || '').toLowerCase();
    const target = args[0];
    const owner = isOwner(nick), admin = isAdmin(nick);
    log('CMD', `${nick} !!${cmd}`);

    switch (cmd) {
        case 'help':
            say(chan, 'Everyone: !!seen <nick>, !!status, !!info [nick], !!rules. '
                + 'Mods: !!join/!!part #room, !!rooms, !!mass kick|ban|voice|devoice, '
                + '!!autoban add|remove|list <mask>, !!strict on|off, !!linkfilter on|off, '
                + '!!raidguard on|off, !!sentient on|off, !!badword add|remove <w>, '
                + '!!whitelist add|remove <nick>, !!announce <msg>.');
            break;
        case 'seen': {
            if (!target) { say(chan, 'Usage: !!seen <nick>'); break; }
            const st = seenUsers[target.toLowerCase()];
            say(chan, st ? `${target} was last active ${ago(st)}.` : `I haven't seen ${target} since I rose.`);
            break;
        }
        case 'status': {
            const up = Math.floor((Date.now() - connectTime) / 1000);
            const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
            say(chan, `Online ${h}h${m}m. Sentient: ${sentientMode ? 'ON' : 'OFF'}. `
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
            say(chan, `${who} — role: ${role}, strikes: ${warns.get(k) || 0}/${config.warnLimit}, `
                + `host: ${hostOf.get(k) || 'unknown'}, `
                + `${whitelist.has(k) ? 'whitelisted (immune)' : 'not whitelisted'}`
                + `${ignored.has(k) ? ', ignored' : ''}, last active: ${seenUsers[k] ? ago(seenUsers[k]) : 'never'}.`);
            break;
        }
        case 'rules':
            say(chan, channelRules || 'Be civil, no slurs, no spam, no unsolicited links. I am always watching. 🦇');
            break;


        // ── Room control ─────────────────────────────────────────────────
        // Joining is not just a JOIN line: the room must also be added to the
        // watched set, or the bot sits there moderating nothing (isOurChannel
        // gates every handler).
        case 'join': {
            if (!admin || !target) { if (admin) say(chan, 'Usage: !!join #room'); break; }
            const room = target.startsWith('#') ? target : '#' + target;
            if (isOurChannel(room)) { say(chan, `Already in ${room}.`); break; }
            channelSet.add(chanKey(room));
            config.channels.push(room);
            send(`JOIN ${room}`);
            send(`PRIVMSG ChanServ :OP ${room} ${currentNick}`);
            send(`WHO ${room}`);
            send(`NAMES ${room}`);
            say(chan, `Drifting into ${room}. 🦇`);
            break;
        }
        case 'part': {
            if (!admin) break;
            const room = target ? (target.startsWith('#') ? target : '#' + target) : chan;
            if (!isOurChannel(room)) { say(chan, `I'm not in ${room}.`); break; }
            send(`PART ${room} :Called away`);
            channelSet.delete(chanKey(room));
            config.channels = config.channels.filter((c) => chanKey(c) !== chanKey(room));
            opped.delete(chanKey(room));
            members.delete(chanKey(room));
            if (chanKey(room) !== chanKey(chan)) say(chan, `Left ${room}.`);
            break;
        }
        case 'rooms':
            if (!admin) break;
            say(chan, `Watching: ${config.channels.map((c) => `${c}${opped.has(chanKey(c)) ? '(op)' : ''}`).join(', ')}`);
            break;

        // ── Mass tools for a raid in progress. Owners, admins, whitelisted
        //    users and the bot itself are never targeted. ─────────────────
        case 'mass': {
            if (!admin) break;
            const action = (args[0] || '').toLowerCase();
            if (!['kick', 'ban', 'voice', 'devoice'].includes(action)) {
                say(chan, 'Usage: !!mass kick|ban|voice|devoice'); break;
            }
            if (!requireOps(chan, `mass ${action}`)) break;
            const targets = [...members.get(chanKey(chan)) || []].filter((n) => !isExempt(n));
            if (!targets.length) { say(chan, 'Nobody eligible — everyone here is protected.'); break; }
            say(chan, `\x0304[MOD]\x03 mass ${action} on ${targets.length} user(s). 🦇`);
            targets.forEach((n, i) => setTimeout(() => {
                if (action === 'kick') send(`KICK ${chan} ${n} :mass kick`);
                else if (action === 'ban') { send(`MODE ${chan} +b ${banMask(n)}`); send(`KICK ${chan} ${n} :mass ban`); }
                else if (action === 'voice') send(`MODE ${chan} +v ${n}`);
                else send(`MODE ${chan} -v ${n}`);
            }, i * 350));                                  // paced: avoids server flood kill
            break;
        }

        // ── Persistent mask rules, enforced on every join ────────────────
        case 'autoban':
            if (!admin) break;
            if (args[0] === 'add' && args[1]) {
                // A bare nick is not a glob: "lucifer" only ever matches the
                // literal string, never "lucifer!user@host", so the rule never
                // fired. Turn a plain nick into a real mask — host-based when
                // we know it (survives a nick change), nick-based otherwise.
                const m = toMask(args[1]);
                autobanMasks.add(m);
                say(chan, `Auto-ban mask added: ${m} (${autobanMasks.size} total).`);
            }
            else if (args[0] === 'remove' && args[1]) {
                const m = autobanMasks.has(args[1]) ? args[1] : toMask(args[1]);
                autobanMasks.delete(m);
                say(chan, `Removed ${m} (${autobanMasks.size} left).`);
            }
            else say(chan, `Auto-ban masks (${autobanMasks.size}): ${[...autobanMasks].join(', ') || '(none)'}. Use !!autoban add|remove <mask>.`);
            break;
            send(`PRIVMSG ChanServ :CLEAR ${chan} BANS`);
            say(chan, '\x0304[MOD]\x03 Clearing every ban via ChanServ.');
            break;

        // ── Toggles ──────────────────────────────────────────────────────
        case 'strict':
            if (!admin) break;
            if (args[0] === 'on') { strictNicks = true; say(chan, '\x0304[MOD]\x03 Strict mode ON — offensive nicks are removed on sight.'); }
            else if (args[0] === 'off') { strictNicks = false; say(chan, 'Strict mode OFF.'); }
            else say(chan, `Strict mode is ${strictNicks ? 'ON' : 'OFF'}. Use !!strict on|off.`);
            break;
        case 'linkfilter':
            if (!admin) break;
            if (args[0] === 'on') { config.linkFilter = true; say(chan, 'Link filter ON.'); }
            else if (args[0] === 'off') { config.linkFilter = false; say(chan, 'Link filter OFF.'); }
            else say(chan, `Link filter is ${config.linkFilter ? 'ON' : 'OFF'}.`);
            break;
        case 'raidguard':
            if (!admin) break;
            if (args[0] === 'on') { raidGuard = true; say(chan, `🛡️ Raid guard ON (${raidJoins} joins / ${raidWindowMs / 1000}s → auto-lock).`); }
            else if (args[0] === 'off') { raidGuard = false; say(chan, 'Raid guard OFF.'); }
            else say(chan, `Raid guard is ${raidGuard ? 'ON' : 'OFF'}.`);
            break;
        case 'sentient':
            if (!admin) { say(chan, 'Access denied.'); break; }
            if (args[0] === 'on') { sentientMode = true; say(chan, '🧠 Sentient moderation ACTIVE — I read the room now.'); }
            else if (args[0] === 'off') { sentientMode = false; say(chan, 'Sentient moderation off — scripted filter still stands guard.'); }
            else say(chan, `Sentient is ${sentientMode ? 'ON' : 'OFF'}.`);
            break;
        case 'badword':
            if (!admin) break;
            if (args[0] === 'add' && args[1]) {
                const w = args[1].toLowerCase();
                if (badwords.has(w)) say(chan, `"${w}" is already in the filter (${badwords.size} words).`);
                else { badwords.add(w); say(chan, `Added "${w}" (${badwords.size} words).`); }
            }
            else if (args[0] === 'remove' && args[1]) { badwords.delete(args[1].toLowerCase()); say(chan, `Removed "${args[1]}" (${badwords.size} total).`); }
            else say(chan, `Filter holds ${badwords.size} words.`);
            break;
        case 'whitelist':
            if (!admin) break;
            if (args[0] === 'add' && args[1]) { whitelist.add(args[1].toLowerCase()); say(chan, `${args[1]} is trusted now — immune to auto-mod. 🩸`); }
            else if (args[0] === 'remove' && args[1]) { whitelist.delete(args[1].toLowerCase()); say(chan, `${args[1]} removed from the whitelist.`); }
            else say(chan, `Whitelist (${whitelist.size}): ${[...whitelist].join(', ') || '(empty)'}.`);
            break;
        case 'announce':
            if (!admin || !args.length) break;
            say(chan, `\x0304[ANNOUNCE]\x03 \x02${args.join(' ')}\x02`);
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
    socket.on('close', () => { connecting = false; opped.clear(); log('INFO', 'Connection closed.'); scheduleReconnect(); });
}
function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectAttempts += 1;
    const delay = Math.min(10000 * 2 ** (reconnectAttempts - 1), 300000); // 10s,20s,40s… cap 5m — avoids connection-flood bans
    log('INFO', `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts}).`);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}

function handleLine(line) {
    if (!line.trim()) return;
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
    if (command === 'NICK' && nick && nick.toLowerCase() === currentNick.toLowerCase()) {
        currentNick = (params[0] || '').replace(/^:/, '') || currentNick;
    }

    if (command === '001') {
        reconnectAttempts = 0;
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
            ready = true;
            log('OK', 'Identified, joined — moderation live.');
        }, 2500);
    }
    if (command === '900' || (command === 'NOTICE' && /identified|logged in/i.test(msg))) {
        if (!hasJoined) config.channels.forEach((c) => send(`JOIN ${c}`));
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
                if (ch === 'o' && who.toLowerCase() === currentNick.toLowerCase()) {
                    if (adding) { opped.add(chanKey(tgt)); log('OK', `Got ops in ${tgt}.`); }
                    else { opped.delete(chanKey(tgt)); log('WARN', `Lost ops in ${tgt}.`); }
                }
            }
        }
    }

    if (command === '353') {                       // NAMES reply -> membership + our own status
        const ch = chanKey(params[2] || '');
        const set = members.get(ch) || new Set();
        for (const raw of (params.slice(3).join(' ').replace(/^:/, '')).split(/\s+/)) {
            const pfx = (raw.match(/^[~&@%+]+/) || [''])[0];
            const n = raw.replace(/^[~&@%+]+/, '');
            if (!n) continue;
            set.add(n);
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
    if (command === 'PART' && nick) (members.get(chanKey(tgt)) || new Set()).delete(nick);
    if (command === 'QUIT' && nick) for (const set of members.values()) set.delete(nick);

    if (command === 'JOIN' && nick.toLowerCase() === config.nick.toLowerCase()) {
        hasJoined = true;
        const c = (tgt || msg).replace(/^:/, '');
        log('OK', `Joined ${c}`);
        send(`PRIVMSG ChanServ :OP ${c} ${currentNick}`);   // claim ops up front
        send(`WHO ${c}`);                                   // learn hosts for real bans
        send(`NAMES ${c}`);                                 // and our own op status
        say(c, '🦇 Dracula stirs. The night watch begins — !!help.');
    } else if (command === 'JOIN' && nick) {
        const c = chanKey((tgt || msg).replace(/^:/, ''));
        if (!isOurChannel(c)) return;
        (members.get(c) || members.set(c, new Set()).get(c)).add(nick);

        // Persistent auto-ban masks — enforced the moment they walk in.
        if (ready && !isExempt(nick) && userHost) {
            const hit = matchesAnyMask(nick, userHost);
            if (hit) {
                log('MOD', `Auto-ban mask ${hit} matched ${nick}!${userHost}`);
                banUser(c, nick, 'auto-ban rule');
                return;
            }
        }
        // Strict mode: an offensive NICK is itself a violation.
        if (ready && strictNicks && !isExempt(nick) && badNick(nick)) {
            log('MOD', `Strict mode: offensive nick ${nick}`);
            kickUser(c, nick, 'offensive nickname');
            return;
        }

        // Raid guard: a burst of joins in a few seconds is a raid, not traffic.
        if (ready && raidGuard) {
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
    if (command === 'KICK' && params[1] && params[1].toLowerCase() === config.nick.toLowerCase()) {
        opped.delete(chanKey(tgt));
        setTimeout(() => send(`JOIN ${tgt}`), 3000);
    }

    if (command === 'PRIVMSG' && isOurChannel(tgt) && nick) {
        seenUsers[nick.toLowerCase()] = Date.now();
        if (!ready) return;                                   // ignore replayed backlog
        if (ignored.has(nick.toLowerCase())) return;          // !!ignore

        if (msg.startsWith('!!')) { handleCommand(tgt, nick, msg); return; }
        if (scriptedModeration(tgt, nick, msg)) return;       // scripted filter first
        if (sentientMode) { sentientModeration(tgt, nick, msg); return; }

        // Not moderating → reply if mentioned by name
        if (new RegExp(`\\b${config.nick}\\b`, 'i').test(msg)) {
            getAIResponse(msg, nick).then((r) => { if (r) say(tgt, `${nick}: ${r}`); });
        }
    }
}

// --- Graceful shutdown (GitHub Actions sends SIGTERM at the 6h timeout) ---
function shutdown(sig) {
    log('INFO', `${sig} — leaving cleanly.`);
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
