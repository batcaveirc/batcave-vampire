// Somebody's NAME is not a slur.
//
// Live, from a full run's log:
//
//   [AI] Aishwarya [trusted] → ban (AI: slur) quote="Khadus"
//   [AI] COOL MODE — would ban Aishwarya (AI: slur); reporting only.
//
// "khadus" is another regular in that room — registered since 2019 — and an
// ordinary Hindi word for someone grumpy. The model read a person's name as a
// slur and wanted a BAN, against a trusted regular. Only cool mode stopped it;
// her standing did not, because the verdict path runs before that matters. With
// the model acting, Gate 5 caps an AI ban at a warning, so the cost is a public
// warning for saying somebody's name in the room they are standing in.
//
// A false positive is worse than a miss here. Users forgive a filter that misses
// something; they leave over one that punishes them wrongly — and the deterministic
// word list still bans real slurs, so nothing is lost by refusing to take the
// model's word for it when its only evidence is a name.
const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A model that calls everything a slur and quotes whatever it was given. The
// point is not that this model is bad — it is that the bot must not act on this
// evidence however confident the model sounds.
const stub = path.join(os.tmpdir(), `slurstub-${process.pid}.js`);
fs.writeFileSync(stub, `
const orig = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('api.groq.com')) {
    let said = '';
    try {
      const body = JSON.parse(opts.body);
      said = (body.messages || []).map((m) => m.content).join(' ');
    } catch (e) { /* shape changed; the quote just stays empty */ }
    const last = (said.match(/([A-Za-z0-9_]+)\\s*$/) || [])[1] || '';
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: {
      content: JSON.stringify({ action: 'ban', confident: true, quote: last, reason: 'slur' }),
    } }] }) };
  }
  return orig(url, opts);
};
`);

const out = [];
let sock = null;
const srv = net.createServer((s) => {
    sock = s;
    s.on('error', () => {});
    s.on('data', (d) => {
        for (const l of String(d).split('\r\n')) {
            if (!l) continue;
            out.push(l);
            if (l.startsWith('NICK')) {
                s.write(':srv 001 Dracula :hi\r\n:srv 376 Dracula :End\r\n');
            }
            const j = l.match(/^JOIN (\S+)/);
            if (j) { s.write(`:Dracula!u@h JOIN ${j[1]}\r\n`); }
        }
    });
});

srv.listen(0, '127.0.0.1', async () => {
    const bot = spawn('node', ['-r', stub, path.join(__dirname, '..', 'action-bot.js')], {
        cwd: __dirname,
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(srv.address().port), IRC_TLS: 'off',
            IRC_NICK: 'Dracula', IRC_CHANNEL: '#batcave', OWNERS: 'boss',
            MODERATED_ROOMS: '#batcave', WHITELIST: '', TRUST_CHANNEL: '',
            GROQ_API_KEY: 'test-key', GEMINI_API_KEY: '', SENTIENT_ON: 'on', FUN_ON: 'off',
            RECRUIT_ON: 'off', MOD_ENABLED: 'on',
            // The model must be ALLOWED to act, or this test proves only that
            // cool mode works — which is what saved the room live, by luck.
            AI_ACTIVE: 'on',
            BADWORDS: '', SEVERE_WORDS: 'genuinelyaslur',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    bot.stdout.on('data', (d) => { log += d; });
    bot.stderr.on('data', (d) => { log += d; });

    await wait(6500);
    sock.write(':srv 353 Dracula = #batcave :@Dracula boss aishwarya khadus stranger\r\n');
    sock.write(':srv 366 Dracula #batcave :End\r\n');
    await wait(2500);

    console.log('— the model calls a regular\'s NAME a slur —');
    out.length = 0;
    sock.write(':aishwarya!a@h PRIVMSG #batcave :arre yaar kaha ho aaj khadus\r\n');
    await wait(4000);
    c('nobody is kicked, banned or quieted for it',
      !out.some((l) => /^(KICK|MODE #batcave \+[bq])/.test(l)),
      out.filter((l) => /^(KICK|MODE)/.test(l)).join(' | '));
    c('and the log says WHY it was ignored',
      /names somebody here|is a nick|rather than being it/i.test(log),
      log.split('\n').filter((l) => /\[AI\]/.test(l)).slice(-3).join(' | ') || '(silent)');

    console.log('\n— including a name it is not standing next to —');
    out.length = 0;
    // Not in the room right now, but seen speaking here — the same person after
    // a disconnect, which is most of this room most of the time.
    sock.write(':khadus!k@h PRIVMSG #batcave :hello everyone\r\n');
    await wait(1500);
    sock.write(':khadus!k@h PART #batcave\r\n');
    await wait(500);
    out.length = 0;
    sock.write(':aishwarya!a@h PRIVMSG #batcave :arre yaar kaha ho aaj khadus\r\n');
    await wait(4000);
    c('still not punished', !out.some((l) => /^(KICK|MODE #batcave \+[bq])/.test(l)),
      out.filter((l) => /^(KICK|MODE)/.test(l)).join(' | '));

    console.log('\n— but a real slur is still caught —');
    out.length = 0;
    // Deterministic, from the word list — the path this gate must not weaken.
    sock.write(':stranger!s@h PRIVMSG #batcave :you genuinelyaslur\r\n');
    await wait(4000);
    c('the word list still acts',
      out.some((l) => /^(KICK|MODE #batcave \+[bq])/.test(l)),
      out.filter((l) => /^(KICK|MODE|PRIVMSG #batcave)/.test(l)).join(' | ') || '(nothing happened)');

    if (process.env.SHOW_LOG) console.log('\n--- bot log ---\n' + log.split('\n').filter((l) => /AI|MOD|WARN/.test(l)).join('\n'));
    try { bot.kill(); } catch (e) { /* gone */ }
    try { fs.unlinkSync(stub); } catch (e) { /* gone */ }
    srv.close();
    console.log(f ? `\n${f} FAILED` : '\nALL PASS');
    process.exit(f ? 1 : 0);
});
