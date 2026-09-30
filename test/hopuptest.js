// Hop registered regulars up into the closed room — silently.
//
// The owner wants registered regulars sitting in BOTH #batcave and the closed
// emoji room, automatically, with no channel spam. The mechanism is a silent
// INVITE (clients auto-join a +R room they are invited to). This pins the rules:
//   * a whitelisted/trusted REGISTERED joiner of #batcave is invited to #vip
//   * an UNREGISTERED joiner is not (they stay in #batcave)
//   * a registered but non-priority joiner is not (default; ChanServ covers them)
//   * someone already IN #vip is not re-invited
//   * nobody is announced in the channel — the invite is private
//   * one invite per person (the 6s WHO-fallback retry must not double up)
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const HOME = '#batcave';
const VIP = '#vip';
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
                const chan = l.split(' ')[1];
                send(`:D!u@h JOIN ${chan}`);
                // #vip already has Dave sitting in it, to prove "already in both".
                const names = chan === VIP ? '@D Dave' : '@D';
                send(`:srv 353 D = ${chan} :${names}`);
                send(`:srv 366 D ${chan} :end`);
                send(`:srv MODE ${chan} +o D`);
                if (chan !== HOME || staged) continue;
                staged = true;
                // Extended-join arrivals into #batcave (account is param after the channel; '*' = none):
                setTimeout(() => send(`:Alice!u@h1 JOIN ${HOME} alice :real`), 3000);  // whitelisted + registered -> invite
                setTimeout(() => send(`:Bob!u@h2 JOIN ${HOME} * :real`), 3800);        // unregistered -> no
                setTimeout(() => send(`:Carol!u@h3 JOIN ${HOME} carol :real`), 4600);  // registered, not priority -> no
                setTimeout(() => send(`:Dave!u@h4 JOIN ${HOME} dave :real`), 5400);    // priority but already in #vip -> no
            }
        }
    });
});

server.listen(0, '127.0.0.1', () => {
    const bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(server.address().port), IRC_TLS: '0',
            IRC_NICK: 'D', IRC_CHANNEL: HOME, OWNERS: 'vikram',
            WHITELIST: 'alice,dave', HOPUP_TO: VIP,
            MOD_ENABLED: 'on', RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', () => {});
    bot.stderr.on('data', () => {});

    setTimeout(() => {
        const all = sent.join('\n');
        const invited = (who) => (all.match(new RegExp(`INVITE ${who} ${VIP}`, 'gi')) || []).length;
        c('the bot itself JOINs the closed room (so it can invite there)',
          /^JOIN #vip/m.test(all) || sent.includes('JOIN #vip'),
          sent.filter((l) => /^JOIN/.test(l)).join(' | '));
        c('a whitelisted, registered joiner is invited up to the closed room',
          invited('Alice') >= 1, sent.filter((l) => /INVITE/i.test(l)).join(' | ') || '(no invites)');
        c('and invited exactly once (the WHO-fallback retry must not double up)',
          invited('Alice') === 1, `Alice invited ${invited('Alice')}x`);
        c('an UNREGISTERED joiner is NOT invited (they stay in #batcave)',
          invited('Bob') === 0, sent.filter((l) => /INVITE Bob/i.test(l)).join(' | '));
        c('a registered but non-priority joiner is NOT invited by default',
          invited('Carol') === 0, sent.filter((l) => /INVITE Carol/i.test(l)).join(' | '));
        c('someone already in the closed room is NOT re-invited',
          invited('Dave') === 0, sent.filter((l) => /INVITE Dave/i.test(l)).join(' | '));
        c('nothing is announced in the channel — the invite is silent',
          !/PRIVMSG #batcave :[^\n]*(#vip|invited|closed room)/i.test(all),
          'the hop-up must never spam the room');
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 15000);
});
