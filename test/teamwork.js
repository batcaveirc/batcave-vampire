// Phase 2+3: memory + inter-bot trust protocol — pure-logic tests.
//
// action-bot.js is a massive module that connects on load, so we re-expose the
// pure helpers via a tiny harness: we load it in a sandbox where network I/O
// is stubbed, then exercise rememberLine / memoryForPrompt / handleTrustLine
// / trustSend / partnerIsSilent against the resulting module state.
//
// Only pure state is checked — nothing fires a timer or opens a socket.

process.env.MEMORY_TTL_MS = '2000';       // 2s so the TTL test does not sleep for days
process.env.MEMORY_MAX_PER_USER = '4';
process.env.MEMORY_MIN_LEN = '10';
process.env.TRUST_CHANNEL = '#batcave-trust';
// A tiny harness: stub out net, tls and dns so action-bot does not try to
// connect on require(). We only want the module's exported closures.
const Module = require('module');
const path = require('path');
const originalResolve = Module._resolveFilename;
const originalRequire = Module.prototype.require;
const sentLines = [];
Module.prototype.require = function (id) {
    // Stub tls.connect — a no-op socket that captures writes.
    if (id === 'tls' || id === 'net') {
        const fakeSocket = {
            setEncoding() {}, setTimeout() {}, setKeepAlive() {},
            on() { return this; }, once() { return this; }, write(line) { sentLines.push(line); return true; },
            end() {}, destroy() {}, writable: true,
            removeAllListeners() {}, pipe() {},
        };
        return { connect: () => fakeSocket, Socket: function () { return fakeSocket; } };
    }
    return originalRequire.call(this, id);
};
// action-bot does not actually export anything — its surface is global by
// design. To test pure helpers we export a backdoor by evaluating against a
// mock scope. Simpler path: run assertions on OBSERVABLE behaviour via
// re-reading the source file for the helpers we care about and running them
// in isolation.
Module.prototype.require = originalRequire;

const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

// Static source assertions — the kind of thing helpcoverage.js enforces:
// the helpers exist, and the hooks call them.
console.log('— the helpers are in place —');
c('rememberLine is defined', /function rememberLine\(/.test(src));
c('memoryForPrompt is defined', /function memoryForPrompt\(/.test(src));
c('trustSend is defined', /function trustSend\(/.test(src));
c('handleTrustLine is defined', /function handleTrustLine\(/.test(src));
c('startTrustTeamwork is defined', /function startTrustTeamwork\(/.test(src));
c('rememberLine is CALLED from the home-room PRIVMSG path',
  /rememberLine\(nick, msg,\s*\{ room: tgt \}\)/.test(src));
c('rememberLine is also CALLED from the recruit-room PRIVMSG path (cross-room memory)',
  src.split(/rememberLine\(nick, msg,\s*\{ room: tgt \}\)/).length >= 3);
c('memoryForPrompt is CALLED from getAIResponse',
  /memoryForPrompt\(who\)/.test(src));
c('trust-channel PRIVMSGs are short-circuited BEFORE isOurChannel',
  src.indexOf('handleTrustLine(nick, msg)') < src.indexOf("if (command === 'PRIVMSG' && isOurChannel"));
c('owner recognition is in the system prompt (names Vikram)', /VIKRAM is your creator/.test(src));
c('owner recognition names the IRC alias "Vampire"', /alias is "Vampire"/.test(src));
c('self-restart dispatcher is wired to shutdown()',
  /await dispatchSuccessor\(sig\)/.test(src));
c('self-restart dispatcher is wired to the blocked-IP exit path',
  /await dispatchSuccessor\(.blocked-IP.\)/.test(src));

// Pure-function tests: hoist the helpers out of the module source into an
// isolated sandbox. We only need the constants and the functions themselves
// — not any of the IRC/socket wiring. This is the same approach as the
// nickname-filter test.
console.log('\n— pure-function behaviour —');
const { Module: Mod } = require('module');
const vm = require('vm');
// Build a tiny module that re-exports the helpers.
function slice(name, kind = 'function') {
    const re = new RegExp(`${kind} ${name}\\(([^)]*?)\\)\\s*\\{`);
    const start = src.search(re);
    if (start < 0) throw new Error(`cannot find ${name}`);
    // Find the matching closing brace by depth count.
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error('unbalanced');
}
const script = `
    const MEMORY_MAX_PER_USER = Number(process.env.MEMORY_MAX_PER_USER);
    const MEMORY_TTL_MS = Number(process.env.MEMORY_TTL_MS);
    const MEMORY_MIN_LEN = Number(process.env.MEMORY_MIN_LEN);
    const PARTNER_SILENT_MS = 60000;
    const userMemory = new Map();
    const sawRecently = new Map();           // dedupe for rememberLine
    const TRUST_BROADCAST_HISTORY = [];      // rate-limit for ::saw
    let currentNick = 'DarkCloud';
    let partnerLastSeen = 0;
    const isOneOfOurs = (n) => /^(darkcloud|nosferatu|andromeda)$/i.test(n);
    const sent = [];
    const send = (line) => sent.push(line);
    const log = () => {};                     // pruneMemory logs; stub it
    const TRUST_CHANNEL = '#batcave-trust';
    // In production, config.channels is the IRC_CHANNEL list — home + emoji.
    // In the sandbox we hard-code the pair so isHomeChannelRoom works.
    const config = { channels: ['#batcave', '#\u{1F171}\u{1F170}\u{1F164}\u{1F163}\u{1F170}\u{1F185}\u{1F164}'] };
    ${slice('rememberLine')}
    ${slice('isHomeChannelRoom')}
    ${slice('trustBroadcastOk')}
    ${slice('memoryForPrompt')}
    ${slice('trustSend')}
    ${slice('handleTrustLine')}
    ${slice('pruneMemory')}
    ({ rememberLine, memoryForPrompt, trustSend, handleTrustLine, pruneMemory,
       isHomeChannelRoom, trustBroadcastOk,
       state: { userMemory, sawRecently, sent, getPartnerLastSeen: () => partnerLastSeen,
                getBroadcastHistory: () => TRUST_BROADCAST_HISTORY } });
`;
const api = vm.runInNewContext(script, { process, Map, Set, Date, JSON, console });

api.rememberLine('Shweta0', 'my knee hurts after yesterdays run, going to rest');
api.rememberLine('Shweta0', 'ok');                               // too short
api.rememberLine('Shweta0', '!!help');                           // command
api.rememberLine('Shweta0', 'https://example.com');              // URL-only
api.rememberLine('Shweta0', 'feeling a bit better this morning');
let got = api.state.userMemory.get('shweta0') || [];
c('notable lines kept', got.length === 2, `got ${got.length}: ${got.map(e => e.text).join(' | ')}`);
c('short line skipped', !got.some(e => e.text === 'ok'));
c('command skipped', !got.some(e => e.text.startsWith('!!')));
c('URL-only skipped', !got.some(e => e.text.startsWith('http')));

// Bounded ring
api.state.userMemory.clear();
for (let i = 0; i < 10; i++) api.rememberLine('Priya', `this is message number ${i}, enough chars`);
got = api.state.userMemory.get('priya') || [];
c('ring stops at MEMORY_MAX_PER_USER', got.length === 4, `got ${got.length}`);
c('newest kept, oldest dropped', got[got.length - 1].text.endsWith('number 9, enough chars'));

// Self and other-bot never remembered
api.state.userMemory.clear();
api.rememberLine('DarkCloud', 'I would never remember myself anyway');
api.rememberLine('Nosferatu', 'and not a rotation nick either');
api.rememberLine('Andromeda', 'and not the other bot');
c('own nick skipped', !api.state.userMemory.has('darkcloud'));
c('other-bot nicks skipped',
  !api.state.userMemory.has('nosferatu') && !api.state.userMemory.has('andromeda'));

// memoryForPrompt drops the LAST line and tags ages
api.state.userMemory.clear();
api.rememberLine('riya', 'I injured my knee last week during the hike');
api.rememberLine('riya', 'it is slowly getting better each day');
api.rememberLine('riya', 'sorry for talking about it so much lately');     // this one drops
let out = api.memoryForPrompt('riya');
c('non-empty when there is older context', out.length > 0, out);
c('drops the most recent line (the one being replied to)',
  !out.includes('sorry for talking'), out);
c('has human-friendly ago tag', /\[\d+[mhd]\s+ago\]/.test(out), out);
// Case-insensitive key: both lookups must hit the same ring. The DISPLAY uses
// the as-typed nick (that is what the model should address them by), so the
// strings differ only in the name — compare the body-after-the-name instead.
{
    const upper = api.memoryForPrompt('Riya');
    const lower = api.memoryForPrompt('riya');
    const bodyOnly = (s) => s.replace(/What \S+ has recently said/, 'WHAT');
    c('case-insensitive key (same memory, different displayed name)',
      upper.length > 0 && lower.length > 0 && bodyOnly(upper) === bodyOnly(lower));
}

// TTL
api.state.userMemory.clear();
api.rememberLine('fade', 'this is an old message that will expire soon');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
    await wait(2300);                                               // past TTL_MS
    api.rememberLine('fade', 'and this is the live one right now');
    const out2 = api.memoryForPrompt('fade');
    c('expired entry gone, live kept', !out2.includes('old message') && !out2.includes('expire'),
      out2);
    c('single live entry = empty recall (nothing OLDER)', out2 === '', out2);

    // Trust protocol
    api.handleTrustLine('DarkCloud', '::hb {"n":"DarkCloud","t":1}');
    c('self heartbeat ignored', api.state.getPartnerLastSeen() === 0);
    api.handleTrustLine('Andromeda', '::hb {"n":"Andromeda","t":2}');
    c('partner heartbeat recorded', api.state.getPartnerLastSeen() > 0);

    api.state.sent.length = 0;
    api.trustSend('hb', { n: 'DarkCloud', t: 1759000000 });
    const sent = api.state.sent.filter((l) => l.startsWith('PRIVMSG #batcave-trust'));
    c('_trust_send writes exactly one line', sent.length === 1, api.state.sent.join('\n'));
    c('prefix is ::hb so bots filter it', sent[0].includes('::hb '));
    c('JSON is compact (no spaces)', !/" "/.test(sent[0]) && !/, /.test(sent[0]), sent[0]);

    // Chatter — ignored
    const before = api.state.getPartnerLastSeen();
    api.handleTrustLine('Vikram', 'hey are you two up?');
    api.handleTrustLine('Vikram', ':: this is not a valid machine line');
    api.handleTrustLine('Andromeda', '::hb {not valid json');
    c('human chatter ignored', api.state.getPartnerLastSeen() === before);

    // ─── ::saw merge: partner saw a line, merge into local memory
    console.log('\n— ::saw merges partner observation (no re-broadcast) —');
    api.state.userMemory.clear();
    api.state.sent.length = 0;
    api.handleTrustLine('Andromeda',
      '::saw {"n":"shweta0","m":"my knee is better today, thanks","r":"#batcave","t":1}');
    let g = api.state.userMemory.get('shweta0') || [];
    c('remote ::saw stored in local memory', g.length === 1, `got ${g.length}`);
    c('room tagged (for diagnostics)', g[0] && g[0].room === '#batcave');
    c('remote ::saw does NOT re-broadcast (loop guard)',
      !api.state.sent.some((l) => l.includes('::saw ')),
      api.state.sent.join('\n'));

    console.log('\n— dedupe: local line + its ::saw echo coalesce —');
    api.state.userMemory.clear();
    api.state.sent.length = 0;
    api.rememberLine('priya', 'the restaurant on 5th street was lovely');
    api.handleTrustLine('Andromeda',
      '::saw {"n":"priya","m":"the restaurant on 5th street was lovely","r":"#batcave","t":1}');
    g = api.state.userMemory.get('priya') || [];
    c('one entry, not two (deduped by nick+text)', g.length === 1, `got ${g.length}`);

    console.log('\n— cross-room: room tag stored, prompt hides room —');
    api.state.userMemory.clear();
    api.state.sent.length = 0;
    api.rememberLine('rinki', 'I think I will skip dinner tonight actually', { room: '#chatindian' });
    g = api.state.userMemory.get('rinki') || [];
    c('cross-room line stored', g.length === 1);
    c('room tag preserved', g[0] && g[0].room === '#chatindian');
    // ★ THE RECV-Q FIX: a recruit-room line must NOT broadcast ::saw, or busy
    // rooms blow the send pacer and the server flood-kills us. Caught live on
    // 2026-10-06 (Carfax dropped with "RecvQ exceeded").
    const sawFromCross = api.state.sent.filter((l) => l.includes('::saw '));
    c('cross-room capture does NOT broadcast ::saw (recv-queue safety)',
      sawFromCross.length === 0, api.state.sent.join('\n'));
    // Prompt only draws from OLDER lines, so add two more then check.
    api.rememberLine('rinki', 'yesterday was long, might sleep in', { room: '#chatindian' });
    api.rememberLine('rinki', 'ok heading out for a bit, bbl', { room: '#batcave' });
    const prompt = api.memoryForPrompt('rinki');
    c('recall is non-empty with older lines', prompt.length > 0);
    c('recall does NOT reveal the room — model gets content only',
      !prompt.includes('#chatindian') && !prompt.includes('#batcave'), prompt);

    console.log('\n— home-channel capture DOES broadcast ::saw —');
    api.state.userMemory.clear();
    api.state.sent.length = 0;
    api.rememberLine('priya', 'the dinner was delicious tonight', { room: '#batcave' });
    const sawFromHome = api.state.sent.filter((l) => l.includes('::saw '));
    c('home-channel ::saw IS broadcast', sawFromHome.length === 1,
      api.state.sent.join('\n'));

    console.log('\n— rate-limit: >20 ::saw in 60s drops the excess —');
    api.state.userMemory.clear();
    api.state.sent.length = 0;
    api.state.sawRecently.clear();                       // let fresh lines through dedupe
    api.state.getBroadcastHistory().length = 0;          // start the token bucket from empty
    for (let i = 0; i < 30; i++) {
        api.rememberLine('speaker' + i, 'line number ' + i + ' with enough chars', { room: '#batcave' });
    }
    const sawBroadcasts = api.state.sent.filter((l) => l.includes('::saw ')).length;
    c('at most 20 ::saw broadcasts in a burst', sawBroadcasts === 20, 'broadcast ' + sawBroadcasts);

    console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
    process.exit(fails ? 1 : 0);
})();
