// Held back, not thrown out — the owner's transcript, driven.
//
//   ⓘ ChanBot gives voice to Priya35
//   @ Dracula  Priya35: You had one job here — be tolerable — and you fumbled
//              it immediately.
//   ← Priya35 was kicked from #batcave by Dracula
//
// "instead of removing them i think keeping them devoice is better option so
// normal mods can give her voice and let her talk. and also these message are
// annoying for other users."
//
// Three separate wrongs in four lines: a newcomer kicked for arriving, an insult
// aimed at somebody who had not spoken, and the room made to watch both. And the
// voice came from CHANBOT, so the bot's own "does this person deserve voice"
// check never ran — which is also why a known spammer from another room
// (fahadkhan, in #allindiachat.com) ended up voiced here.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (l) => l.replace(/\x03\d{0,2}(,\d{1,2})?|[\x02\x0f]/g, '');

const GUARDED = '4900.2401.IP';
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
                s.write(':srv 001 Dracula :hi\r\n');
                s.write(':srv 900 Dracula Dracula!u@h Vlkram :logged in\r\n');
                s.write(':srv 376 Dracula :End\r\n');
            }
            const j = l.match(/^JOIN (\S+)/);
            if (j) {
                s.write(`:Dracula!u@h JOIN ${j[1]}\r\n`);
                s.write(`:srv 353 Dracula = ${j[1]} :@Dracula @Vikram\r\n`);
                s.write(`:srv 366 Dracula ${j[1]} :End\r\n`);
            }
        }
    });
});

srv.listen(0, '127.0.0.1', async () => {
    const bot = spawn('node', [path.join(__dirname, '..', 'action-bot.js')], {
        cwd: __dirname,
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(srv.address().port), IRC_TLS: 'off',
            IRC_NICK: 'Dracula', IRC_CHANNEL: '#batcave', OWNERS: 'boss',
            MODERATED_ROOMS: '#batcave', WHITELIST: 'oldhand', TRUST_CHANNEL: '',
            GROQ_API_KEY: '', GEMINI_API_KEY: '', SENTIENT_ON: 'off', FUN_ON: 'off',
            RECRUIT_ON: 'off', MOD_ENABLED: 'on', AUTO_VOICE: 'on',
            GUARDED_HOSTS: GUARDED,
                // The arrival hold is OFF by default now — withholding voice
                // from newcomers cost the room more than it caught. The
                // feature remains for a room under attack, so it is switched
                // on HERE, where it is the thing being tested.
                HOLD_UNINVITED: 'on',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    bot.stdout.on('data', (d) => { log += d; });
    bot.stderr.on('data', (d) => { log += d; });
    await wait(7000);

    console.log('— an unregistered arrival from the guarded range —');
    out.length = 0;
    sock.write(`:Priya35!webchat@8n1k4o.7820.b2sj.${GUARDED} JOIN #batcave\r\n`);
    sock.write(':srv 354 Dracula 152 #batcave webchat 8n1k4o.7820.b2sj.4900.2401.IP Priya35 0 :0 real\r\n');
    await wait(9000);
    c('she is NOT kicked', !out.some((l) => /^KICK #batcave Priya35/.test(l)),
      out.filter((l) => /KICK/.test(l)).join(' | '));
    c('and nothing at all is said in the room',
      !out.some((l) => /^PRIVMSG #batcave/.test(l)),
      out.filter((l) => /^PRIVMSG #batcave/.test(l)).map(plain).join(' | ')
        || '');
    c('she is left without voice', !out.some((l) => /^MODE #batcave \+v Priya35/.test(l)),
      out.filter((l) => /MODE #batcave [+-]v/.test(l)).join(' | '));
    // The part that was silently missing. holdBack() used to consult its own
    // prefix map first, and ChanBot voices an arrival in the same instant it
    // joins, so the map said "no voice" and the removal was skipped — nine
    // holds in one live run produced zero MODE -v.
    c('the voice is actually TAKEN, not just recorded as held',
      out.some((l) => /^MODE #batcave -v Priya35$/m.test(l)),
      out.filter((l) => /MODE #batcave/.test(l)).join(' | ') || '(held on paper only)');
    // ...and a guarded range IS worth interrupting somebody about.
    // CHANGED on the owner's instruction, 2026-09-15: "remove that messsage if it
    // is too repetative as voicing a user any mod can do that they dont need to be
    // informed." An unvoiced newcomer is visible in the room, so the notice
    // reported something already on screen — and every notice is a line of
    // outbound traffic that buried the bot's real output. Holds are logged, not
    // announced. HOLD_TELL_MODS=on brings the messages back.
    c('and NOBODY is messaged about it — not her, not the mods',
      !out.some((l) => /^(NOTICE|PRIVMSG) (Priya35|Vikram|boss)/.test(l)),
      out.filter((l) => /^(NOTICE|PRIVMSG) [^#]/.test(l)).map(plain).join(' | ')
        + ' — a hold should cost one MODE and nothing else');

    console.log('\n— ChanBot voices her anyway, as it did live —');
    out.length = 0;
    sock.write(':ChanBot!c@srv MODE #batcave +v Priya35\r\n');
    await wait(3000);
    c('the voice is taken back',
      out.some((l) => /^MODE #batcave -v Priya35/.test(l)),
      out.filter((l) => /MODE #batcave/.test(l)).join(' | ') || '(ChanBot overrode the hold)');
    c('still without a word in the room',
      !out.some((l) => /^PRIVMSG #batcave/.test(l)),
      out.filter((l) => /^PRIVMSG #batcave/.test(l)).map(plain).join(' | '));

    console.log('\n— a moderator decides she is fine —');
    out.length = 0;
    sock.write(':Vikram!v@h MODE #batcave +v Priya35\r\n');
    await wait(3000);
    c('the hold is released', /hold released/i.test(log),
      log.split('\n').filter((l) => /hold/i.test(l)).slice(-2).join(' | ') || '(still held)');
    c('and the bot does NOT take a moderator\'s voice away',
      !out.some((l) => /^MODE #batcave -v Priya35/.test(l)),
      out.filter((l) => /MODE #batcave/.test(l)).join(' | '));

    console.log('\n— somebody heard spamming another room —');
    out.length = 0;
    // What watch.js is for: fahadkhan advertising in a room Dracula only listens
    // in. Live he was voiced here regardless, because ChanBot granted it.
    sock.write(':fahadkhan!f@h PRIVMSG #allindiachat.com :join #batcave now free girls http://x.example\r\n');
    await wait(1500);
    sock.write(':fahadkhan!f@h JOIN #batcave\r\n');
    await wait(2000);
    out.length = 0;
    sock.write(':ChanBot!c@srv MODE #batcave +v fahadkhan\r\n');
    await wait(3000);
    c('his voice is taken back too',
      out.some((l) => /^MODE #batcave -v fahadkhan/.test(l)),
      out.filter((l) => /MODE #batcave/.test(l)).join(' | ') || '(voiced despite being watched)');
    c('and he is not messaged about it either',
      !out.some((l) => /^(NOTICE|PRIVMSG) fahadkhan/.test(l)),
      out.filter((l) => /^(NOTICE|PRIVMSG) fahadkhan/.test(l)).map(plain).join(' | ')
        + ' — one notice per arrival is what buried the bot');
    c('but the moderators are NOT interrupted for a routine newcomer',
      !out.some((l) => /^NOTICE (Vikram|boss)/.test(l) && /fahadkhan/.test(plain(l))),
      out.filter((l) => /^NOTICE (Vikram|boss)/.test(l)).map(plain).join(' | ')
        + ' — one per arrival is the flood this feature exists to remove');
    c('and nothing about him is said in the room either',
      !out.some((l) => /^PRIVMSG #batcave/.test(l)),
      out.filter((l) => /^PRIVMSG #batcave/.test(l)).map(plain).join(' | '));

    console.log('\n— and a trusted regular is never touched —');
    out.length = 0;
    sock.write(`:oldhand!webchat@zz.${GUARDED} JOIN #batcave\r\n`);
    await wait(8000);
    c('no hold, no devoice, nothing said',
      !out.some((l) => /-v oldhand/.test(l)) && !/Holding oldhand/.test(log),
      out.filter((l) => /oldhand/.test(l)).join(' | '));

    try { bot.kill(); } catch (e) { /* gone */ }
    srv.close();
    console.log(f ? `\n${f} FAILED` : '\nALL PASS');
    process.exit(f ? 1 : 0);
});
