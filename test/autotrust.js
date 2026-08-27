// Standing that follows behaviour, driven through the real bot.
const net=require('net'); const {spawn}=require('child_process');
let PORT = 0;   /* the OS assigns one on listen */
const out=[]; let sock=null;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const plain=(l)=>l.replace(/\x03\d{0,2}(,\d{1,2})?|[\x02\x0f]/g,'');
const notices=()=>out.filter(l=>/^NOTICE /.test(l)).map(plain);
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

const srv=net.createServer((s)=>{ sock=s; s.on('error',()=>{});
  s.on('data',(d)=>{ for(const l of String(d).split('\r\n')) { if(!l) continue; out.push(l);
    if(l.startsWith('NICK')) sock.write(':srv 001 Dracula :hi\r\n:srv 376 Dracula :End\r\n');
    // Answer a FLAGS listing so the trust channel is considered live.
    if(/PRIVMSG ChanServ :FLAGS #batcave-trust$/.test(l)) {
      sock.write(':ChanServ!s@srv NOTICE Dracula :Entry Nickname/Host          Flags\r\n');
      sock.write(':ChanServ!s@srv NOTICE Dracula :1     Vikram                 +AFORVefiorstv (FOUNDER)\r\n');
      sock.write(':ChanServ!s@srv NOTICE Dracula :2     JAILER                 +V\r\n');
      sock.write(':ChanServ!s@srv NOTICE Dracula :End of #batcave-trust FLAGS listing.\r\n');
    }
  }});
});

srv.listen(0,'127.0.0.1', async () => {
  PORT = srv.address().port;
  const bot=spawn('node',['../action-bot.js'],{cwd:__dirname, env:{...process.env,
    IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',IRC_NICK:'Dracula',
    IRC_CHANNEL:'#batcave',OWNERS:'boss',WHITELIST:'seeded',TRUST_CHANNEL:'#batcave-trust',
    SEVERE_WORDS:'slurword',BADWORDS:'fuck,bastard',SENTIENT_ON:'off',GROQ_API_KEY:'',
    FUN_ON:'off',AUTO_TRUST:'on',MODERATED_ROOMS:'#batcave',
  }, stdio:['ignore','pipe','pipe']});
  bot.stdout.on('data',()=>{}); bot.stderr.on('data',()=>{});
  const say=(who,txt)=>sock.write(`:${who}!u@h PRIVMSG #batcave :${txt}\r\n`);
  await wait(6500);
  sock.write(':srv 353 Dracula = #batcave :@Dracula @boss JAILER soul\r\n:srv 366 Dracula #batcave :End\r\n');
  await wait(11000);   // the FLAGS request is deliberately delayed after join

  console.log('— the trust channel is the store —');
  out.length=0; say('boss','!!trust');
  await wait(1200);
  c('it lists what ChanServ holds', notices().some(l=>/Trusted \(2/.test(l)),
    notices().join(' | ')||'(nothing)');
  c('and names the channel it came from', notices().some(l=>/#batcave-trust/.test(l)));

  console.log('\n— adding somebody writes to ChanServ, not to a secret —');
  out.length=0; say('boss','!!trust add Nessie');
  await wait(1200);
  c('it edits the access list', out.some(l=>/PRIVMSG ChanServ :FLAGS #batcave-trust Nessie \+V/.test(l)),
    out.filter(l=>/ChanServ/.test(l)).join(' | ')||'(nothing)');
  c('and says it survives restarts', notices().some(l=>/survives restarts/.test(l)), notices().join(' | '));

  console.log('\n— behaviour takes it away —');
  out.length=0; say('JAILER','you slurword piece of work');
  await wait(1800);
  c('severe language removes them from the store',
    out.some(l=>/PRIVMSG ChanServ :FLAGS #batcave-trust JAILER -V/.test(l)),
    out.filter(l=>/ChanServ|TRUST/.test(l)).map(plain).join(' | ')||'(nothing)');
  c('a moderator is told, with the reason',
    notices().some(l=>/TRUST.*JAILER.*no longer a trusted regular.*severe language/.test(l)),
    notices().join(' | ')||'(nobody told)');
  c('and told how to undo it', notices().some(l=>/!!trust add JAILER/.test(l)));

  console.log('\n— the blunt command still works —');
  out.length=0; say('boss','!!untrust add soul');
  await wait(1200);
  c('!!untrust still exists', notices().some(l=>/soul is untrusted/.test(l)), notices().join(' | '));
  out.length=0; say('boss','!!untrust');
  await wait(1200);
  // Asserts the INTENT, not a count. The listing now reads from the trust
  // channel's deny entries rather than the runtime set, so the number depends
  // on what the channel already holds — which is the point of storing it there.
  c('and lists who is on it', notices().some(l=>/Untrusted \(\d+\).*soul/.test(l)),
    notices().join(' | '));
  c('and says where the list came from',
    notices().some(l=>/from #batcave-trust/.test(l)), notices().join(' | '));

  try{bot.kill('SIGKILL');}catch(e){}
  console.log(f?`\n${f} FAILED`:'\nALL PASS');
  process.exit(f?1:0);
});
