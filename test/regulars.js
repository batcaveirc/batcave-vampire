// The regulars feed, driven through the real bot rather than the module.
//
// attendtest.js proves the arithmetic and the refusals. It proves nothing about
// whether anything in the bot ever calls them — which is the failure this
// project keeps repeating: UNO's engine passed 19 tests while the game was
// unplayable, because nothing routed the commands to it.
//
// So this one connects, joins, has "Luna1" send a signed report, and asserts
// that a person the report vouches for is actually written into the trust
// channel — and that one it does not vouch for is not.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
const { encodeReport } = require('../attendance.js');
let f = 0;
const c = (n, ok, d = '') => { if (!f && !ok) { /* keep going */ } if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (l) => l.replace(/\x03\d{0,2}(,\d{1,2})?|[\x02\x0f]/g, '');

const SECRET = 'shared-with-luna';
const out = [];
let sock = null;

const srv = net.createServer((s) => {
    sock = s;
    s.on('error', () => {});
    s.on('data', (d) => {
        for (const l of String(d).split('\r\n')) {
            if (!l) continue;
            out.push(l);
            if (l.startsWith('NICK')) {
                s.write(':srv 001 Dracula :hi\r\n');
                s.write(':srv 900 Dracula Dracula!u@h Vlkram :logged in\r\n');
                s.write(':srv 376 Dracula :End\r\n');
            }
            if (/PRIVMSG ChanServ :FLAGS #batcave-trust$/.test(l)) {
                s.write(':ChanServ!s@srv NOTICE Dracula :Entry Nickname/Host          Flags\r\n');
                s.write(':ChanServ!s@srv NOTICE Dracula :1     Vlkram                 +AFORVefiorstv (FOUNDER)\r\n');
                s.write(':ChanServ!s@srv NOTICE Dracula :End of #batcave-trust FLAGS listing.\r\n');
            }
            // NickServ, telling us how old an account is. aishwarya's is eight
            // days old — the real one, read out of the live log — which is why
            // the 30-day message door could never have promoted her.
            const inf = l.match(/^PRIVMSG NickServ :INFO (\S+)/);
            if (inf) {
                const who = inf[1];
                const ago = /aishwarya/i.test(who) ? 8 : 400;
                const when = new Date(Date.now() - ago * 86400000).toUTCString()
                    .replace(/^\w+, (\d+) (\w+) (\d+) ([\d:]+).*$/, '$2 $1 $4 $3');
                s.write(`:NickServ!s@srv NOTICE Dracula :Information on ${who} (account ${who}):\r\n`);
                s.write(`:NickServ!s@srv NOTICE Dracula :Registered : ${when} (ages ago)\r\n`);
            }
        }
    });
});

srv.listen(0, '127.0.0.1', async () => {
    const bot = spawn('node', [path.join(__dirname, '..', 'action-bot.js')], {
        cwd: __dirname,
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(srv.address().port), IRC_TLS: 'off',
            IRC_NICK: 'Dracula', IRC_CHANNEL: '#batcave', OWNERS: 'boss',
            WHITELIST: '', TRUST_CHANNEL: '#batcave-trust', MODERATED_ROOMS: '#batcave',
            AUTO_TRUST: 'on', SENTIENT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
            FUN_ON: 'off', RECRUIT_ON: 'off',
            PEER_SECRET: SECRET,
            TRUST_EARN_DAYS_SEEN: '7', TRUST_EARN_MIN_DAYS: '7',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    bot.stdout.on('data', (d) => { log += d; });
    bot.stderr.on('data', (d) => { log += d; });

    await wait(6500);
    // Everyone is in the room, and the WHOX reply gives the bot their ACCOUNTS,
    // which is the identity all of this actually rests on.
    sock.write(':srv 353 Dracula = #batcave :@Dracula boss aishwarya driveby nobody\r\n');
    sock.write(':srv 366 Dracula #batcave :End\r\n');
    // 354 <me> 152 <chan> <user> <host> <nick> <account> :<realname>. The first
    // draft of these lines carried an extra field, so every nick was read as
    // "srv" and nobody had an account — the bot was right and the fixture wrong.
    sock.write(':srv 354 Dracula 152 #batcave uu hh aishwarya aishwarya :0 Aishwarya\r\n');
    sock.write(':srv 354 Dracula 152 #batcave uu hh driveby driveby :0 Passing\r\n');
    // nobody is UNREGISTERED: WHOX reports the account as 0.
    sock.write(':srv 354 Dracula 152 #batcave uu hh nobody 0 :0 Nobody\r\n');
    sock.write(':srv 315 Dracula #batcave :End of WHO\r\n');
    await wait(12000);

    console.log('— a signed report from Luna —');
    out.length = 0;
    sock.write(`:Luna1!l@h NOTICE Dracula :${encodeReport(SECRET, new Map([
        ['aishwarya', 11],      // a fortnight of ordinary days
        ['driveby', 2],         // turned up twice
        ['nobody', 30],         // busiest of all, and has no account
    ]))}\r\n`);
    await wait(9000);
    c('it is accepted and says who is busiest',
      /Attendance from Luna1: 3 nick\(s\)/.test(log),
      log.split('\n').filter((l) => /Attendance|Refused a regulars/.test(l)).join(' | ') || '(ignored entirely)');
    c('it asks NickServ how old the vouched-for account is',
      out.some((l) => /^PRIVMSG NickServ :INFO aishwarya/i.test(l)),
      out.filter((l) => /NickServ/.test(l)).join(' | ') || '(never asked)');
    c('and writes her into the trust channel',
      out.some((l) => /PRIVMSG ChanServ :FLAGS #batcave-trust aishwarya \+V/i.test(l)),
      out.filter((l) => /FLAGS #batcave-trust/.test(l)).join(' | ') || '(never promoted)');
    c('telling a moderator it was DAYS, and how to undo it',
      out.some((l) => /separate days/.test(plain(l)) && /aishwarya/i.test(l))
        && out.some((l) => /!!trust del aishwarya/i.test(plain(l))),
      out.filter((l) => /TRUST/.test(plain(l))).map(plain).join(' | ') || '(nobody told)');

    console.log('\n— and what it refuses —');
    c('somebody seen on two days is not promoted',
      !out.some((l) => /FLAGS #batcave-trust driveby \+V/i.test(l)),
      'two days is a visitor, not a regular');
    c('the busiest nick in the room is NOT promoted, having no account',
      !out.some((l) => /FLAGS #batcave-trust nobody \+V/i.test(l)),
      'a nick nobody owns is trust handed to whoever takes it next');

    console.log('\n— a forged report changes nothing —');
    out.length = 0;
    sock.write(`:Impostor!i@h NOTICE Dracula :${encodeReport('wrong-secret', new Map([['driveby', 99]]))}\r\n`);
    await wait(4000);
    c('it is refused, out loud', /Refused a regulars report from Impostor: signature/.test(log),
      log.split('\n').filter((l) => /Impostor/.test(l)).join(' | ') || '(silently ignored)');
    c('and nobody is promoted by it',
      !out.some((l) => /FLAGS #batcave-trust driveby \+V/i.test(l)),
      out.filter((l) => /FLAGS/.test(l)).join(' | '));

    try { bot.kill(); } catch (e) { /* gone */ }
    srv.close();
    console.log(f ? `\n${f} FAILED` : '\nALL PASS');
    process.exit(f ? 1 : 0);
});
