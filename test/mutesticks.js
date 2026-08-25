// A flagged arrival was muted and then re-voiced five seconds later, because
// the de-voice was never recorded in `serving` and a moderated room voices
// everyone by default. Observed live on Bilal_Hussain_Roles at 14:58:33/38.
const net=require('net'); const {spawn}=require('child_process');
let PORT = 0;   /* the OS assigns one on listen — see below */ const out=[]; let sock=null;
const say=(l)=>{ if(sock) sock.write(l+'\r\n'); };
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
const modes=()=>out.filter(l=>/^MODE #batcave [-+]v Bilal/i.test(l));
const pub=()=>out.filter(l=>/^PRIVMSG #batcave/.test(l));
const notices=()=>out.filter(l=>/^NOTICE /.test(l));

const srv=net.createServer((s)=>{ sock=s;
  s.on('data',(d)=>{ for(const l of String(d).split('\r\n')) { if(!l) continue; out.push(l);
    if(l.startsWith('NICK')) { say(':srv 001 Dracula :hi'); say(':srv 376 Dracula :End'); }
  }});
});

srv.listen(0,'127.0.0.1', async () => {
  PORT = srv.address().port;
  const bot=spawn('node',['../action-bot.js'],{cwd:__dirname, env:{...process.env,
    IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',IRC_NICK:'Dracula',
    IRC_CHANNEL:'#batcave',OWNERS:'Vikram',WHITELIST:'aloo',BADWORDS:'nangi',
    MODERATED_ROOMS:'#batcave',AUTOVOICE:'on',SENTIENT_ON:'off',GROQ_API_KEY:'',FUN_ON:'off',
  }, stdio:['ignore','pipe','pipe']});
  bot.stdout.on('data',()=>{}); bot.stderr.on('data',()=>{});
  await wait(6000);
  // We hold ops, Vikram is an owner-moderator present.
  say(':srv 353 Dracula = #batcave :@Dracula @Vikram aloo');
  say(':srv 366 Dracula #batcave :End');
  say(':Dracula!d@h JOIN #chatsansar');
  await wait(1500);

  // Heard advertising our room elsewhere, repeatedly — enough to be flagged.
  for (let i=0;i<4;i++){ say(':Bilal!b@x PRIVMSG #chatsansar :join #batcave now'); await wait(320); }
  await wait(1500); out.length=0;

  console.log('— then they arrive —');
  say(':Bilal!b@x JOIN #batcave');
  await wait(2000);
  c('voice is taken', modes().some(l=>/-v Bilal/i.test(l)), modes().join('|')||'(no mode set)');

  console.log('\n— and it must still be off ten seconds later —');
  await wait(10000);
  // Order matters, not the raw count: a +v BEFORE the -v is the ordinary
  // arrival voice, applied before we know they are flagged. What must never
  // happen is a +v AFTER the mute.
  const seq = modes();
  console.log('    sequence: ' + (seq.join('  ') || '(none)'));
  const lastMute = seq.map(l=>/-v/.test(l)).lastIndexOf(true);
  const after = lastMute < 0 ? [] : seq.slice(lastMute+1).filter(l=>/\+v/i.test(l));
  c('voice was NOT handed back after the mute', after.length === 0, after.join('|'));
  c('and they did end up muted', lastMute >= 0 && lastMute === seq.length-1,
    `last action was ${seq[seq.length-1]||'nothing'}`);

  console.log('\n— nobody is named to the room —');
  c('no public announcement', !pub().some(l=>/Bilal/i.test(l)),
    pub().filter(l=>/Bilal/i.test(l)).join('|')||'(room stayed quiet — correct)');
  c('the PERSON is told why', notices().some(l=>/^NOTICE Bilal .*without voice/i.test(l)),
    notices().filter(l=>/Bilal/.test(l)).join('|')||'(they were muted with no explanation)');
  c('a moderator is told', notices().some(l=>/^NOTICE Vikram .*WATCH/.test(l)),
    notices().join('|'));

  try{bot.kill('SIGKILL');}catch(e){}
  console.log(f?`\n${f} FAILED`:'\nALL PASS');
  process.exit(f?1:0);
});
