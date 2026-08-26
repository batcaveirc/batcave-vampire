// An opinion about a group is the category the model gets wrong most often and
// the one where being wrong is most visible. Observed live: somebody
// generalising about how Indians argue was REMOVED on a first offence, in a
// room of Indians who read it as commentary — and another regular left with him.
const net=require('net'); const {spawn}=require('child_process');
let PORT = 0;   /* the OS assigns one on listen */
const out=[]; let sock=null;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const plain=(l)=>l.replace(/\x03\d{0,2}(,\d{1,2})?|[\x02\x0f]/g,'');
const said=(re)=>out.filter(l=>/^PRIVMSG #batcave/.test(l)).some(l=>re.test(plain(l)));
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

const srv=net.createServer((s)=>{ sock=s; s.on('error',()=>{});
  s.on('data',(d)=>{ for(const l of String(d).split('\r\n')) { if(!l) continue; out.push(l);
    if(l.startsWith('NICK')) sock.write(':srv 001 Dracula :hi\r\n:srv 376 Dracula :End\r\n');
  }});
});

srv.listen(0,'127.0.0.1', async () => {
  PORT = srv.address().port;
  const bot=spawn('node',['../action-bot.js'],{cwd:__dirname, env:{...process.env,
    IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',IRC_NICK:'Dracula',
    IRC_CHANNEL:'#batcave',OWNERS:'boss',BADWORDS:'bastard',SEVERE_WORDS:'slurword',
    SENTIENT_ON:'off',GROQ_API_KEY:'',FUN_ON:'off',MODERATED_ROOMS:'#batcave',
  }, stdio:['ignore','pipe','pipe']});
  bot.stdout.on('data',()=>{}); bot.stderr.on('data',()=>{});
  await wait(6500);
  sock.write(':srv 353 Dracula = #batcave :@Dracula @boss joker\r\n:srv 366 Dracula #batcave :End\r\n');
  await wait(1200);

  console.log('— a kick must not be announced as a ban —');
  out.length=0;
  sock.write(':joker!j@h PRIVMSG #batcave :you absolute bastard of a person\r\n');
  await wait(2000);
  sock.write(':joker!j@h PRIVMSG #batcave :you absolute bastard of a person\r\n');
  await wait(2000);
  sock.write(':joker!j@h PRIVMSG #batcave :you absolute bastard of a person\r\n');
  await wait(2500);
  const kicked = out.some(l=>/^KICK #batcave joker/.test(l));
  c('they are eventually removed', kicked, out.filter(l=>/KICK|MODE/.test(l)).join(' | ')||'(nothing)');
  if (kicked) {
    c('and the room is told they can COME BACK', said(/can rejoin/), 
      out.filter(l=>/PRIVMSG #batcave/.test(l)).map(plain).join(' | '));
    c('not that they were banished', !said(/joker banished/),
      'a kick announced as a ban is why a regular left over somebody who could have walked back in');
  }

  console.log('\n— an actual ban still says banished —');
  out.length=0;
  sock.write(':troll!t@h JOIN #batcave\r\n');
  await wait(600);
  sock.write(':troll!t@h PRIVMSG #batcave :you are a slurword and worse\r\n');
  await wait(2500);
  c('severe language still bans', out.some(l=>/MODE #batcave \+b|KICK #batcave troll/.test(l)),
    out.filter(l=>/MODE|KICK/.test(l)).join(' | ')||'(nothing)');
  // A ban announces itself as "banned (<mask>)", a kick as "removed … can
  // rejoin". Different words for different things is the whole point.
  c('and THAT is called banned, with the mask', said(/troll banned \(/),
    out.filter(l=>/PRIVMSG #batcave/.test(l)).map(plain).join(' | ')||'(nothing)');

  try{bot.kill('SIGKILL');}catch(e){}
  console.log(f?`\n${f} FAILED`:'\nALL PASS');
  process.exit(f?1:0);
});
