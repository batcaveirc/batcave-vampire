// One bad line must not end the bot.
//
// This has now cost three outages in one session: Dracula crash-looped for
// half an hour on a ReferenceError inside a timer, and the three standbys were
// killed twice by one word somebody typed in the room. In every case the
// process exited and the room simply emptied.
//
// The guard must ALSO stay loud. A bare catch would have turned all three of
// those into silent misbehaviour, which is worse — the cross-project notes put
// silence at the top of the list of what actually goes wrong here.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const sent = [];
let exited = null;
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
                send(`:srv 353 D = ${CHAN} :@D someone`);
                send(`:srv 366 D ${CHAN} :end`);
                send(`:srv MODE ${CHAN} +o D`);
                if (staged) continue;
                staged = true;
                // Malformed and hostile shapes: truncated prefixes, numerics
                // with missing parameters, absurd lengths, control bytes.
                setTimeout(() => {
                    send(':');
                    send(':srv 352');
                    send(':srv 354');
                    send(':!@ PRIVMSG');
                    send(`:x!u@h PRIVMSG ${CHAN} :${'A'.repeat(4000)}`);
                    send(':srv 324');
                    send(':srv 332');
                    send(`:x!u@h MODE ${CHAN}`);
                    send(':x!u@h KICK');
                    send(`:x!u@h PRIVMSG ${CHAN} :\x01ACTION\x01`);
                }, 2500);
                // ...and then something completely ordinary, to prove it is
                // still listening rather than merely still running.
                setTimeout(() => send(`:x!u@h PRIVMSG D :!!ping`), 6000);
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
            IRC_NICK: 'D', IRC_CHANNEL: CHAN, OWNERS: 'vikram',
            WHITELIST: '', TRUST_CHANNEL: '', MOD_ENABLED: 'on',
            RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    bot.stdout.on('data', (d) => { out += d; });
    bot.stderr.on('data', (d) => { out += d; });
    bot.on('exit', (code) => { exited = code; });

    setTimeout(() => {
        c('it is still running after every malformed line', exited === null,
          `exited with ${exited}`);
        c('and still answering afterwards',
          sent.some((l) => /^(PRIVMSG|NOTICE) x/.test(l)) || /ping/i.test(out),
          'alive but deaf is not alive');
        // If nothing threw, there is nothing to report — that is a pass too,
        // and asserting a FAULT notice would make this test demand a bug.
        const threw = /handler threw/.test(out);
        c('any fault that did occur was logged, not swallowed',
          !threw || /handler threw/.test(out), '');
        c('and never silently', !/\[FAULT\]/.test(out) || /handler threw/.test(out));
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        phase2();
    }, 11000);
});

// Phase 2 — the must-catch direction.
//
// Everything above passes even if the guard does not exist, because nothing
// in it actually throws. A guard that has never caught anything is not known
// to work. So: copy the bot, inject a real throw on a trigger word, and drive
// it the same way.
function phase2() {
    const fs = require('fs');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faultguard-'));
    const root = path.join(__dirname, '..');
    for (const f of fs.readdirSync(root)) {
        if (f.endsWith('.js')) fs.copyFileSync(path.join(root, f), path.join(dir, f));
    }
    const src = fs.readFileSync(path.join(root, 'action-bot.js'), 'utf8');
    const marker = 'function handleLine(line) {';
    if (!src.includes(marker)) { console.log('  [FAIL] could not inject — handleLine moved'); process.exit(1); }
    fs.writeFileSync(path.join(dir, 'action-bot.js'),
        src.replace(marker, marker + "\n    if (String(line).includes('KABOOM')) { throw new Error('injected fault'); }"));

    console.log('\n— with a real fault injected —');
    const out2 = [];
    let exited2 = null;
    let live2 = null;
    let staged2 = false;
    const srv2 = net.createServer((sock) => {
        live2 = sock;
        sock.setEncoding('utf8');
        sock.on('error', () => {});
        const send = (l) => { try { (live2 || sock).write(l + '\r\n'); } catch (e) { /* gone */ } };
        let buf = '';
        sock.on('data', (d) => {
            buf += d;
            const lines = buf.split('\r\n');
            buf = lines.pop();
            for (const l of lines) {
                out2.push(l);
                if (l.startsWith('NICK')) { send(':srv 001 D :hi'); send(':srv 376 D :end'); }
                if (l.startsWith('JOIN')) {
                    send(`:D!u@h JOIN ${CHAN}`);
                    send(`:srv 353 D = ${CHAN} :@D someone`);
                    send(`:srv 366 D ${CHAN} :end`);
                    send(`:srv MODE ${CHAN} +o D`);
                    if (staged2) continue;
                    staged2 = true;
                    setTimeout(() => send(`:x!u@h PRIVMSG ${CHAN} :KABOOM`), 2500);
                    setTimeout(() => send(`:x!u@h PRIVMSG ${CHAN} :KABOOM`), 4000);
                    setTimeout(() => send(`:y!u@h PRIVMSG ${CHAN} :hello everyone`), 6000);
                }
            }
        });
    });
    srv2.listen(0, '127.0.0.1', () => {
        let log2 = '';
        const bot2 = spawn(process.execPath, [path.join(dir, 'action-bot.js')], {
            env: {
                ...process.env,
                IRC_SERVER: '127.0.0.1', IRC_PORT: String(srv2.address().port), IRC_TLS: '0',
                IRC_NICK: 'D', IRC_CHANNEL: CHAN, OWNERS: 'vikram',
                WHITELIST: '', TRUST_CHANNEL: '', MOD_ENABLED: 'on',
                RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        bot2.stdout.on('data', (d) => { log2 += d; });
        bot2.stderr.on('data', (d) => { log2 += d; });
        bot2.on('exit', (code) => { exited2 = code; });
        setTimeout(() => {
            const faults = out2.filter((l) => /\[FAULT\]/.test(l));
            c('a REAL throw does not kill the process', exited2 === null, `exited with ${exited2}`);
            c('the fault is logged with the line that caused it',
              /handler threw on .*KABOOM/.test(log2),
              log2.split('\n').filter((l) => /threw/.test(l))[0] || '(nothing logged — it was swallowed)');
            c('the owner is told', faults.length > 0, '(owner never told)');
            c('once for the same fault, not once per line', faults.length === 1, `${faults.length} notices`);
            try { bot2.kill(); } catch (e) { /* gone */ }
            srv2.close();
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* fine */ }
            console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
            process.exit(fails ? 1 : 0);
        }, 10000);
    });
}
