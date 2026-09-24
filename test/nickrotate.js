// Changing names without getting killed for it.
//
// The owner asked for both bots to rotate nicks and answered the obvious
// objection himself: the vhosts (Dracula@Sat.Chit.Ananda,
// Luna1@Keeping.The.Night.Company) belong to the CONNECTION, so the fleet still
// recognises itself after a rename. He also named the risk: "i dont wanna be
// banned cause of fast nick changes thats why i wanna do it."
//
// So the thing under test is not "can it change its name". It is everything
// that must NOT happen when it does:
//
//   * the nick watchdog must not fight it. It ran every 60s and reclaimed any
//     nick that was not config.nick — GHOST, RELEASE, NICK and a re-JOIN of
//     every channel. Left alone it would have undone each rotation within a
//     minute and dragged that whole sequence through the room each time. This
//     is the assertion the feature lives or dies on, and it is why the test
//     runs past the 60-second mark instead of stopping at the happy path.
//   * a taken name must cost nothing. The 433 handler appends an underscore to
//     finish REGISTERING; firing that during a rotation would rename the bot to
//     "Dracula_" for no reason and spend one of the hour's changes doing it.
//   * the cap is the actual safety feature, so it has to bite.
//   * being kicked must put the usual name back. Rejoining seconds later under
//     a name nobody recognises is how a bot gets banned instead of let back in.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const POOL = ['Nosferatu', 'Orlok', 'Alucard'];
const sent = [];            // every line the bot wrote
let registered = false;     // NICK lines before this are just connecting
let bot = null;
let sock = null;
let nickLines = [];         // post-registration NICK requests
let wearing = 'Dracula';
let ghostsAfterRename = 0;
let renamedAt = 0;

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
                if (nickLines.length === 1) {
                    // First rotation: tell it the name is taken.
                    send(`:srv 433 ${wearing} ${want} :Nickname is already in use`);
                } else if (nickLines.length === 2) {
                    // Second: let it through, the way a server would.
                    send(`:${wearing}!bot@Sat.Chit.Ananda NICK :${want}`);
                    wearing = want;
                    renamedAt = Date.now();
                }
            }
            if (/^PRIVMSG NickServ :(GHOST|RELEASE)/.test(l) && renamedAt) ghostsAfterRename += 1;
            if (l.startsWith('JOIN')) {
                send(`:${wearing}!bot@Sat.Chit.Ananda JOIN ${CHAN}`);
                send(`:srv 353 ${wearing} = ${CHAN} :@${wearing} @boss Lucifer`);
                send(`:srv 366 ${wearing} ${CHAN} :end`);
                send(`:srv MODE ${CHAN} +o ${wearing}`);
            }
        }
    });
});

const say = (text) => { if (sock) sock.write(`:boss!u@home PRIVMSG ${CHAN} :${text}\r\n`); };
const noticed = () => sent.filter((l) => l.startsWith('NOTICE boss')).join('\n');

server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(port), IRC_TLS: '0',
            IRC_NICK: 'Dracula', IRC_CHANNEL: CHAN,
            OWNERS: 'boss', ADMINS: 'boss',
            NICKSERV_PASS: 'x', NICKSERV_ACCOUNT: 'Vlkram',
            NICK_ROTATE: '1', NICK_POOL: POOL.join(','), NICK_MAX_PER_HOUR: '2',
            OUR_HOSTS: 'Sat.Chit.Ananda',
            GROQ_API_KEY: '', SENTIENT_ON: 'off', HOLD_UNINVITED: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    bot.stdout.on('data', (d) => { log += d; });
    bot.stderr.on('data', (d) => { log += d; });

    // Wait for a thing to become true rather than guessing how long it takes.
    // Fixed sleeps are exactly why four suites in this directory failed in one
    // run and a different four in the next: under load the wait expires before
    // the bot answers, and a working feature reports "sent no MODE at all".
    const waitFor = (what, pred, ms = 12000) => new Promise((resolve) => {
        const t0 = Date.now();
        const tick = () => {
            if (pred()) return resolve(true);
            if (Date.now() - t0 > ms) return resolve(false);
            setTimeout(tick, 120);
        };
        tick();
    });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const saidSince = (n) => sent.filter((l) => l.startsWith('NOTICE boss')).slice(n).join('\n');
    const notices = () => sent.filter((l) => l.startsWith('NOTICE boss')).length;

    (async () => {
        // Opped and settled: until then a command can land before the bot is ready
        // to answer it, and the test measures its own impatience.
        await waitFor('ops', () => /Got ops in|Already opped/.test(log), 30000);
        await sleep(500);

        console.log('— asking for a change —');
        let n = notices();
        say('!!nick status');
        await waitFor('status', () => /Rotation (on|off)/.test(saidSince(n)));
        c('it reports rotation is on, and the pool it may use',
          /Rotation on/.test(saidSince(n)) && /Nosferatu/.test(saidSince(n)),
          saidSince(n).slice(-160) || '(said nothing)');

        say('!!nick now');
        await waitFor('first NICK', () => nickLines.length >= 1);
        c('it asked the server for a name from the pool',
          nickLines.length === 1 && POOL.includes(nickLines[0]),
          `asked for: ${JSON.stringify(nickLines)}`);
        // The server said that name was taken. It must still be Dracula — not
        // Dracula_, which is what the REGISTRATION 433 path would have done.
        await sleep(600);
        c('a taken name does not rename it to Dracula_',
          !nickLines.some((x) => /^Dracula_/.test(x)),
          `post-registration NICKs: ${JSON.stringify(nickLines)}`);

        say('!!nick now');
        await waitFor('second NICK', () => nickLines.length >= 2);
        await waitFor('rename accepted', () => wearing !== 'Dracula');
        c('a second attempt is allowed, and takes', nickLines.length === 2 && wearing !== 'Dracula',
          `asked for: ${JSON.stringify(nickLines)}, wearing ${wearing}`);

        console.log('\n— the cap —');
        n = notices();
        say('!!nick now');
        // Wait for the ACTUAL words, not for "a notice arrived". Dracula paces
        // its output at roughly two lines a second, so the previous command's
        // reply is often still in the queue — counting notices reads that one
        // and calls it the answer to a question it never heard.
        await waitFor('refusal', () => /limit, on purpose/.test(saidSince(n)));
        c('the third is refused, because two an hour is the limit',
          nickLines.length === 2 && /limit, on purpose/.test(saidSince(n)),
          `${nickLines.length} NICKs sent; said: ${saidSince(n).slice(-140)}`);

        n = notices();
        say('!!nick status');
        await waitFor('status2', () => new RegExp(`Wearing .?${wearing}`).test(saidSince(n)));
        c('and it knows which name it is wearing',
          new RegExp(`Wearing .?${wearing}`).test(saidSince(n)),
          `expected ${wearing}; said: ${saidSince(n).slice(-140)}`);

        console.log('\n— the watchdog, which used to undo all of this —');
        console.log('  (waiting past the 60s mark it fires on)');
        const renameMark = Date.now();
        await sleep(Math.max(0, 68000 - (renameMark - renamedAt)));

        c('the rename actually happened, so the next check means something',
          wearing !== 'Dracula', 'never renamed, so "no reclaim" proves nothing');
        c('the watchdog left the chosen name alone — no GHOST, no RELEASE',
          ghostsAfterRename === 0,
          `${ghostsAfterRename} reclaim attempt(s) against a name we chose`);
        c('and it did not quietly ask for the old name back',
          !nickLines.slice(2).includes('Dracula'),
          `post-registration NICKs: ${JSON.stringify(nickLines)}`);

        console.log('\n— trouble —');
        const joinsBefore = sent.filter((l) => l.startsWith(`JOIN ${CHAN}`)).length;
        if (sock) sock.write(`:Lucifer!u@h KICK ${CHAN} ${wearing} :out\r\n`);
        const reverted = await waitFor('revert',
          () => /PRIVMSG NickServ :(GHOST|RELEASE) Dracula/.test(sent.join('\n'))
             || nickLines.slice(2).includes('Dracula'), 15000);
        c('being kicked puts the name the room knows back', reverted,
          'it stayed under the rotated name after being removed');
        const rejoined = await waitFor('rejoin',
          () => sent.filter((l) => l.startsWith(`JOIN ${CHAN}`)).length > joinsBefore, 15000);
        c('and it rejoins', rejoined);

        if (fails) console.log('\n--- bot log tail ---\n' + log.slice(-900));
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        try { bot.kill('SIGKILL'); } catch (e) {}
        server.close();
        process.exit(fails ? 1 : 0);
    })();
});
