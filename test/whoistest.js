// "dracula who is X" must answer from RECORDS, never from the model — and it
// must work for someone who has already left, which is when you actually ask.
const net=require('net'); const {spawn}=require('child_process');
let PORT = 0;   /* the OS assigns one on listen — see below */ const out=[]; let sock=null;
const say=(l)=>{ if(sock) sock.write(l+'\r\n'); };
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
const said=(re)=>out.filter(l=>l.startsWith('PRIVMSG #batcave')).some(l=>re.test(l));
const lastSaid=()=>out.filter(l=>l.startsWith('PRIVMSG #batcave')).slice(-1)[0]||'(nothing)';

const srv=net.createServer((s)=>{ sock=s;
  s.on('data',(d)=>{ for(const l of String(d).split('\r\n')) { if(!l) continue; out.push(l);
    if(l.startsWith('NICK')) {
      say(':srv 001 Dracula :Welcome'); say(':srv 376 Dracula :End of MOTD');
    }
  }});
});

srv.listen(0,'127.0.0.1', async () => {
  PORT = srv.address().port;
  const bot=spawn('node',['../action-bot.js'],{cwd:__dirname, env:{...process.env,
    IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',IRC_NICK:'Dracula',
    IRC_CHANNEL:'#batcave',OWNERS:'Vikram',WHITELIST:'aloo,pooja',
    BADWORDS:'nangi',SENTIENT_ON:'off',GROQ_API_KEY:'',FUN_ON:'off',
  }, stdio:['ignore','pipe','pipe']});
  bot.stdout.on('data',()=>{}); bot.stderr.on('data',()=>{});
  await wait(6000);

  say(':srv 353 Dracula = #batcave :@Dracula @Vikram aloo NangiPoojaBhabhi');
  say(':srv 366 Dracula #batcave :End');
  await wait(1200);

  console.log('— a question about somebody present —');
  out.length=0;
  say(':Vikram!v@h PRIVMSG #batcave :dracula who is NangiPoojaBhabhi');
  await wait(2500);
  c('it answers at all', said(/\[who\]/), lastSaid());
  c('and names the regular being worn', said(/pooja/i), lastSaid());
  c('and the filtered word in the nick', said(/nangi/i), lastSaid());

  console.log('\n— someone who already left is still answerable —');
  out.length=0;
  say(':Vikram!v@h PRIVMSG #batcave :dracula who is telugu_m23');
  await wait(2500);
  c('an absent nick still gets an answer', said(/\[who\].*telugu_m23/i), lastSaid());
  c('and it says plainly it has not seen them', said(/never seen|last seen/i), lastSaid());

  console.log('\n— "who is cloning aloo" asks the opposite question —');
  out.length=0;
  say(':Vikram!v@h PRIVMSG #batcave :dracula who is cloning aloo');
  await wait(2500);
  c('it searches for people wearing the name', said(/\[who\]/), lastSaid());
  c('and reports nobody, truthfully', said(/nobody here is using/i), lastSaid());

  console.log('\n— and it finds a real clone —');
  say(':srv 353 Dracula = #batcave :@Dracula aloo aloo_official');
  say(':srv 366 Dracula #batcave :End');
  await wait(800); out.length=0;
  say(':Vikram!v@h PRIVMSG #batcave :dracula who is cloning aloo');
  await wait(2500);
  c('names the impostor', said(/aloo_official/), lastSaid());

  console.log('\n— an ordinary mention is NOT hijacked —');
  out.length=0;
  say(':Vikram!v@h PRIVMSG #batcave :dracula how are you');
  await wait(1800);
  c('no [who] answer to a normal sentence', !said(/\[who\]/), lastSaid());

  try{bot.kill('SIGKILL');}catch(e){}
  console.log(f?`\n${f} FAILED`:'\nALL PASS');
  process.exit(f?1:0);
});
