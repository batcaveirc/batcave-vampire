// !!image draws a picture for the room. Three things have to hold, and the
// third is the one that matters for a MODERATION bot:
//
//   1. it posts a real, keyless image URL (Pollinations renders on open, so the
//      bot never calls an API and needs no key — proven here with no key in env)
//   2. ordinary prompts are drawn, not refused (a filter that refuses everything
//      is not safe, it is broken)
//   3. the prompts a bot that kicks people for slurs must never render — slurs,
//      explicit sexual content, anything sexual involving minors — are refused
//
// A filter proven only on prompts I invented is not proven. Both lists below —
// must-draw and must-not-draw — are the test, same discipline as the nick filter.
const net = require('net');
const { spawn } = require('child_process');

let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
const now = () => new Date().toISOString().replace(/\.\d+Z$/, '.000Z');
const out = [];
let sock = null;

const srv = net.createServer((s) => {
    sock = s; s.on('error', () => {});
    s.on('data', (d) => {
        for (const l of String(d).split('\r\n')) {
            if (!l) continue;
            out.push(l);
            if (l.startsWith('NICK')) sock.write(':srv 001 Dracula :hi\r\n:srv 376 Dracula :End\r\n');
        }
    });
});

srv.listen(0, '127.0.0.1', async () => {
    const PORT = srv.address().port;
    const bot = spawn('node', ['../action-bot.js'], {
        cwd: __dirname,
        env: {
            ...process.env,
            IRC_SERVER: '127.0.0.1', IRC_PORT: String(PORT), IRC_TLS: 'off', IRC_NICK: 'Dracula',
            IRC_CHANNEL: '#batcave', OWNERS: 'Vikram', WHITELIST: 'LiBu', SENTIENT_ON: 'off',
            GROQ_API_KEY: '', FUN_ON: 'on',
            // a known entry in each list, so the severe/profanity paths are exercised
            // without hardcoding a real slur into the repo
            BADWORDS: 'randoprofanity', SEVERE_WORDS: 'slurword',
            IMG_COOLDOWN_MS: '0',   // fire rapidly; the live cooldown is tested by its existence, not its wall-clock
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout.on('data', () => {}); bot.stderr.on('data', () => {});
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const say = (txt, who = 'Vikram') =>
        sock.write(`@time=${now()} :${who}!${who.toLowerCase()}@h PRIVMSG #batcave :${txt}\r\n`);
    const posted = () => out.filter((l) => /^PRIVMSG #batcave :/.test(l)).join(' | ');
    const drewUrl = () => /image\.pollinations\.ai\/prompt\//.test(out.join(' '));

    await wait(6500);
    sock.write(':srv 353 Dracula = #batcave :@Dracula @Vikram LiBu\r\n:srv 366 Dracula #batcave :End\r\n');
    await wait(1000);

    console.log('— it draws, keylessly, and posts the URL to the room —');
    out.length = 0; say('!!image a gothic castle at dusk'); await wait(1200);
    const u = (out.filter((l) => /image\.pollinations\.ai/.test(l)).pop() || '');
    c('posts a Pollinations URL to the room', /^PRIVMSG #batcave :.*https:\/\/image\.pollinations\.ai\/prompt\//.test(u), u || '(nothing)');
    c('the prompt is URL-encoded into it', /gothic%20castle%20at%20dusk/i.test(u), u || '(nothing)');
    c('worked with NO api key in the environment', !!u, '(nothing posted)');

    console.log('\n— must-NOT-draw: it cannot be turned into a slur/porn generator —');
    for (const bad of ['a naked woman', 'nude teen girl', 'hardcore porn', 'a slurword scrawled on a wall', 'child in a bath']) {
        out.length = 0; say(`!!image ${bad}`); await wait(700);
        c(`refuses "${bad}"`, !drewUrl() && /will not conjure/i.test(out.join(' ')), posted() || '(silent)');
    }

    console.log('\n— must-draw: ordinary prompts are NOT refused —');
    for (const ok of ['a dragon over a snowy mountain', 'sunset on a quiet beach', 'a steaming bowl of ramen', 'a neon city in the rain']) {
        out.length = 0; say(`!!image ${ok}`); await wait(700);
        c(`draws "${ok}"`, drewUrl(), posted() || '(refused or silent)');
    }

    console.log('\n— housekeeping —');
    out.length = 0; say('!!image'); await wait(700);
    c('empty prompt gets usage, not a blank draw', /Usage: !!image/i.test(out.join(' ')) && !drewUrl(), posted() || '(nothing)');

    try { bot.kill('SIGKILL'); } catch (e) {}
    console.log(f ? `\n${f} FAILED` : '\nALL PASS');
    process.exit(f ? 1 : 0);
});
