// Believing the server about its own limits.
//
// Dracula handled twenty numerics and not 005 — the one where the server states
// its limits, unprompted, on every connect. So every limit was a guess: a
// hardcoded 30 for the nick length, four modes per line under a comment
// admitting "MODES= is usually higher". Guessing low wastes room; guessing high
// gets the line silently truncated, which is how !!help lost its tail.
//
// Here the server says NICKLEN=9. A generated name must FIT — if the bot keeps
// believing its own 30, it asks for Dracula47 and the server rejects the NICK,
// which on the wire is indistinguishable from the name being taken. It would
// then retry, be rejected again, and rotation would quietly never work.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const sent = [];
let registered = false;
let nickLines = [];
let wearing = 'Dracula';
let sock = null;
let log = '';
let bot = null;

const server = net.createServer((s) => {
    sock = s;
    s.setEncoding('utf8');
    const send = (l) => s.write(l + '\r\n');
    let buf = '';
    s.on('error', () => {});
    s.on('data', (d) => {
        buf += d;
        const lines = buf.split('\r\n');
        buf = lines.pop();
        for (const l of lines) {
            sent.push(l);
            if (l.startsWith('NICK')) {
                if (!registered) {
                    registered = true;
                    send(':srv 001 Dracula :welcome');
                    // A real-shaped ISUPPORT, trailing human text and all.
                    send(':srv 005 Dracula AWAYLEN=200 CASEMAPPING=rfc1459 CHANNELLEN=64 '
                       + 'KICKLEN=255 NICKLEN=9 TOPICLEN=330 MODES=20 MONITOR=30 '
                       + ':are supported by this server');
                    send(':srv 376 Dracula :end of motd');
                    continue;
                }
                const want = l.split(' ')[1];
                nickLines.push(want);
                send(`:${wearing}!bot@Sat.Chit.Ananda NICK :${want}`);
                wearing = want;
            }
            if (l.startsWith('JOIN')) {
                send(`:${wearing}!bot@Sat.Chit.Ananda JOIN ${CHAN}`);
                send(`:srv 353 ${wearing} = ${CHAN} :@${wearing} @boss`);
                send(`:srv 366 ${wearing} ${CHAN} :end`);
                send(`:srv MODE ${CHAN} +o ${wearing}`);
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
            IRC_NICK: 'Dracula', IRC_CHANNEL: CHAN,
            OWNERS: 'boss', ADMINS: 'boss',
            NICKSERV_PASS: 'x', NICKSERV_ACCOUNT: 'Vlkram',
            // One name, far longer than the limit the server will state. With
            // the config default of 30 it fits and goes out whole; only a bot
            // that BELIEVED the server's NICKLEN=9 will shorten it.
            NICK_POOL: 'Bartholomewthelonged',
            // NICK_MAXLEN deliberately left at its default 30.
            OUR_HOSTS: 'Sat.Chit.Ananda',
            GROQ_API_KEY: '', SENTIENT_ON: 'off', HOLD_UNINVITED: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', (d) => { log += d; });
    bot.stderr.on('data', (d) => { log += d; });

    const waitFor = (pred, ms = 12000) => new Promise((resolve) => {
        const t0 = Date.now();
        const tick = () => {
            if (pred()) return resolve(true);
            if (Date.now() - t0 > ms) return resolve(false);
            setTimeout(tick, 120);
        };
        tick();
    });

    (async () => {
        await waitFor(() => /Got ops in|Already opped/.test(log), 30000);

        console.log('— the server said NICKLEN=9 —');
        sock.write(`:boss!u@home PRIVMSG ${CHAN} :!!nick now\r\n`);
        await waitFor(() => nickLines.length >= 1);
        const got = nickLines[0] || '';
        c('the generated name fits the limit the server gave',
          got.length > 0 && got.length <= 9,
          `"${got}" is ${got.length} chars against NICKLEN=9 — the config default is 30, `
          + 'so a bot trusting its own config would send the whole 20-character name');
        // CHANGED ON PURPOSE. This used to expect Dracula + digits, from when a
        // rotation was the bot's own name numbered. Rotation now picks a real
        // different name, so the case that proves the limit is believed has to
        // be a name too LONG for it — hence the single long NICK_POOL entry.
        c('and it got there by shortening the name, not by picking a short one',
          /^Bartho\d+$/.test(got),
          `"${got}" — expected the 20-character name cut to fit and numbered`);
        c('the number is what made room for it', /\d/.test(got), `"${got}"`);

        console.log('\n— and it says so when nick folding will be wrong —');
        // Nick comparison here is ASCII lowercase. rfc1459 also folds []\ with
        // {}| , so two nicks we read as different are ONE to the server — a way
        // past every check keyed on a name. Better said out loud than guessed.
        c('an rfc1459 casemapping is reported, not silently ignored',
          /CASEMAPPING is "rfc1459"/.test(log),
          'silence here means being quietly wrong about who is who');

        if (fails) console.log('\n--- bot log tail ---\n' + log.slice(-800));
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        try { bot.kill('SIGKILL'); } catch (e) {}
        server.close();
        process.exit(fails ? 1 : 0);
    })();
});
