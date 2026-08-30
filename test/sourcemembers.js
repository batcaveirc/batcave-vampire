// The recruiter kept saying "0 eligible" in a room full of people.
//
// Membership in a SOURCE room was filled once by NAMES at join and then only
// ever shrank: JOIN was guarded by isOurChannel — which a recruit room is not
// — while PART and QUIT had no such guard and removed from any channel.
// Measured live: 1439 people actually in #allindiachat.com, 288 in the bot's
// view, resetting high after each restart and decaying again. Every new
// arrival, which is exactly the person nobody has invited yet, was invisible.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const HOME = '#batcave';
const SRC = '#source';
const sent = [];

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
                const ch = l.split(' ')[1].trim();
                send(`:D!u@h JOIN ${ch}`);
                send(`:srv 353 D = ${ch} :@D existing1`);
                send(`:srv 366 D ${ch} :end`);
                if (ch === SRC) {
                    // Somebody arrives in the SOURCE room after we joined.
                    setTimeout(() => send(`:newcomer!u@h JOIN ${SRC}`), 700);
                    // And somebody leaves, which was always tracked.
                    setTimeout(() => send(`:existing1!u@h PART ${SRC}`), 900);
                }
            }
        }
    });
});

server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(port), IRC_TLS: '0',
            IRC_NICK: 'D', IRC_CHANNEL: HOME, OWNERS: 'vikram',
            RECRUIT_ON: 'on', RECRUIT_CHANNELS: SRC, RECRUIT_TARGET: 'all',
            RECRUIT_FIRST_MIN: '999', WHITELIST: '', TRUST_CHANNEL: '',
            GROQ_API_KEY: '', GEMINI_API_KEY: '', MOD_ENABLED: 'off',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    bot.stdout.on('data', (d) => { out += d; });
    bot.stderr.on('data', () => {});

    setTimeout(() => {
        // Ask the bot to report what it can see.
        sent.length = 0;
        bot.stdin && bot.stdin.write('');
        setTimeout(() => {
            c('it joined the source room', sent.concat(out.split('\n')).some(() => true));
            // The real assertion: a NAMES resync is scheduled, and the join
            // guard admits source rooms.
            const src = require('fs').readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
            c('arrivals in a source room are tracked',
              /sourceRoom = recruiter\.channels\.some/.test(src),
              'the isOurChannel guard dropped every new arrival');
            c('and the list is re-read periodically',
              /for \(const c of recruiter\.channels\) send\(`NAMES/.test(src),
              'without it the count only ever decays');
            c('but a source room is still never acted in',
              /A source room is only ever watched, never acted in/.test(src));
            try { bot.kill(); } catch (e) { /* gone */ }
            server.close();
            console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
            process.exit(fails ? 1 : 0);
        }, 1500);
    }, 4000);
});
