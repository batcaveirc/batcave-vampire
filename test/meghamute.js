// The wrongful mute of 2026-10-18, replayed through the real bot.
//
//   <Vikram> can u take the pain tho
//   <Megha>  u know women are all about pain, so yes
//   * Upir88 takes voice from Megha
//   <Upir88> [MOD] Megha — AI: generalized hateful statement. Voice back in 2m.
//   * Vikram gives voice to Megha
//
// The model is faked to flag EVERYTHING, so what is tested is the bot's own
// gates, not the model's mood. Each safeguard gets a control that shows the
// same fake verdict still acts when the safeguard does not apply.
const net = require('net'); const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const REASON = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'reason');
const setReason = (r) => fs.writeFileSync(REASON, r);
setReason('generalized hateful statement');
const out = []; let sock = null;
const srv = net.createServer((s) => { sock = s; s.on('error', () => {}); let buf = '';
  s.on('data', (d) => { buf += d.toString(); const L = buf.split('\r\n'); buf = L.pop();
    for (const l of L) { if (!l.trim()) continue; out.push(l);
      if (/^CAP REQ/.test(l)) s.write(':f CAP * ACK :extended-join account-notify multi-prefix server-time\r\n');
      if (/^NICK/.test(l)) setTimeout(() => s.write(':f 001 Dracula :hi\r\n'), 30);
      if (/^PING/.test(l)) s.write('PONG :x\r\n');
      if (/^JOIN (\S+)/.test(l)) setTimeout(() => s.write(`:Dracula!b@h JOIN :${l.match(/^JOIN (\S+)/)[1]}\r\n`), 20);
      if (/^NAMES (\S+)/.test(l)) { const c = l.match(/^NAMES (\S+)/)[1];
        s.write(`:f 353 Dracula = ${c} :@Dracula @boss megha joker pinto\r\n:f 366 Dracula ${c} :End\r\n`); }
      if (/^WHO (\S+)/.test(l)) s.write(`:f 315 Dracula ${l.match(/^WHO (\S+)/)[1]} :End\r\n`);
    } });
});
srv.listen(0, '127.0.0.1', async () => {
  const bot = spawn('node', ['-r', `${__dirname}/modstub.js`, '../action-bot.js'], { cwd: __dirname,
    env: { ...process.env, IRC_SERVER: '127.0.0.1', IRC_PORT: String(srv.address().port), IRC_TLS: 'off',
      IRC_NICK: 'Dracula', IRC_CHANNEL: '#batcave', OWNERS: 'boss', WHITELIST: '',
      MODERATED_ROOMS: '#batcave', DEVOICE_MINUTES: '1', KICK_UNREGISTERED: 'off',
      GROQ_API_KEY: 'k', GEMINI_API_KEY: '', SENTIENT_ON: 'on', AI_ACTIVE: 'on',
      RAID_GUARD: 'off', STRICT_NICKS: 'off', AUTO_VOICE: 'on', STUB_REASON_FILE: REASON },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; bot.stdout.on('data', (d) => { log += d; }); bot.stderr.on('data', (d) => { log += d; });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const muted = (n) => out.some((l) => new RegExp(`^MODE #batcave -v ${n}$`).test(l));
  const say = (n, t) => sock.write(`:${n}!${n}@h${n.length} PRIVMSG #batcave :${t}\r\n`);
  let f = 0; const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
  await wait(6000);

  console.log('— a remark about a group, no slur —');
  out.length = 0;
  say('megha', 'u know women are all about pain, so yes');
  await wait(1800);
  c('Megha keeps her voice', !muted('megha'), log.split('\n').filter((l) => /AI|MOD/.test(l)).slice(-3).join(' | '));
  c('and the log says why', /about a group, no slur/.test(log));

  console.log('\n— control: the same fake verdict, a non-group reason, nobody staff around —');
  setReason('demeaning abuse');
  out.length = 0;
  say('joker', 'you are honestly a horrible worthless person');
  await wait(1800);
  c('the ordinary case still acts (the gates are not just "off")', muted('joker'),
    log.split('\n').filter((l) => /AI|MOD/.test(l)).slice(-3).join(' | '));

  console.log('\n— a moderator overturns the mute —');
  sock.write(':boss!b@h MODE #batcave +v joker\r\n');
  await wait(800);
  c('the bot records it was overruled', /AI moderation off for joker/.test(log));
  out.length = 0;
  say('joker', 'you are honestly a horrible worthless person');
  await wait(1800);
  c('and leaves them alone afterwards', !muted('joker'));

  console.log('\n— somebody in a conversation with the owner —');
  out.length = 0;
  say('boss', 'can u take the pain tho');
  await wait(300);
  say('pinto', 'you are honestly a horrible worthless person');
  await wait(1800);
  c('is left to the owner, who can see the whole exchange', !muted('pinto'));

  if (f) console.log('\n--- log tail ---\n' + log.slice(-1500));
  console.log(f ? `\n${f} FAILED` : '\nALL PASS');
  bot.kill('SIGKILL'); process.exit(f ? 1 : 0);
});
setTimeout(() => { console.log('timeout'); process.exit(1); }, 60000);
