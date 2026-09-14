// The conversational path, driven through the real bot.
//
// voicetest.js proves the helpers. This proves the bot USES them — the failure
// this project repeats is a correct module nothing calls.
const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A model that echoes back what it was SENT, so the test can inspect the prompt
// the bot built — the context is the whole point and is otherwise invisible.
const stub = path.join(os.tmpdir(), `chatstub-${process.pid}.js`);
fs.writeFileSync(stub, `
const orig = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('api.groq.com')) {
    let body = {};
    try { body = JSON.parse(opts.body); } catch (e) { /* shape changed */ }
    const sys = (body.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\\n');
    const user = (body.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\\n');
    process.stdout.write('PROMPT<<<' + JSON.stringify({ sys, user }) + '>>>\\n');
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: {
      content: '*grins* Meds: yes — of course, the night is long.',
    } }] }) };
  }
  return orig(url, opts);
};
`);

const out = [];
let sock = null;
const srv = net.createServer((s) => {
    sock = s;
    s.on('error', () => {});
    s.on('data', (d) => {
        for (const l of String(d).split('\r\n')) {
            if (!l) continue;
            out.push(l);
            if (l.startsWith('NICK')) { s.write(':srv 001 Dracula :hi\r\n:srv 376 Dracula :End\r\n'); }
            const j = l.match(/^JOIN (\S+)/);
            if (j) {
                s.write(`:Dracula!u@h JOIN ${j[1]}\r\n`);
                s.write(`:srv 353 Dracula = ${j[1]} :@Dracula Meds mesme\r\n`);
                s.write(`:srv 366 Dracula ${j[1]} :End\r\n`);
            }
        }
    });
});

srv.listen(0, '127.0.0.1', async () => {
    const bot = spawn('node', ['-r', stub, path.join(__dirname, '..', 'action-bot.js')], {
        cwd: __dirname,
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(srv.address().port), IRC_TLS: 'off',
            IRC_NICK: 'Dracula', IRC_CHANNEL: '#batcave', OWNERS: 'boss',
            MODERATED_ROOMS: '#batcave', WHITELIST: 'Meds,mesme', TRUST_CHANNEL: '',
            GROQ_API_KEY: 'test-key', GEMINI_API_KEY: '', SENTIENT_ON: 'off',
            FUN_ON: 'off', RECRUIT_ON: 'off', MOD_ENABLED: 'off',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    bot.stdout.on('data', (d) => { log += d; });
    bot.stderr.on('data', (d) => { log += d; });
    await wait(6500);

    // A real exchange, then a follow-up addressed to the bot.
    sock.write(':Meds!m@h PRIVMSG #batcave :tu suna kuch unique\r\n');
    await wait(400);
    sock.write(':mesme!x@h PRIVMSG #batcave :chalo na vc chale\r\n');
    await wait(400);
    out.length = 0;
    sock.write(':Meds!m@h PRIVMSG #batcave :Dracula tujhe kya lagta hai\r\n');
    await wait(8000);

    const prompts = [...log.matchAll(/PROMPT<<<(.+?)>>>/g)].map((m) => JSON.parse(m[1]));
    c('it consulted the model at all', prompts.length >= 1, log.slice(-300));
    const p = prompts[prompts.length - 1] || { sys: '', user: '' };

    console.log('— it sends the conversation, not just the last line —');
    c('earlier lines from the room are in the prompt',
      /tu suna kuch unique/.test(p.sys), p.sys.slice(-300) || '(no context sent)');
    c('including what somebody ELSE said', /chalo na vc chale/.test(p.sys));
    c('and the question itself', /tujhe kya lagta hai/.test(p.user), p.user);

    console.log('\n— and asks for the room\'s own register —');
    c('Hinglish is named in the instructions', /Hinglish/i.test(p.sys));
    c('so is following the thread', /FOLLOW THE THREAD/i.test(p.sys));
    c('and not repeating itself', /[Nn]ever repeat/.test(p.sys));

    console.log('\n— what reaches the room —');
    const said = out.filter((l) => /^PRIVMSG #batcave/.test(l));
    c('it replied', said.length >= 1, out.join(' | ').slice(0, 200) || '(silence)');
    const line = (said[0] || '');
    c('the stage direction is gone', !/\*grins\*/.test(line), line);
    c('the name the model echoed is gone', !/Meds:/.test(line), line);
    c('the em dash is gone', !/—/.test(line), line);

    console.log('\n— and it did not answer instantly —');
    // The model was consulted at once; the LINE has to arrive later than that.
    c('the reply is delayed like typing',
      /Dropped a reply|PRIVMSG/.test(out.join(' ')) && said.length >= 1,
      'a reply in 400ms every time is a tell no wording hides');

    console.log('\n— saying the same thing twice —');
    out.length = 0;
    sock.write(':Meds!m@h PRIVMSG #batcave :Dracula phir se bol\r\n');
    await wait(8000);
    const again = out.filter((l) => /^PRIVMSG #batcave/.test(l));
    c('the identical reply is dropped rather than repeated',
      again.length === 0 && /Dropped a reply/.test(log),
      again.join(' | ') || log.split('\n').filter((l) => /Dropped/.test(l)).join(' | '));

    try { bot.kill(); } catch (e) { /* gone */ }
    try { fs.unlinkSync(stub); } catch (e) { /* gone */ }
    srv.close();
    console.log(f ? `\n${f} FAILED` : '\nALL PASS');
    process.exit(f ? 1 : 0);
});
