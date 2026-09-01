// The foyer, driven the way it actually runs.
//
// Two things the owner watched go wrong in the room:
//   "it keeps inviting user again and again i think once was enough"
//   "we dont need it to invite regular ppl to the rooms automatic right ?"
// and the room it kept inviting people to was the OPEN one, which nobody has
// ever needed an invitation for.
//
// All three are invisible to a source-text test, and every other test of this
// feature is a source-text test. This boots the real bot against a fake server
// with two rooms — one +i, one open — and counts the invites that come out.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const LOCKED = '#batcave';
const OPEN = '#foyer';

function run(carryPeople, done) {
    const sent = [];
    const server = net.createServer((sock) => {
        sock.setEncoding('utf8');
        sock.on('error', () => {});          // the bot dying must not crash the fixture
        const send = (l) => sock.write(l + '\r\n');
        let buf = '';
        sock.on('data', (d) => {
            buf += d;
            const lines = buf.split('\r\n');
            buf = lines.pop();
            for (const l of lines) {
                sent.push(l);
                if (l.startsWith('NICK')) { send(':srv 001 D :hi'); send(':srv 376 D :end'); }
                const j = l.match(/^JOIN (\S+)/);
                if (j) {
                    const ch = j[1];
                    send(`:D!u@h JOIN ${ch}`);
                    // Johnny sits in the OPEN room and is absent from the locked one.
                    send(ch === LOCKED
                        ? `:srv 353 D = ${ch} :@D someone`
                        : `:srv 353 D = ${ch} :@D johnny`);
                    send(`:srv 366 D ${ch} :end`);
                    send(`:srv MODE ${ch} +o D`);
                }
                const m = l.match(/^MODE (\S+)\s*$/);
                if (m) send(m[1] === LOCKED ? `:srv 324 D ${m[1]} +int` : `:srv 324 D ${m[1]} +nt`);
                const w = l.match(/^WHO (\S+)/);
                if (w && w[1] === OPEN) {
                    send(`:srv 354 D ${OPEN} u host johnny johnnyacct :a person`);
                    send(`:srv 315 D ${OPEN} :End of WHO`);
                } else if (w) {
                    send(`:srv 315 D ${w[1]} :End of WHO`);
                }
            }
        });
    });

    server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const env = {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(port), IRC_TLS: '0',
            IRC_NICK: 'D', IRC_CHANNEL: `${LOCKED},${OPEN}`, OWNERS: 'vikram',
            WHITELIST: 'johnny', TRUST_CHANNEL: '', MOD_ENABLED: 'on',
            RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
            CHORUS_CHANNEL: OPEN, CHORUS_MARK: 'BatCave community member',
            CARRY_PEOPLE: carryPeople,
        };
        const bot = spawn(process.execPath, [path.join(__dirname, '..', 'action-bot.js')],
            { env, stdio: ['ignore', 'pipe', 'pipe'] });
        bot.stdout.on('data', () => {});
        bot.stderr.on('data', () => {});
        setTimeout(() => {
            const invites = sent.filter((l) => /^INVITE /.test(l));
            try { bot.kill(); } catch (e) { /* gone */ }
            server.close();
            done({
                invites,
                toLocked: invites.filter((l) => l.includes(LOCKED)),
                toOpen: invites.filter((l) => l.includes(OPEN)),
                sweeps: sent.filter((l) => /^WHO /.test(l)).length,
                askedModes: sent.some((l) => /^MODE #/.test(l)),
            });
        }, 11000);
    });
}

console.log('— opted in (CARRY_PEOPLE=on) —');
run('on', (r) => {
    c('it swept more than once', r.sweeps >= 2, `only ${r.sweeps} WHO — a repeat could not show up`);
    c('a locked-out regular IS carried in', r.toLocked.some((l) => /johnny/i.test(l)),
      r.invites.join(' | ') || '(no invite at all)');
    c('exactly once, however many sweeps run',
      r.toLocked.filter((l) => /johnny/i.test(l)).length === 1,
      `${r.toLocked.filter((l) => /johnny/i.test(l)).length} invites across ${r.sweeps} sweeps`);
    c('and NEVER into the open room', r.toOpen.length === 0,
      r.toOpen.join(' | ') + ' — an open door needs no invitation');
    c('it asked what the door state was', r.askedModes,
      'without this it cannot tell a locked room from an open one');

    console.log('\n— the default, which is what the room actually runs —');
    run('', (d) => {
        c('a regular is NOT invited anywhere', !d.invites.some((l) => /johnny/i.test(l)),
          d.invites.join(' | ') + ' — nobody asked to be moved');
        c('and the sweep still ran, so this is a decision and not an accident',
          d.sweeps >= 2, `${d.sweeps} sweeps`);
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    });
});
