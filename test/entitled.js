// Hold the privilege BEFORE the room needs it.
//
// The lockout recovery added today asks ChanServ for an invite when a room
// refuses us. That only works if our account holds the +i flag on the channel,
// and nothing ever checked whether it did — so the recovery rested on one
// unverified assumption, which is the same shape of bug as the lockout itself.
//
// The fix does not READ the flag list to find out. Two ChanServ FLAGS listings
// in flight are indistinguishable while they arrive (only the "End of" line
// names its channel), and the trust parser absorbs any row while a listing is
// open — so a second listing would quietly rewrite the whitelist from another
// channel's access list. Attempting the write and reading the server's real
// answer needs no listing at all, and is idempotent when we already hold them.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const MODE = process.argv[2] || '';
const sent = [];

// With no argument, cover BOTH answers ChanServ can give. Run under the suite
// runner it took no arguments, so only the happy path was ever exercised and
// the refusal branch — the one that has to tell a human what to do — was
// untested while looking tested.
if (!MODE) {
    const { execFileSync } = require('child_process');
    let bad = 0;
    for (const mode of ['granted', 'refused']) {
        console.log(`— ChanServ ${mode} the flags —`);
        try {
            console.log(execFileSync(process.execPath, [__filename, mode], { encoding: 'utf8' }).trim());
        } catch (e) {
            bad++;
            console.log(String((e.stdout || '') + (e.stderr || '')).trim());
        }
    }
    process.exit(bad ? 1 : 0);
}

const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    const send = (l) => { try { sock.write(l + '\r\n'); } catch (e) { /* gone */ } };
    let buf = '';
    sock.on('data', (d) => {
        buf += d;
        const lines = buf.split('\r\n');
        buf = lines.pop();
        for (const l of lines) {
            sent.push(l);
            if (l.startsWith('NICK')) {
                send(':srv 001 D :hi');
                // 900: this is the account the bot is logged in as. The flag
                // grant must name THAT, not the nick — ChanServ keys on the
                // account, and a nick is not an identity.
                send(':srv 900 D D!u@h Vlkram :You are now logged in as Vlkram');
                send(':srv 376 D :end');
            }
            const j = l.match(/^JOIN (\S+)/);
            if (j) {
                send(`:D!u@h JOIN ${j[1]}`);
                send(`:srv 353 D = ${j[1]} :@D someone`);
                send(`:srv 366 D ${j[1]} :end`);
            }
            // The write, answered the way Atheme answers it.
            const f = l.match(/^PRIVMSG ChanServ :FLAGS (\S+) (\S+) \+(\S+)/);
            if (f) {
                if (MODE === 'refused') {
                    send(`:ChanServ!s@srv NOTICE D :You are not authorized to perform this operation.`);
                } else {
                    send(`:ChanServ!s@srv NOTICE D :Flags +${f[3]} were set on ${f[2]} in ${f[1]}.`);
                }
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
            RECRUIT_ON: 'on', RECRUIT_CHANNELS: '#chatsansar',
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
        const grants = all.match(/^PRIVMSG ChanServ :FLAGS #batcave \S+ \+\S+$/gm) || [];
        if (MODE === 'granted') {
            c('it asks for the flags that keep it in the room',
              grants.length >= 1, grants.join(' | ') || '(never asked for anything)');
            // +i is the one the lockout recovery actually needs. +O brings ops
            // back by itself after a restart, which is the other half of
            // "they should be able to sit in these rooms".
            c('including +i, so ChanServ INVITE can work at all',
              /\+\S*i/.test(grants[0] || ''), grants[0] || '');
            c('and +O, so ops come back without a human',
              /\+\S*O/.test(grants[0] || ''), grants[0] || '');
            c('keyed on the ACCOUNT, never the nick',
              / Vlkram \+/.test(grants[0] || ''),
              grants[0] + ' — a nick is wearable by anyone; ChanServ keys on the account');
            c('it does NOT grant itself +f',
              !/\+\S*f/.test(grants[0] || ''),
              'the power to rewrite the access list is the power to trust anybody');
            c('asked once, not in a loop', grants.length <= 2, `${grants.length} attempts`);
            c('and it never reads the flag LIST to decide',
              !/^PRIVMSG ChanServ :FLAGS #batcave$/m.test(all),
              'a second listing would be absorbed as trust-channel rows');
            // And never in a room we are only a guest in. The owner was told to
            // set founder flags on #chatsansar — a room he does not own — because
            // this ran on every JOIN rather than on our own channels. Asking
            // somebody else's services for access is how a tolerated guest
            // becomes a banned one.
            c('it never asks for flags in a room that is not ours',
              !/^PRIVMSG ChanServ :FLAGS #chatsansar/m.test(all),
              sent.filter((l) => /chatsansar/.test(l)).join(' | '));
            c('nor claims ops there',
              !/^PRIVMSG ChanServ :OP #chatsansar/m.test(all),
              sent.filter((l) => /chatsansar/.test(l)).join(' | '));
        } else {
            c('a refusal is reported, not swallowed',
              /not authorized|cannot grant|refused/i.test(out),
              out.split('\n').filter((l) => /FLAG|authoriz|refus/i.test(l)).join(' | ') || '(silent)');
            c('and it tells a human the exact command to run',
              /FLAGS #batcave \S+ \+\S+/.test(out),
              'a failure nobody can act on is the same as no message');
            c('without retrying forever', grants.length <= 2, `${grants.length} attempts`);
        }
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 12000);
});
