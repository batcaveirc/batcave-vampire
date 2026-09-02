// Dracula must never moderate our own bots.
//
//   <Bankai>  [UNO] 🎴 Vikram deals … (several lines, fast, by design)
//   <Dracula> [MOD] Bankai removed — flooding — unregistered guests get no
//             warnings. They can rejoin. 🦇
//   <Lucifer> Khud kick hogya
//
// Bankai deals card hands in bursts and is unregistered by design, so the
// flood rule removed it in front of the room. The exemption list existed —
// PEER_BOTS — and still named Drusilla, who was replaced by Bankai weeks
// earlier. That is the SECOND list of the same bots to drift out of step with
// the matrix in one day; the first cost the standbys their invitations.
//
// So this asserts the property, not the list: anything in the fleet, and
// anything wearing the scenery's realname, is outside automated moderation.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const sent = [];
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
                send(`:srv 353 D = ${CHAN} :@D Bankai Scenery7 stranger`);
                send(`:srv 366 D ${CHAN} :end`);
                send(`:srv MODE ${CHAN} +o D`);
                if (staged) continue;
                staged = true;
                // The scenery is known ONLY by its realname — the nicks rotate.
                send(`:srv 354 D ${CHAN} u h Scenery7 0 :BatCave community member`);
                // Bankai dealing a hand: several lines in under a second.
                const burst = (who, at) => {
                    for (let i = 0; i < 6; i++) {
                        setTimeout(() => send(`:${who}!u@h PRIVMSG ${CHAN} :[UNO] line ${i} deck top card turn`), at + i * 60);
                    }
                };
                burst('Bankai', 2500);
                burst('Scenery7', 4500);
                burst('stranger', 6500);
            }
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
            // Deliberately NOT listing Bankai in PEER_BOTS: this proves the
            // exemption comes from FLEET_NICKS, the list the workflow keeps in
            // step with the matrix, rather than from the one that drifted.
            PEER_BOTS: 'Carmilla,Katerina',
            FLEET_NICKS: 'Carmilla,Bankai,Katerina',
            CHORUS_MARK: 'BatCave community member',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', () => {});
    bot.stderr.on('data', () => {});

    setTimeout(() => {
        const acted = (who) => sent.some((l) =>
            new RegExp(`(KICK ${CHAN} ${who}|MODE ${CHAN} [+-]v ${who}|MODE ${CHAN} \\+b [^\\n]*${who})`, 'i').test(l));
        c('a standby dealing a hand is NOT moderated', !acted('Bankai'),
          sent.filter((l) => /Bankai/i.test(l)).join(' | ') || '(nothing)');
        c('the scenery is not either, known only by its realname', !acted('Scenery7'),
          sent.filter((l) => /Scenery7/i.test(l)).join(' | ') || '(nothing)');
        c('and a real stranger flooding still IS', acted('stranger'),
          sent.filter((l) => /KICK|MODE/.test(l)).join(' | ')
          + ' — exempting our own must not exempt everybody');
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 13000);
});
