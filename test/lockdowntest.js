// A regular was handed ops and closed the room. The bot watched.
//
// Live, 06:35–06:37:
//   LiBu gives ops to Lucifer
//   Lucifer has banned R:Vampire        <- extban on the OWNER'S ACCOUNT
//   Lucifer kicked Vikram
//   Lucifer sets +R +u +c +i            <- +i is invite-only: nobody gets in
//   Vikram: "abey ye sab mat kar lucifer" / "wapis badal le"
//
// The owner-protection worked — Vikram was invited back and the bans cleared.
// Nothing touched the lockdown, and the owner had to ask twice, in his own
// room, for it to be undone by hand. Ops are transitive here: any op can make
// another op, so the trust list never gets a say in who ends up holding them.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const sent = [];
let bot = null;

const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    const send = (l) => sock.write(l + '\r\n');
    let buf = '';
    sock.on('data', (d) => {
        buf += d;
        const lines = buf.split('\r\n');
        buf = lines.pop();
        for (const l of lines) {
            sent.push(l);
            if (l.startsWith('NICK')) {
                send(':srv 001 D :welcome');
                send(':srv 376 D :end of motd');
            }
            if (l.startsWith('JOIN')) {
                send(`:D!u@h JOIN ${CHAN}`);
                send(`:srv 353 D = ${CHAN} :@D @Lucifer @Vikram LiBu`);
                send(`:srv 366 D ${CHAN} :end`);
                send(`:srv MODE ${CHAN} +o D`);
                // A trusted op locking the room is legitimate and left alone.
                setTimeout(() => send(`:Vikram!u@h MODE ${CHAN} +m`), 900);
                // An untrusted op doing it is the incident.
                setTimeout(() => send(`:Lucifer!u@h MODE ${CHAN} +i`), 1800);
            }
        }
    });
});

server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(port), IRC_TLS: '0',
            IRC_NICK: 'D', IRC_CHANNEL: CHAN, OWNERS: 'vikram', ADMINS: 'vikram',
            WHITELIST: 'vikram,libu', MOD_ENABLED: 'on', RECRUIT_ON: 'off',
            GROQ_API_KEY: '', GEMINI_API_KEY: '', TRUST_CHANNEL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', () => {});
    bot.stderr.on('data', () => {});

    setTimeout(() => {
        const modes = sent.filter((l) => l.startsWith('MODE ' + CHAN));
        c('the untrusted op\'s +i is reverted', modes.some((m) => /-i\b/.test(m)),
          modes.join(' | ') || '(the bot sent no MODE at all)');
        c('a trusted op\'s +m is left alone', !modes.some((m) => /-m\b/.test(m)),
          'reverting a legitimate op starts a mode war');
        const reverts = modes.filter((m) => /-i\b/.test(m));
        c('reverted once, not in a loop', reverts.length === 1, `${reverts.length} reverts`);
        c('the owners are told who did it',
          sent.some((l) => /NOTICE vikram/i.test(l) && /Lucifer/.test(l)),
          'a silent revert leaves nobody knowing ops are in the wrong hands');

        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 6000);
});
