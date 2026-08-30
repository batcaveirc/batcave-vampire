// Somebody already in the room when the bot connects never sends a JOIN, so
// extended-join never tells us their account — and auto-voice for a registered
// user depends entirely on knowing it.
//
// Live, twice an hour apart: ishi and Lord are both registered (ishi/ishi,
// LorD/EXTINCT) and neither is in the whitelist. Both sat unvoiced across
// several restarts until the owner voiced them by hand and asked why.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const sent = [];
let bot = null;
let answeredWho = false;

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
            if (l.startsWith('NICK')) { send(':srv 001 D :hi'); send(':srv 376 D :end'); }
            if (l.startsWith('JOIN')) {
                send(`:D!u@h JOIN ${CHAN}`);
                // ishi is ALREADY here — no JOIN for her, so no extended-join.
                send(`:srv 353 D = ${CHAN} :@D ishi`);
                send(`:srv 366 D ${CHAN} :end`);
                send(`:srv MODE ${CHAN} +o D`);
            }
            // The bot asking who these people are is the whole point.
            if (l.startsWith('WHO ') && l.includes(CHAN) && !answeredWho) {
                answeredWho = true;
                send(`:srv 354 D ${CHAN} u host ishi ishi :real`);
                send(`:srv 315 D ${CHAN} :End of WHO`);
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
            IRC_NICK: 'D', IRC_CHANNEL: CHAN, OWNERS: 'vikram',
            WHITELIST: '', AUTO_VOICE: 'on', AUTO_VOICE_REGISTERED: 'on',
            MOD_ENABLED: 'on', RECRUIT_ON: 'off', TRUST_CHANNEL: '',
            GROQ_API_KEY: '', GEMINI_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', () => {});
    bot.stderr.on('data', () => {});

    setTimeout(() => {
        c('it ASKS who the unknown member is', answeredWho,
          'without this their account is never learned and they are never voiced');
        c('and then voices her', sent.some((l) => /^MODE #batcave \+v ishi/i.test(l)),
          sent.filter((l) => l.startsWith('MODE')).join(' | ') || '(no MODE sent)');
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 9000);
});
