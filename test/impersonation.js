// Wearing a regular's name to abuse people under it.
//
// clonesARegular() only ever fired when the nick ALSO contained a slur —
// "NangiPoojaBhabhi" — and returned null otherwise, which is most of them.
// The plain form is the more damaging one: wear "Lisaa_", abuse the room for
// ten minutes, and what people remember is LISAA doing it.
//
// And screenNick ran on JOIN and nowhere else, so the entire check was one
// rename away from useless.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const sent = [];
let live = null;
let staged = false;

const server = net.createServer((sock) => {
    live = sock;
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    const send = (l) => { try { (live || sock).write(l + '\r\n'); } catch (e) { /* gone */ } };
    let buf = '';
    sock.on('data', (d) => {
        buf += d;
        const lines = buf.split('\r\n');
        buf = lines.pop();
        for (const l of lines) {
            sent.push(l);
            if (l.startsWith('NICK')) { send(':srv 001 D :hi'); send(':srv 376 D :end'); }
            if (l.startsWith('JOIN')) {
                send(`:D!u@h JOIN ${CHAN}`);
                send(`:srv 353 D = ${CHAN} :@D lisaa`);
                send(`:srv 366 D ${CHAN} :end`);
                send(`:srv MODE ${CHAN} +o D`);
                if (staged) continue;
                staged = true;
                // 1. a leet lookalike walks in
                setTimeout(() => send(':L1saa!u@h2 JOIN ' + CHAN + ' * :real'), 2500);
                // 2. a suffixed one
                setTimeout(() => send(':Lisaa2!u@h3 JOIN ' + CHAN + ' * :real'), 4000);
                // 3. somebody ordinary, who must be left alone
                setTimeout(() => send(':rahul_k!u@h4 JOIN ' + CHAN + ' * :real'), 5500);
                // 4. THE BYPASS: join clean, then rename onto her name
                setTimeout(() => send(':Guest41!u@h5 JOIN ' + CHAN + ' * :real'), 7000);
                setTimeout(() => send(':Guest41!u@h5 NICK :Lisaa_'), 8500);
                // 5. the real person, logged in as her account, on a second nick
                setTimeout(() => send(':Lisaa|away!u@h6 JOIN ' + CHAN + ' lisaa :real'), 10000);
                // 6. OUR OWN scenery, whose name pool can collide with a
                //    regular's by coincidence — nidhi, zoya, tara, sana are
                //    all in it. It must never be accused of impersonation.
                setTimeout(() => send(':Lisaa11!u@h7 JOIN ' + CHAN + ' * :real'), 11000);
                setTimeout(() => send(':srv 354 D ' + CHAN + ' u h7 Lisaa11 0 :BatCave community member'), 11200);
            }
        }
    });
});

server.listen(0, '127.0.0.1', () => {
    const bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(server.address().port), IRC_TLS: '0',
            IRC_NICK: 'D', IRC_CHANNEL: CHAN, OWNERS: 'vikram',
            WHITELIST: 'lisaa', TRUST_CHANNEL: '', MOD_ENABLED: 'on',
            STRICT_NICKS: 'on', RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
            CHORUS_MARK: 'BatCave community member',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', () => {});
    bot.stderr.on('data', () => {});

    setTimeout(() => {
        const all = sent.join('\n');
        const acted = (who) => new RegExp(`(KICK ${CHAN} ${who}|MODE ${CHAN} \\+b [^\\n]*${who})`, 'i').test(all);
        c('a leet lookalike is removed', acted('L1saa'),
          sent.filter((l) => /KICK|\+b/.test(l)).join(' | ') || '(nothing done)');
        c('a suffixed lookalike is removed', acted('Lisaa2'),
          sent.filter((l) => /KICK|\+b/.test(l)).join(' | '));
        c('THE BYPASS: renaming onto her name is caught too', acted('Lisaa_'),
          sent.filter((l) => /KICK|\+b/.test(l)).join(' | ')
          + ' — screenNick ran on JOIN only, so this was one rename away from useless');
        c('the room is told it was not her', /is not \x02lisaa\x02/i.test(all) || /is not .?lisaa/i.test(all),
          'a removal nobody explains leaves the accusation standing');
        c('an ordinary newcomer is left alone', !acted('rahul_k'),
          sent.filter((l) => /rahul/i.test(l)).join(' | '));
        c('our own scenery is never accused of it',
          !acted('Lisaa11'),
          sent.filter((l) => /Lisaa11/i.test(l)).join(' | ')
          + ' — its name pool can collide with a regular by coincidence');
        c('and the REAL person on a second nick is left alone', !acted('Lisaa\\|away'),
          sent.filter((l) => /away/i.test(l)).join(' | ')
          + ' — logged in as her account, so it is her');
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 16000);
});
