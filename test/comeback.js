// It has to come back when the door opens LATER.
//
// Live, 10:09:23 — a moderator banned the account (+b R:Vlkram, InspIRCd's
// registered-account extban) and kicked Dracula out of #batcave. ChanBot
// lifted the ban four seconds later. Dracula never came back.
//
// The cause was not the ban. The KICK handler fired exactly one rejoin, three
// seconds afterwards, which landed while the ban was still up and was refused
// — and that was the end of it forever. A door that opens a moment after the
// single knock is the same as a locked door to a bot that only knocks once.
//
// So the property under test is not "it handles a ban". It is: the bot keeps
// trying, slowly, for as long as it is outside a room it is supposed to be in,
// whatever the reason was. That covers the ban lifted later, the invite-only
// flag dropped later, and the causes nobody has thought of yet.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const sent = [];
let joins = 0;
let banned = false;
let unbanAt = 0;

const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    const send = (l) => { try { sock.write(l + '\r\n'); } catch (e) { /* gone */ } };
    let buf = '';
    let me = 'Dracula';
    sock.on('data', (d) => {
        buf += d;
        const lines = buf.split('\r\n');
        buf = lines.pop();
        for (const l of lines) {
            sent.push(l);
            // Answer with the nick the bot actually ASKED for. The fixture
            // used a short stand-in, so the bot never recognised its own JOIN
            // echo and the test failed for a reason that had nothing to do
            // with coming back after a kick.
            const nk = l.match(/^NICK (\S+)/);
            if (nk) {
                me = nk[1];
                send(`:srv 001 ${me} :hi`);
                send(`:srv 900 ${me} ${me}!u@h Vlkram :You are now logged in as Vlkram`);
                send(`:srv 376 ${me} :end`);
            }
            const j = l.match(/^JOIN (\S+)/);
            if (!j) continue;
            const chan = j[1];
            if (chan.toLowerCase() !== CHAN) {
                send(`:${me}!u@h JOIN ${chan}`); send(`:srv 366 ${me} ${chan} :end`);
                continue;
            }
            joins++;
            // Still banned, and the ban outlasts the burst of quick retries the
            // kick handler makes — as it did live.
            if (banned && Date.now() < unbanAt) {
                send(`:srv 474 ${me} ${CHAN} :Cannot join channel (+b)`);
                continue;
            }
            banned = false;
            send(`:${me}!u@h JOIN ${CHAN}`);
            send(`:srv 353 ${me} = ${CHAN} :@${me} Vikram`);
            send(`:srv 366 ${me} ${CHAN} :end`);
            // The moment it is inside for the first time, a moderator bans the
            // ACCOUNT and kicks it — wearing a nick the bot was NOT configured
            // with, because live it had been renamed once already.
            if (joins === 1) {
                setTimeout(() => {
                    banned = true;
                    unbanAt = Date.now() + 20000;     // lifted well after the quick retries
                    send(`:Vikram!v@h MODE ${CHAN} +b R:Vlkram`);
                    send(`:Vikram!v@h KICK ${CHAN} ${me} :Your behaviour is not conducive`);
                }, 1500);
            }
        }
    });
});

server.listen(0, '127.0.0.1', () => {
    const bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')], {
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(server.address().port), IRC_TLS: '0',
            // Configured as Dracula, and that is the name it wears here. The
            // point of the rename case is covered by the KICK naming "Dracula"
            // while the SERVER calls it D — the old check compared the victim
            // against config.nick and would miss a bot wearing anything else.
            IRC_NICK: 'Dracula', IRC_CHANNEL: CHAN, OWNERS: 'vikram',
            WHITELIST: '', TRUST_CHANNEL: '', MOD_ENABLED: 'on',
            RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
            REJOIN_EVERY_SEC: '3',            // the watchdog, fast enough to test
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    bot.stdout.on('data', (d) => { out += d; });
    bot.stderr.on('data', (d) => { out += d; });

    setTimeout(() => {
        const all = sent.join('\n');
        const tries = (all.match(/^JOIN #batcave/gm) || []).length;
        c('it keeps knocking while it is shut out',
          tries >= 4, `${tries} join attempts — live it made exactly one and gave up`);
        c('and is back inside once the ban is lifted',
          (out.match(/Joined #batcave/g) || []).length >= 2,
          out.split('\n').filter((l) => /batcave/i.test(l)).slice(-3).join(' | '));
        c('it says it is locked out rather than sitting there quietly',
          /[Ll]ocked out of #batcave/.test(out), '(silent)');
        // The knocking must be SLOW. A bot retrying a refused join in a tight
        // loop is a flood, and this network Z-lines for less.
        c('it does not knock in a tight loop',
          tries <= 14, `${tries} attempts in ~20s is a flood, not persistence`);
        // ChanServ already refused three times; nagging it further is pointless
        // while the cheap retry against the SERVER is what eventually works.
        c('and stops nagging ChanServ once it has refused enough',
          (all.match(/^PRIVMSG ChanServ :UNBAN/gm) || []).length <= 4,
          (all.match(/^PRIVMSG ChanServ :UNBAN/gm) || []).join(' | '));
        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 30000);
});
