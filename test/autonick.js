// Rotating with NOTHING configured.
//
// The owner rejected the pool-and-NickServ-GROUP approach outright: "i dont
// want to do this manually i want it to be done by the bot itself that it can
// change to a different id can add a number on back of it to avoid any
// conflicts. there is always a way around these things."
//
// He is right, and the numbering is the part that makes it work. Dracula47 is
// almost certainly not REGISTERED to anybody, so NickServ has no reason to
// force-rename us to a Guest — which is the failure that made a hand-picked
// pool need checking and grouping in the first place. It is also still
// obviously the bot, which a random name off a list is not.
//
// So this suite passes no NICK_POOL and no NICK_ROTATE at all. If it needs
// either to work, it is not the feature that was asked for.
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
let bot = null;
let sock = null;
let log = '';

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

const say = (t) => { if (sock) sock.write(`:boss!u@home PRIVMSG ${CHAN} :${t}\r\n`); };
const said = () => sent.filter((l) => l.startsWith('NOTICE boss')).join('\n');

server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(port), IRC_TLS: '0',
            IRC_NICK: 'Dracula', IRC_CHANNEL: CHAN,
            OWNERS: 'boss', ADMINS: 'boss',
            NICKSERV_PASS: 'x', NICKSERV_ACCOUNT: 'Vlkram',
            // Deliberately absent: NICK_ROTATE, NICK_POOL.
            NICK_MAX_PER_HOUR: '4',
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

        console.log('— with nothing configured at all —');
        let n = said().length;
        say('!!nick status');
        await waitFor(() => /Rotation (on|off)/.test(said().slice(n)));
        c('rotation is ON without anybody switching it on',
          /Rotation on/.test(said().slice(n)), said().slice(n).slice(-160));
        c('and it says it will build names from its own',
          /Dracula \+ a number/.test(said().slice(n)), said().slice(n).slice(-160));

        console.log('\n— the name it makes up —');
        say('!!nick now');
        await waitFor(() => nickLines.length >= 1);
        const first = nickLines[0] || '';
        c('it asked for its own name with a number on the end',
          /^Dracula\d+$/.test(first), `asked for: ${JSON.stringify(first)}`);
        c('not a bare Dracula, which is the name it already had',
          first !== 'Dracula', `asked for: ${JSON.stringify(first)}`);
        c('and not the underscore the registration path would have used',
          !/_/.test(first), `asked for: ${JSON.stringify(first)}`);
        // Two digits keeps it well inside any NICKLEN and keeps it readable in
        // a crowded NAMES list.
        const num = parseInt(first.replace(/^Dracula/, ''), 10);
        c('the number is a sane one', num >= 2 && num <= 99, `got ${num}`);
        await waitFor(() => wearing === first);
        c('and that is what it ends up wearing', wearing === first);

        console.log('\n— it does not ask for the same name twice —');
        say('!!nick now');
        await waitFor(() => nickLines.length >= 2);
        c('the next one differs from the one it is wearing',
          nickLines[1] !== nickLines[0], `asked: ${JSON.stringify(nickLines)}`);
        c('and is still recognisably the bot',
          /^Dracula\d+$/.test(nickLines[1] || ''), `asked: ${JSON.stringify(nickLines)}`);

        if (fails) console.log('\n--- bot log tail ---\n' + log.slice(-800));
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        try { bot.kill('SIGKILL'); } catch (e) {}
        server.close();
        process.exit(fails ? 1 : 0);
    })();
});
