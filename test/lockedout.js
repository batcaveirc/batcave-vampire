// Dracula must let itself back into its own room.
//
// The room went invite-only and the bot could not rejoin after a restart. It
// holds ChanServ flags for that channel — it can simply ASK — but nothing in
// it ever did, so a bot with every privilege it needed sat outside a room it
// moderates until a human noticed.
//
// The same shape as the standbys being locked out by the +i Dracula set
// itself: our own bots cannot ask for help, so the asking has to be built in.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const sent = [];
let live = null;
let letIn = false;

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
            // The room is invite-only and refuses us until ChanServ acts.
            const j = l.match(/^JOIN (\S+)/);
            if (j && j[1].toLowerCase() === CHAN) {
                if (!letIn) { send(`:srv 473 D ${CHAN} :Cannot join channel (+i)`); }
                else {
                    send(`:D!u@h JOIN ${CHAN}`);
                    send(`:srv 353 D = ${CHAN} :@D someone`);
                    send(`:srv 366 D ${CHAN} :end`);
                }
            } else if (j) { send(`:D!u@h JOIN ${j[1]}`); send(`:srv 366 D ${j[1]} :end`); }
            // ChanServ grants the invite when asked, as it would for a bot
            // that genuinely holds the +i flag.
            if (/^PRIVMSG ChanServ :INVITE/.test(l)) { letIn = true; }
        }
    });
});

server.listen(0, '127.0.0.1', () => {
    const bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(server.address().port), IRC_TLS: '0',
            IRC_NICK: 'D', IRC_CHANNEL: CHAN, OWNERS: 'vikram',
            WHITELIST: '', TRUST_CHANNEL: '', MOD_ENABLED: 'on',
            RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    bot.stdout.on('data', (d) => { out += d; });
    bot.stderr.on('data', (d) => { out += d; });

    setTimeout(() => {
        const all = sent.join('\n');
        c('it ASKS ChanServ for an invite when refused',
          /^PRIVMSG ChanServ :INVITE #batcave$/m.test(all),
          sent.filter((l) => /ChanServ/.test(l)).join(' | ') || '(never asked — it just sat outside)');
        c('and tries the join again afterwards',
          (all.match(/^JOIN #batcave/gm) || []).length >= 2,
          `${(all.match(/^JOIN #batcave/gm) || []).length} join attempts`);
        c('ending up inside', /Joined #batcave/.test(out),
          out.split('\n').filter((l) => /batcave/i.test(l)).slice(-2).join(' | '));
        c('it says it was locked out, rather than failing quietly',
          /Locked out of #batcave \(473\)/.test(out),
          'a bot outside its own room with no log is invisible');
        c('and it does not ask forever',
          (all.match(/^PRIVMSG ChanServ :INVITE/gm) || []).length <= 3,
          'asking in a loop when ChanServ will refuse is a flood, not persistence');
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 12000);
});
