// End to end over a socket: the real standby gets ops, an impostor wearing the
// same nick gets nothing and is named out loud.
const net=require('net'); const {spawn}=require('child_process');
const { Handshake } = require('../handshake.js');
const SECRET='shared-peer-secret-xyz';
const PORT=6718; const out=[]; let sock=null; let challenge=null;
const srv=net.createServer((s)=>{sock=s;let buf='';
 s.on('data',(d)=>{buf+=d.toString();const L=buf.split('\r\n');buf=L.pop();
  for(const l of L){if(!l.trim())continue;out.push(l);
   const c=l.match(/^NOTICE (\S+) :AUTH (\S+)$/); if(c) challenge={to:c[1],nonce:c[2]};
   if(/^NICK/.test(l))setTimeout(()=>s.write(':f 001 Dracula :hi\r\n'),30);
   if(/^PING/.test(l))s.write('PONG :x\r\n');
   if(/^JOIN (\S+)/.test(l))setTimeout(()=>s.write(`:Dracula!b@h JOIN :${l.match(/^JOIN (\S+)/)[1]}\r\n`),20);
   if(/^NAMES (\S+)/.test(l)){const ch=l.match(/^NAMES (\S+)/)[1];
     s.write(`:f 353 Dracula = ${ch} :@Dracula Renfield\r\n:f 366 Dracula ${ch} :End\r\n`);}
  }});
});
srv.listen(PORT,'127.0.0.1',async()=>{
 const bot=spawn('node',['-r',`${__dirname}/groqstub.js`,
   '../action-bot.js'],{
   env:{...process.env,IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',
     IRC_NICK:'Dracula',IRC_CHANNEL:'#batcave',GROQ_API_KEY:'k',SENTIENT_ON:'off',
     RAID_GUARD:'off',STRICT_NICKS:'on',PEER_SECRET:SECRET,PEER_BOTS:'Renfield'},
   stdio:['ignore','pipe','pipe']});
 bot.stderr.on('data',d=>process.stderr.write(d));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const sent=re=>out.some(l=>re.test(l));
 const R=[];const check=(n,ok,d='')=>R.push([n,ok,d]);
 await wait(6000);

 // THE REAL CASE: the standby was already in the room before we started, so
 // it never fires a JOIN we can see. This is the normal situation, because the
 // bot restarts every six hours while the standbys stay put.
 check('a standby already present at startup is challenged',
       !!challenge && challenge.to==='Renfield', JSON.stringify(challenge));
 check('and is ACCEPTed through +g first, so its answer can get back',
       out.some(l=>/^ACCEPT \+Renfield$/i.test(l)),
       out.filter(l=>/ACCEPT/i.test(l)).join(' | ')||'(no ACCEPT sent — its reply would be refused)');

 out.length=0;
 sock.write(`:Renfield!r@runner NOTICE Dracula :AUTH ${Handshake.answer(SECRET, challenge.nonce)}\r\n`);
 await wait(1500);
 check('the right answer earns ops', sent(/^MODE #batcave \+o Renfield$/),
       out.filter(l=>/MODE|PRIVMSG/.test(l)).join(' | ')||'(nothing)');

 // An impostor takes the same nick.
 out.length=0; challenge=null;
 sock.write(':Renfield!evil@elsewhere JOIN #batcave\r\n');
 await wait(1800);
 const ch2 = challenge;
 out.length=0;
 sock.write(`:Renfield!evil@elsewhere NOTICE Dracula :AUTH ${Handshake.answer('wrong-secret', ch2.nonce)}\r\n`);
 await wait(1500);
 check('a wrong secret earns NO ops', !sent(/^MODE #batcave \+o Renfield$/),
       out.filter(l=>/MODE/.test(l)).join(' | ')||'(no modes — correct)');
 check('and the room is told', sent(/could not prove it/),
       out.filter(l=>/PRIVMSG #batcave/.test(l)).join(' | ')||'(nothing)');

 // A random stranger must never even be challenged.
 out.length=0; challenge=null;
 sock.write(':someguy!s@h JOIN #batcave\r\n');
 await wait(1500);
 check('a non-peer nick is never challenged', challenge === null, JSON.stringify(challenge));

 console.log('\n=== peer authentication ===');
 let ok=true;for(const[n,p,d]of R){ok=ok&&p;console.log(`  [${p?'PASS':'FAIL'}] ${n}${!p&&d?' — '+d:''}`);}
 console.log(ok?'\nALL PASS':'\nFAILURES');bot.kill('SIGKILL');process.exit(ok?0:1);
});
setTimeout(()=>{console.log('timeout');process.exit(1)},70000);
