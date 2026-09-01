// Room topics, and the line between "filling a blank" and "vandalism".
//
// The first version of this replaced any topic that did not already mention
// !!help — which is every topic a person has ever written — while the commit
// message said it left human topics alone. Both halves are asserted here so
// the claim and the code cannot drift apart again.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const BLANK = '#blank';
const TAKEN = '#taken';
const EXISTING = 'Welcome to the room, be nice to each other';

function run(done) {
    const sent = [];
    let live = null;
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
                const j = l.match(/^JOIN (\S+)/);
                if (j) {
                    const ch = j[1];
                    send(`:D!u@h JOIN ${ch}`);
                    // 331 = no topic at all; 332 = here is the topic.
                    send(ch === BLANK
                        ? `:srv 331 D ${ch} :No topic is set`
                        : `:srv 332 D ${ch} :${EXISTING}`);
                    send(`:srv 353 D = ${ch} :@D someone`);
                    send(`:srv 366 D ${ch} :end`);
                    send(`:srv MODE ${ch} +o D`);
                }
                const m = l.match(/^MODE (\S+)\s*$/);
                if (m) send(`:srv 324 D ${m[1]} +nt`);
                const w = l.match(/^WHO (\S+)/);
                if (w) send(`:srv 315 D ${w[1]} :End of WHO`);
            }
        });
    });
    server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
            env: {
                ...process.env,
                IRC_SERVER: '127.0.0.1', IRC_PORT: String(port), IRC_TLS: '0',
                IRC_NICK: 'D', IRC_CHANNEL: `${BLANK},${TAKEN}`, OWNERS: 'vikram',
                WHITELIST: '', TRUST_CHANNEL: '', MOD_ENABLED: 'on',
                RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        bot.stdout.on('data', () => {});
        bot.stderr.on('data', () => {});
        setTimeout(() => {
            try { bot.kill(); } catch (e) { /* gone */ }
            server.close();
            done(sent);
        }, 14000);
    });
}

run((sent) => {
    const topics = sent.filter((l) => /^TOPIC /.test(l));
    c('an empty room gets a signpost', topics.some((l) => l.startsWith(`TOPIC ${BLANK}`)),
      topics.join(' | ') || '(no TOPIC sent at all)');
    c('and it points at the help command', topics.some((l) => l.includes('!!help')),
      topics.join(' | '));
    c('a room that HAS a topic is left alone',
      !topics.some((l) => l.startsWith(`TOPIC ${TAKEN}`)),
      topics.join(' | ') + ' — somebody wrote that, it is not ours to replace');
    c('but the owner is told, with the command to apply it',
      sent.some((l) => /NOTICE vikram .*TOPIC.*!!topic/i.test(l)),
      sent.filter((l) => /NOTICE vikram/.test(l)).join(' | ') || '(owner never told)');
    c('and it is written once, not on a loop',
      topics.filter((l) => l.startsWith(`TOPIC ${BLANK}`)).length === 1,
      `${topics.filter((l) => l.startsWith(`TOPIC ${BLANK}`)).length} writes`);
    console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
    process.exit(fails ? 1 : 0);
});
