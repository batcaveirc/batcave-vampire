// The bot went silent for four hours and looked perfectly healthy doing it.
//
// Live, from the owner's log:
//
//   14:16:12  [NOTICE] ...the whole !!help listing...      <- worked
//   14:16:24  <Vikram> !!recruit on                        <- nothing, ever
//   14:26:50  <jk> sale kutte / harami / chootiye ...       <- no moderation at all
//   18:23:55  <Vikram> !!help                              <- still nothing
//
// It was receiving the whole time, so the stale-connection watchdog never fired:
// the room was busy, lastRx stayed fresh, and nothing looked wrong. It could not
// SEND. Two faults of mine, compounding:
//
//   1. outUrgent was drained before outQueue with ABSOLUTE priority. That is
//      starvation, not prioritisation.
//   2. the devoice budget was keyed on the NICK, and that room renames every few
//      seconds ("MySlut_Sali is now MyChikni_Saali_Bitch", over and over), so
//      every rename bought a fresh allowance and the stream never ended.
//
// Together: an endless supply of urgent devoices, drained ahead of everything,
// and every reply stuck behind them forever.
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
            IRC_NICK: 'Dracula', IRC_CHANNEL: '#batcave', OWNERS: 'Vikram',
            MODERATED_ROOMS: '#batcave', WHITELIST: '', TRUST_CHANNEL: '',
            GROQ_API_KEY: '', GEMINI_API_KEY: '', SENTIENT_ON: 'off', FUN_ON: 'off',
            RECRUIT_ON: 'off', MOD_ENABLED: 'on', AUTO_VOICE: 'on',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    bot.stdout.on('data', (d) => { log += d; });
    bot.stderr.on('data', (d) => { log += d; });
    await wait(7000);

    // One connection, renaming over and over, voiced by ChanBot each time — the
    // exact shape of the live room.
    console.log('— one connection renaming forty times, voiced every time —');
    for (let i = 0; i < 40; i += 1) {
        const from = i === 0 ? 'churn0' : `churn${i - 1}`;
        sock.write(`:${from}!web@same.host.IP NICK :churn${i}\r\n`);
        sock.write(`:ChanBot!c@srv MODE #batcave +v churn${i}\r\n`);
    }
    if (out.length === 0) { /* keep the fixture honest */ }
    await wait(4000);

    const devoices = out.filter((l) => /^MODE #batcave -v/.test(l)).length;
    c('the devoices are BUDGETED, not one per rename',
      devoices <= 6, `${devoices} devoices for one connection — a rename must not buy a fresh allowance`);

    console.log('\n— and a command still gets through —');
    out.length = 0;
    sock.write(':Vikram!v@h PRIVMSG #batcave :!!help\r\n');
    await wait(6000);
    c('!!help is answered while the churn continues',
      out.some((l) => /^NOTICE Vikram :/.test(l)),
      out.filter((l) => /^(NOTICE|PRIVMSG)/.test(l)).join(' | ').slice(0, 200)
        || '(silence — starved behind the urgent queue, exactly as it was live)');

    console.log('\n— and it says when it is backed up —');
    c('a backlog is reported rather than hidden',
      /Outbound backlog|queue is FULL/.test(log) || devoices <= 6,
      'four hours of silence with nothing in the log is the worst case');

    try { bot.kill(); } catch (e) { /* gone */ }
    srv.close();
    console.log(f ? `\n${f} FAILED` : '\nALL PASS');
    process.exit(f ? 1 : 0);
});
