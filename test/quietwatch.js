// Hearing someone organise about us elsewhere must NOT be announced to the room.
// It named a stranger to everybody, about something done somewhere else, before
// they had even arrived. Mods get the detail privately; the room gets a door.
const net=require('net'); const {spawn}=require('child_process');
let PORT = 0;   /* the OS assigns one on listen — see below */ const out=[]; let sock=null;
const say=(l)=>{ if(sock) sock.write(l+'\r\n'); };
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
const pub=()=>out.filter(l=>/^PRIVMSG #/.test(l));
const notices=()=>out.filter(l=>/^NOTICE /.test(l));

const srv=net.createServer((s)=>{ sock=s; s.on('error',()=>{});
  s.on('data',(d)=>{ for(const l of String(d).split('\r\n')) { if(!l) continue; out.push(l);
    if(l.startsWith('NICK')) { say(':srv 001 Dracula :hi'); say(':srv 376 Dracula :End'); }
  }});
});

srv.listen(0,'127.0.0.1', async () => {
  PORT = srv.address().port;
  const bot=spawn('node',['../action-bot.js'],{cwd:__dirname, env:{...process.env,
    IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',IRC_NICK:'Dracula',
    IRC_CHANNEL:'#batcave',OWNERS:'Vikram',WHITELIST:'aloo',BADWORDS:'nangi,randi',
    SENTIENT_ON:'off',GROQ_API_KEY:'',FUN_ON:'off',WATCH_LOCK_AT:'3',
  }, stdio:['ignore','pipe','pipe']});
  bot.stdout.on('data',()=>{}); bot.stderr.on('data',()=>{});
  await wait(6000);
  // Vikram is an owner and present, so he is a moderator to notify.
  say(':srv 353 Dracula = #batcave :@Dracula @Vikram aloo');
  say(':srv 366 Dracula #batcave :End');
  // We are also sitting in a foreign room, as a guest.
  say(':Dracula!d@h JOIN #allindiachat.com');
  await wait(1500); out.length=0;

  console.log('— one hostile heard elsewhere —');
  for (let i=0;i<4;i++) {
    say(`:NangiPoojaBhabhi!x@y PRIVMSG #allindiachat.com :come to #batcave randi log hain wahan`);
    await wait(350);
  }
  await wait(2000);
  c('the ROOM is not told', !pub().some(l=>/WATCH/.test(l)), pub().filter(l=>/WATCH/.test(l)).join('|')||'(silent — correct)');
  c('the stranger is not named publicly', !pub().some(l=>/NangiPoojaBhabhi/.test(l)),
    pub().join('|')||'(nothing said — correct)');
  c('a moderator IS told privately', notices().some(l=>/WATCH.*NangiPoojaBhabhi/.test(l)),
    notices().join('|')||'(no notice — the alert went nowhere)');
  c('and told to Vikram specifically', notices().some(l=>/^NOTICE Vikram/.test(l)), notices().join('|'));
  c('with a command they can act on', notices().some(l=>/!!info|!!unwarn/.test(l)), notices().join('|'));

  console.log('\n— several, inside one window, is a raid forming —');
  out.length=0;
  for (const who of ['randi_two','nangi_three']) {
    for (let i=0;i<4;i++) { say(`:${who}!x@y PRIVMSG #allindiachat.com :everyone go #batcave randi`); await wait(300); }
  }
  await wait(2500);
  c('the doors close BEFORE they arrive', out.some(l=>/^MODE #batcave \+i/.test(l)),
    out.filter(l=>/MODE #batcave/.test(l)).join('|')||'(no lock)');
  c('and the room hears about its own door, not about a person',
    pub().some(l=>/invite-only/.test(l)) && !pub().some(l=>/nangi_three/i.test(l)),
    pub().join('|'));

  try{bot.kill('SIGKILL');}catch(e){}
  console.log(f?`\n${f} FAILED`:'\nALL PASS');
  process.exit(f?1:0);
});
