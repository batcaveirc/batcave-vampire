// Drive "shazam" the way a user does, through a fake server.
//
// It was reported as doing nothing at all for lisu — twice — and reading the
// code showed a path that looked reachable. This runs it instead.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
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
                send(`:D!u@h JOIN ${CHAN}`);
                // extended-join style accounts: trusty is registered, ghost is not.
                send(`:trusty!u@host1 JOIN ${CHAN} trustyacct :real`);
                send(`:ghost!u@host2 JOIN ${CHAN} * :real`);
                send(`:srv 353 D = ${CHAN} :@D trusty ghost lurker attacker`);
                send(`:srv 366 D ${CHAN} :end`);
                send(`:srv MODE ${CHAN} +o D`);
                // Somebody attacks trusty, then trusty calls it.
                setTimeout(() => send(`:attacker!u@h9 PRIVMSG ${CHAN} :trusty you are a randi and a bhosdike`), 2200);
                setTimeout(() => send(`:trusty!u@host1 PRIVMSG ${CHAN} :shazam`), 3200);
                setTimeout(() => send(`:ghost!u@host2 PRIVMSG ${CHAN} :shazam`), 4500);
                // Present before we connected: no JOIN, so no extended-join,
                // so no account — which is most people after a restart.
                setTimeout(() => send(`:lurker!u@host3 PRIVMSG ${CHAN} :shazam`), 6000);
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
            WHITELIST: 'trusty,ghost', TRUST_CHANNEL: '', MOD_ENABLED: 'on',
            RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', () => {});
    bot.stderr.on('data', () => {});

    setTimeout(() => {
        const all = sent.join('\n');
        // CHANGED with the feature: no ops are handed out at all any more.
        c('the attacker is removed', /KICK #batcave attacker/.test(all),
          sent.filter((l) => l.startsWith('KICK')).join(' | ') || '(no KICK at all)');
        // NOT asserting that trusty never gets +o here: the Guardian legitimately
        // arms a victim who is being attacked, and it fires on the same message.
        // What matters is that SHAZAM itself no longer grants it, which the
        // source-level test asserts directly.
        c('shazam announced a removal, not a grant', /called it\. Removing attacker/.test(all),
          all.split('\n').filter((l) => /SHAZAM/.test(l)).join(' | ') || '(no SHAZAM line)');
        c('a trusted but UNREGISTERED user is refused', !/MODE #batcave \+o ghost/.test(all),
          'anyone can wear an unregistered nick, and this hands out operator');
        c('and told why, not left in silence', /NOTICE ghost .*registered nick/i.test(all),
          all.split('\n').filter((l) => /NOTICE ghost/.test(l)).join(' | ') || '(nothing sent to ghost)');
        c('somebody we have not checked is asked about, not refused',
          /USERHOST lurker/.test(all) || /WHOIS lurker/.test(all),
          'telling a registered regular to go and register is the wrong answer');
        c('and told to try again rather than left silent',
          /NOTICE lurker .*One moment/i.test(all),
          all.split('\n').filter((l) => /NOTICE lurker/.test(l)).join(' | ') || '(nothing sent)');
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 9000);
});
