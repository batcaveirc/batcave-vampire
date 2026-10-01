// Ban exceptions (+e) for trusted regulars — the VIP immunity to a ban-jump.
//
// A +e ban-exception overrides +b, so a whitelisted/protected account bypasses
// a broad +b R:* instead of being evicted with everyone else. This pins:
//   * on startup, once opped, the bot sets +e for each trusted account
//   * in BOTH rooms, not just one
//   * it is NOT a blanket +e R:* — only NAMED trusted accounts are immune, so a
//     ban-jump still evicts a non-trusted registered user
//   * it is silent: a server MODE, never a channel message
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const R1 = '#batcave', R2 = '#vip';
const sent = [];
let live = null;

const server = net.createServer((sock) => {
    live = sock; sock.setEncoding('utf8'); sock.on('error', () => {});
    const send = (l) => { try { (live || sock).write(l + '\r\n'); } catch (e) { /* gone */ } };
    let buf = '';
    sock.on('data', (d) => {
        buf += d; const lines = buf.split('\r\n'); buf = lines.pop();
        for (const l of lines) {
            sent.push(l);
            if (l.startsWith('NICK')) { send(':srv 001 D :hi'); send(':srv 376 D :end'); }
            if (l.startsWith('JOIN')) {
                const chan = l.split(' ')[1];
                send(`:D!u@h JOIN ${chan}`);
                send(`:srv 353 D = ${chan} :@D`);   // the bot is opped on arrival
                send(`:srv 366 D ${chan} :end`);
                send(`:srv MODE ${chan} +o D`);
            }
        }
    });
});

server.listen(0, '127.0.0.1', () => {
    const bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(server.address().port), IRC_TLS: '0',
            IRC_NICK: 'D', IRC_CHANNEL: `${R1},${R2}`, OWNERS: 'vikram',
            WHITELIST: 'alice,bob', HOPUP_TO: '',       // hop-up off — this tests +e only
            BANEXCEPT_DELAY_MS: '500',                  // +e sync is deferred; speed it up for the test
            RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '', OPEN_TO_REGISTERED: 'on',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', () => {}); bot.stderr.on('data', () => {});

    setTimeout(() => {
        const all = sent.join('\n');
        // A +e line (possibly batched: "MODE #chan +ee R:alice R:bob") that carries R:<acct>.
        const eFor = (room, acct) => new RegExp(`MODE ${room} [+]e+ [^\\n]*R:${acct}\\b`, 'i').test(all);
        c('startup sets +e for a trusted account in #batcave', eFor(R1, 'alice'),
          sent.filter((l) => /MODE #batcave \+e/i.test(l)).join(' | ') || '(no +e set)');
        c('and for the second trusted account', eFor(R1, 'bob'));
        c('the SAME exceptions go on the second room too (both rooms)',
          eFor(R2, 'alice') && eFor(R2, 'bob'),
          sent.filter((l) => /MODE #vip \+e/i.test(l)).join(' | ') || '(no +e in #vip)');
        c('it is NOT a blanket +e R:* — only named trusted are immune',
          !/MODE \S+ [+]e+ [^\n]*R:\*/i.test(all),
          'a ban-jump must still evict a non-trusted registered user');
        c('it is silent — nothing about exceptions is said in a channel',
          !/PRIVMSG #(batcave|vip) :[^\n]*(exception|immune|\+e|R:)/i.test(all),
          sent.filter((l) => /PRIVMSG #/.test(l)).slice(0, 3).join(' | '));
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 9000);
});
