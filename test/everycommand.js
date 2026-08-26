// Every command the bot ADVERTISES must answer, in every room it treats as its
// own. This is the test that would have caught FindIt: the bot announced a
// round in #batcave-games, and then discarded every !!join typed there because
// the room was not in IRC_CHANNEL — so it could talk and could not hear.
const net=require('net'); const {spawn}=require('child_process');
let PORT = 0;   /* the OS assigns one on listen — see below */
const out=[]; let sock=null;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>new Date().toISOString().replace(/\.\d+Z$/,'.000Z');
const plain=(l)=>l.replace(/\x03\d{0,2}(,\d{1,2})?|[\x02\x0f]/g,'');
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

// Arguments for the ones that need them, and the ones deliberately NOT driven:
// they act on the room or end the process rather than answering.
const ARG = { seen:'LiBu', info:'LiBu', unwarn:'LiBu', badword:'list', whitelist:'list',
  autoban:'list', protect:'list', announce:'hello', mass:'voice', hardban:'',
  join:'', part:'', strict:'', linkfilter:'', raidguard:'', history:'', sentient:'',
  moderate:'', autovoice:'', fun:'', recruit:'', hotseat:'LiBu', toast:'LiBu' };
const SKIP = new Set(['join','part','mass','hardban','announce','history','endgame']);

const srv=net.createServer((s)=>{ sock=s;
  s.on('data',(d)=>{ for(const l of String(d).split('\r\n')) { if(!l) continue; out.push(l);
    if(l.startsWith('NICK')) sock.write(':srv 001 Dracula :hi\r\n:srv 376 Dracula :End\r\n');
  }});
});

srv.listen(0,'127.0.0.1', async () => {
  PORT = srv.address().port;
  const bot=spawn('node',['../action-bot.js'],{cwd:__dirname, env:{...process.env,
    IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',IRC_NICK:'Dracula',
    IRC_CHANNEL:'#batcave',FINDIT_ROOM:'#batcave-games',OWNERS:'Vikram',
    WHITELIST:'LiBu',SENTIENT_ON:'off',GROQ_API_KEY:'',FUN_ON:'on',
  }, stdio:['ignore','pipe','pipe']});
  bot.stdout.on('data',()=>{}); bot.stderr.on('data',()=>{});
  // Distinct hosts per nick: FindIt allows one seat per connection, so sharing a
// host made the second player's join a correct refusal rather than a bug.
const HOST = { Vikram:'v@one.example', LiBu:'l@two.example' };
const say=(room,who,txt)=>sock.write(`@time=${now()} :${who}!${HOST[who]||who.toLowerCase()+'@h'} PRIVMSG ${room} :${txt}\r\n`);

// The joke commands share a fifteen-second per-nick cooldown, which is correct
// — one person cannot wall the room with them — but it means one caller can
// only prove ONE of them per run. A fresh nick per command tests whether each
// actually works, which is the question being asked.
const FUN = new Set(['bite','8ball','ship','slap','fortune','rip','vibe','hug','pat',
  'icebreaker','ask','hotseat','story','toast']);
let testerN = 0;
const callerFor = (cmd) => (FUN.has(cmd) ? `Tester${++testerN}` : 'Vikram');
  await wait(6500);
  for (const room of ['#batcave','#batcave-games']) {
    sock.write(`:srv 353 Dracula = ${room} :@Dracula @Vikram LiBu\r\n:srv 366 Dracula ${room} :End\r\n`);
  }
  await wait(1000);

  console.log('— the games room must be one of ours —');
  c('Dracula JOINs the FindIt room', out.some(l=>/^JOIN .*#batcave-games/.test(l)),
    out.filter(l=>/^JOIN/.test(l)).join(' | ')||'(never joined)');

  out.length=0; say('#batcave','Vikram','!!help'); await wait(1500);
  const helpText = out.filter(l=>/^NOTICE Vikram/.test(l)).map(plain).join(' ');
  const advertised = [...new Set((helpText.match(/!!([a-z]+)/g)||[]).map(x=>x.slice(2)))]
    .filter(x=>!SKIP.has(x));
  c('!!help answers', helpText.length > 0, '(nothing)');
  c('and lists commands', advertised.length >= 10, `found ${advertised.length}`);
  console.log(`    advertises: ${advertised.join(' ')}`);

  console.log('\n— every advertised command answers, in BOTH rooms —');
  for (const room of ['#batcave','#batcave-games']) {
    const dead = [];
    for (const cmd of advertised) {
      out.length=0;
      say(room, callerFor(cmd), `!!${cmd}${ARG[cmd] ? ' ' + ARG[cmd] : ''}`);
      await wait(600);
      if (!out.some(l=>/^(NOTICE \S+|PRIVMSG #|MODE |TOPIC )/.test(l))) dead.push(cmd);
    }
    c(`all ${advertised.length} answer in ${room}`, dead.length === 0,
      `SILENT: ${dead.map(d=>'!!'+d).join(' ')}`);
  }

  console.log('\n— FindIt: the bug the owner hit —');
  out.length=0; say('#batcave','Vikram','!!findit'); await wait(2500);
  c('a round opens', out.some(l=>/FINDIT/.test(plain(l))), out.filter(l=>/PRIVMSG/.test(l)).map(plain).join(' | ')||'(nothing)');
  const hosted = out.filter(l=>/PRIVMSG #batcave-games .*FINDIT/.test(plain(l))).length > 0;
  c('hosted in the games room', hosted, out.filter(l=>/FINDIT/.test(plain(l))).map(plain).join(' | '));

  out.length=0; say('#batcave-games','Vikram','!!join'); await wait(1200);
  c('!!join in the games room is HEARD',
    out.some(l=>/aboard|joined|crew|Welcome/i.test(plain(l))),
    out.map(plain).filter(Boolean).join(' | ')||'(nothing — the bot cannot hear its own game room)');

  out.length=0; say('#batcave-games','LiBu','!!join'); await wait(1200);
  c('a second player can join too',
    out.some(l=>/aboard|joined|crew|2\/|Welcome/i.test(plain(l))),
    out.map(plain).filter(Boolean).join(' | ')||'(nothing)');

  out.length=0; say('#batcave-games','Vikram','!!endgame'); await wait(1000);
  c('and the round can be stopped from there', out.some(l=>/stopped/i.test(plain(l))),
    out.map(plain).filter(Boolean).join(' | ')||'(nothing)');

  try{bot.kill('SIGKILL');}catch(e){}
  console.log(f?`\n${f} FAILED`:'\nALL PASS');
  process.exit(f?1:0);
});
