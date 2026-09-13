// Guarding a carrier range instead of banning it.
//
// The owner traced an abuser to samosa!webchat@…4900.2401.IP and asked to keep
// that range out. This project already measured what that costs: nine cloaks
// on 4900.2401.IP across four idents, of which "king" and "deepak" are
// WHITELISTED REGULARS, and Lucifer wears it too. It is Reliance Jio — a
// national mobile block, not a person.
//
// So the range is guarded, not banned. From it you get in by being registered,
// already trusted, or invited. An attacker may still register — but a
// registered account is an identity that can be banned and STAYS banned, which
// a rotating cloak is not. That is the whole trade.
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const CHAN = '#batcave';
const JIO = '8n1k4o.7820.b2sj.4900.2401.IP';
const sent = [];
let staged = false;
let live = null;

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
                send(`:srv 353 D = ${CHAN} :@D king`);
                send(`:srv 366 D ${CHAN} :end`);
                send(`:srv MODE ${CHAN} +o D`);
                if (staged) continue;
                staged = true;
                // king is a whitelisted regular ON THE SAME RANGE.
                send(`:srv 354 D ${CHAN} webchat ${JIO} king kingacct :real`);
                // An abuser: same range, no account, nobody vouching.
                setTimeout(() => {
                    send(`:samosa!webchat@${JIO} JOIN ${CHAN} * :real`);
                    send(`:srv 354 D ${CHAN} webchat ${JIO} samosa 0 :real`);
                }, 2000);
                // A REGISTERED stranger on the same range — must pass.
                setTimeout(() => {
                    send(`:newguy!webchat@${JIO} JOIN ${CHAN} newguyacct :real`);
                    send(`:srv 354 D ${CHAN} webchat ${JIO} newguy newguyacct :real`);
                }, 3000);
                // A regular on the same range — must pass.
                setTimeout(() => {
                    send(`:king!webchat@${JIO} JOIN ${CHAN} kingacct :real`);
                }, 4000);
                // Somebody unregistered on a DIFFERENT network — untouched.
                setTimeout(() => {
                    send(':outsider!u@1a2b.other.IP JOIN ' + CHAN + ' * :real');
                    send(`:srv 354 D ${CHAN} u 1a2b.other.IP outsider 0 :real`);
                }, 5000);
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
            WHITELIST: 'king', TRUST_CHANNEL: '', MOD_ENABLED: 'on',
            STRICT_NICKS: 'off', RECRUIT_ON: 'off', GROQ_API_KEY: '', GEMINI_API_KEY: '',
            GUARDED_HOSTS: '*.4900.2401.IP',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', () => {});
    bot.stderr.on('data', () => {});

    setTimeout(() => {
        const all = sent.join('\n');
        const kicked = (who) => new RegExp(`^KICK ${CHAN} ${who}\\b`, 'im').test(all);
        c('the unregistered arrival is NOT kicked', !kicked('samosa'),
          sent.filter((l) => /^KICK/.test(l)).join(' | ')
            + ' — a kick reads as punishment for arriving, and cannot be undone by a mod');
        c('they are left without voice instead',
          !/^MODE #batcave \+v samosa\b/im.test(all),
          sent.filter((l) => /MODE #batcave [+-]v samosa/i.test(l)).join(' | '));
        c('and nothing is said in the room about them',
          !/^PRIVMSG #batcave [^\n]*samosa/im.test(all),
          sent.filter((l) => /^PRIVMSG #batcave/.test(l)).join(' | '));
        c('a moderator is told privately, with the reason and the fix',
          /^NOTICE \S+ [^\n]*samosa[^\n]*\+v samosa/im.test(all.replace(/\x03\d{0,2}|[\x02\x0f]/g, '')),
          sent.filter((l) => /^NOTICE/.test(l)).join(' | ') || '(nobody told)');
        c('never a ban',
          !/MODE #batcave \+b [^\n]*samosa/i.test(all) && !/\+b \*!\*@\*\.4900/i.test(all),
          'a ban stops them doing the very thing being asked of them');

        console.log('— and the people who share that carrier —');
        c('a WHITELISTED regular on the same range is untouched', !kicked('king'),
          'king and deepak are real regulars on 4900.2401.IP');
        c('a REGISTERED stranger on the same range is untouched', !kicked('newguy'),
          'registration is the bar, not the carrier');
        c('the range itself is never banned',
          !/\+b [^\n]*4900\.2401/i.test(all),
          'that tail is Reliance Jio — banning it removes a national block');

        console.log('— and nobody else is affected —');
        c('an unregistered person on another network is untouched', !kicked('outsider'),
          'the guard applies to the guarded range only');

        try { bot.kill(); } catch (e) { /* gone */ }
        server.close();
        console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
        process.exit(fails ? 1 : 0);
    }, 15000);
});
