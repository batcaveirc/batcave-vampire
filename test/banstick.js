// A ban has to outlive the channel.
//
// The owner: "the invited users and banned users list gets empty everytime
// chanbot resets is there a fix for that?"
//
// There is, and the reason it is needed is a property of IRC rather than a bug:
// +b and +I live in the SERVER's memory for a channel, and a channel exists only
// while somebody is in it. Empty the room, split the net, cycle the service —
// and every ban a moderator set is simply gone. Nothing in the bot noticed,
// because from the bot's point of view nothing happened.
//
// Atheme keeps lists that do survive all of that:
//
//   AKICK           a permanent ban list, re-enforced on join by ChanServ
//   FLAGS <x> +i    may invite themselves in — the durable form of a +I entry,
//                   and ChanServ accepts a HOSTMASK here (verified live in this
//                   project: "Flags +V were set on Carmilla!*@*")
//
// So each ban a moderator sets is mirrored into the list that survives. The
// owner has already settled the policy this rests on: "once they are banned by
// mod i dont want to invite them back and they should stay banned."
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
            const j = l.match(/^JOIN (\S+)/);
            if (j) {
                s.write(`:Dracula!u@h JOIN ${j[1]}\r\n`);
                s.write(`:srv 353 Dracula = ${j[1]} :@Dracula @Vikram\r\n`);
                s.write(`:srv 366 Dracula ${j[1]} :End\r\n`);
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
            MODERATED_ROOMS: '#batcave', WHITELIST: '', TRUST_CHANNEL: '',
            GROQ_API_KEY: '', GEMINI_API_KEY: '', SENTIENT_ON: 'off', FUN_ON: 'off',
            RECRUIT_ON: 'off', MOD_ENABLED: 'on',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    bot.stdout.on('data', (d) => { log += d; });
    bot.stderr.on('data', (d) => { log += d; });
    await wait(7000);

    console.log('— a moderator bans somebody —');
    out.length = 0;
    sock.write(':Vikram!v@h MODE #batcave +b samosa!*@8n1k4o.7820.b2sj.4900.2401.IP\r\n');
    await wait(2500);
    c('it is written to the list that survives a reset',
      out.some((l) => /^PRIVMSG ChanServ :AKICK #batcave ADD samosa!\*@8n1k4o\.7820\.b2sj\.4900\.2401\.IP/.test(l)),
      out.filter((l) => /ChanServ/.test(l)).join(' | ') || '(the ban lives only in the channel)');
    c('permanently, because a ban that quietly expires is worse than none',
      out.some((l) => /AKICK #batcave ADD \S+ !P/.test(l)),
      out.filter((l) => /AKICK/.test(l)).join(' | '));
    c('and it says so, with how to undo it',
      /AKICK|stays banned|survive/i.test(log),
      log.split('\n').filter((l) => /AKICK|ban/i.test(l)).slice(-2).join(' | ') || '(silent)');

    console.log('\n— an invite exception, which is the other half of the question —');
    out.length = 0;
    sock.write(':Vikram!v@h MODE #batcave +I king!*@*.4900.2401.IP\r\n');
    await wait(2500);
    c('is mirrored as "may invite themselves", which survives too',
      out.some((l) => /^PRIVMSG ChanServ :FLAGS #batcave king!\*@\*\.4900\.2401\.IP \+i/.test(l)),
      out.filter((l) => /FLAGS #batcave/.test(l)).join(' | ') || '(nothing stored)');

    console.log('\n— what it must NOT mirror —');
    out.length = 0;
    // Removing a ban is a moderator's decision and has to reach the durable
    // list too, or the ban comes back by itself and looks like a bug.
    sock.write(':Vikram!v@h MODE #batcave -b samosa!*@8n1k4o.7820.b2sj.4900.2401.IP\r\n');
    await wait(2000);
    c('lifting a ban also lifts the permanent one',
      out.some((l) => /^PRIVMSG ChanServ :AKICK #batcave DEL samosa!/.test(l)),
      out.filter((l) => /AKICK/.test(l)).join(' | ') || '(the ban would come back by itself)');

    out.length = 0;
    // Mirroring a service's own enforcement back into that service is a loop,
    // and ChanServ and ChanBot already keep their own durable lists.
    sock.write(':ChanServ!s@srv MODE #batcave +b spammer!*@*\r\n');
    await wait(1500);
    sock.write(':ChanBot!c@srv MODE #batcave +b flooder!*@*\r\n');
    await wait(1500);
    c('a ban set by a SERVICE is not written back to it',
      !out.some((l) => /AKICK #batcave ADD (spammer|flooder)/.test(l)),
      out.filter((l) => /AKICK/.test(l)).join(' | '));

    console.log('\n— and the bot\'s OWN bans are kept too —');
    out.length = 0;
    // These are the ones that matter most: Dracula bans abusers automatically,
    // and those were plain +b that vanished with the channel like anybody
    // else's. The first version of this excluded them, having been copied from
    // the fleet check above, where not acting on your own change is the point.
    sock.write(':Dracula!u@h MODE #batcave +b abuser!*@bad.host\r\n');
    await wait(2000);
    c('a ban the bot set itself also survives a reset',
      out.some((l) => /AKICK #batcave ADD abuser!\*@bad\.host !P/.test(l)),
      out.filter((l) => /AKICK/.test(l)).join(' | ') || '(its own bans were left volatile)');

    out.length = 0;
    sock.write(':Vikram!v@h MODE #batcave +o someone\r\n');
    await wait(1500);
    c('and an ordinary mode change is left alone',
      !out.some((l) => /AKICK|FLAGS #batcave someone/.test(l)),
      out.filter((l) => /ChanServ/.test(l)).join(' | '));

    try { bot.kill(); } catch (e) { /* gone */ }
    srv.close();
    console.log(f ? `\n${f} FAILED` : '\nALL PASS');
    process.exit(f ? 1 : 0);
});
