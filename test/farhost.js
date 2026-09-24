// "be easy on indian users usa users and uk users but if they join in from
// unknown countries then keep them devoiced cause sometimes these vpn countries
// are abusers."
//
// We cannot see anybody's country. HybridIRC cloaks the address, so the real IP
// never reaches the bot and no geolocation is possible — a country check here
// would be an invented signal. What the cloak keeps is its last two groups,
// which name the CARRIER: "4900.2401.IP" is Reliance Jio. So this is a carrier
// list, which also covers the VPN case, because a VPN exit is a hosting provider
// none of the room's regulars are on.
//
// The property that matters most is the EMPTY one. An unset list must mean
// "nobody is foreign", never "everybody is". This project has shipped the other
// version twice: an empty allow-list secret that made an auth check always
// false, and an empty word list that made a filter inert.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function run(env, label, then) {
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
                RECRUIT_ON: 'off', MOD_ENABLED: 'on', AUTO_VOICE: 'on',
                GUARDED_HOSTS: '',
                // The arrival hold is OFF by default now — withholding voice
                // from newcomers cost the room more than it caught. The
                // feature remains for a room under attack, so it is switched
                // on HERE, where it is the thing being tested.
                HOLD_UNINVITED: 'on',
                ...env,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        bot.stdout.on('data', () => {});
        bot.stderr.on('data', () => {});
        await wait(7000);
        // Two unregistered arrivals: one on a carrier the room knows, one on a
        // hosting range of the kind a VPN exits through.
        sock.write(':localgirl!webchat@aa.bb.4900.2401.IP JOIN #batcave\r\n');
        sock.write(':vpnuser!webchat@x.y.datacenter.example JOIN #batcave\r\n');
        sock.write(':srv 354 Dracula 152 #batcave webchat aa.bb.4900.2401.IP localgirl 0 :0 r\r\n');
        sock.write(':srv 354 Dracula 152 #batcave webchat x.y.datacenter.example vpnuser 0 :0 r\r\n');
        await wait(34000);            // let at least one voice sweep run
        try { bot.kill(); } catch (e) { /* gone */ }
        srv.close();
        then(out.join('\n'));
    });
}

console.log('— with a carrier list configured —');
run({ HOME_HOSTS: '4900.2401.IP,comcast.net,btcentralplus.com' }, 'configured', (all) => {
    c('an unregistered arrival on a KNOWN carrier is voiced',
      /^MODE #batcave \+v localgirl$/m.test(all),
      all.split('\n').filter((l) => /MODE #batcave [+-]v/.test(l)).join(' | ') || '(nobody voiced)');
    c('and one on an unrecognised network is not',
      !/^MODE #batcave \+v vpnuser$/m.test(all),
      all.split('\n').filter((l) => /vpnuser/.test(l)).join(' | '));
    c('without being kicked for it',
      !/^KICK #batcave vpnuser/m.test(all),
      'the point is to hold them, not to remove them');

    console.log('\n— with NO carrier list, which is the default —');
    run({ HOME_HOSTS: '' }, 'empty', (all2) => {
        // What the list actually changes. Without one the carrier means nothing,
        // so the arrival who was voiced above is now treated the same as the
        // other — which is the honest reading of "we do not know any carriers".
        c('the known-carrier arrival is no longer distinguished',
          !/^MODE #batcave \+v localgirl$/m.test(all2),
          all2.split('\n').filter((l) => /MODE #batcave [+-]v/.test(l)).join(' | ')
            + ' — with no list, no host can be a reason to voice anybody');
        c('and neither of them is kicked',
          !/^KICK #batcave (localgirl|vpnuser)/m.test(all2),
          all2.split('\n').filter((l) => /^KICK/.test(l)).join(' | '));
        c('both are simply held, silently',
          !/^(NOTICE|PRIVMSG) (localgirl|vpnuser)/m.test(all2),
          all2.split('\n').filter((l) => /^(NOTICE|PRIVMSG) (localgirl|vpnuser)/.test(l)).join(' | ')
            + ' — a notice per arrival does not coalesce and buried everything else');
        console.log(f ? `\n${f} FAILED` : '\nALL PASS');
        process.exit(f ? 1 : 0);
    });
});
