// Dracula must never AI-reply to another bot, however often they name him.
const net=require('net'); const {spawn}=require('child_process');
const PORT=6722; const out=[]; let sock=null;
const srv=net.createServer((s)=>{sock=s;let buf='';
 s.on('data',(d)=>{buf+=d.toString();const L=buf.split('\r\n');buf=L.pop();
  for(const l of L){if(!l.trim())continue;out.push(l);
   if(/^NICK/.test(l))setTimeout(()=>s.write(':f 001 Dracula :hi\r\n'),30);
   if(/^PING/.test(l))s.write('PONG :x\r\n');
   if(/^JOIN (\S+)/.test(l))setTimeout(()=>s.write(`:Dracula!b@h JOIN :${l.match(/^JOIN (\S+)/)[1]}\r\n`),20);
   if(/^NAMES (\S+)/.test(l)){const c=l.match(/^NAMES (\S+)/)[1];
     s.write(`:f 353 Dracula = ${c} :@Dracula Carmilla Luna1 bob\r\n:f 366 Dracula ${c} :End\r\n`);}
  }});
});
srv.listen(PORT,'127.0.0.1',async()=>{
 const bot=spawn('node',['-r',`${__dirname}/groqstub.js`,
   '../action-bot.js'],{
   env:{...process.env,IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',
     IRC_NICK:'Dracula',IRC_CHANNEL:'#batcave',GROQ_API_KEY:'k',SENTIENT_ON:'off',
     PEER_SECRET:'s',PEER_BOTS:'Carmilla,Drusilla',BOT_NICKS:'Almond',RAID_GUARD:'off'},
   stdio:['ignore','pipe','pipe']});
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const R=[];const check=(n,ok,d='')=>R.push([n,ok,d]);
 await wait(6000);

 out.length=0;
 sock.write(':Carmilla!c@h PRIVMSG #batcave :[STANDBY] dracula: here, luna1: here\r\n');
 await wait(2500);
 check('ignores a standby naming him',
       !out.some(l=>/^PRIVMSG #batcave :Carmilla:/.test(l)),
       out.filter(l=>/PRIVMSG #batcave/.test(l)).join(' | ')||'(silent)');

 out.length=0;
 sock.write(':Luna1!l@h PRIVMSG #batcave :Dracula are you there\r\n');
 await wait(2500);
 check('ignores the other bot too',
       !out.some(l=>/^PRIVMSG #batcave :Luna1:/.test(l)),
       out.filter(l=>/PRIVMSG #batcave/.test(l)).join(' | ')||'(silent)');

 out.length=0;
 sock.write(':bob!b@h PRIVMSG #batcave :Dracula are you there\r\n');
 await wait(2500);
 check('but still answers a PERSON',
       out.some(l=>/^PRIVMSG #batcave :bob:/.test(l)),
       out.filter(l=>/PRIVMSG #batcave/.test(l)).join(' | ')||'(nothing — should have replied)');

 console.log('\n=== no bot-to-bot chatter ===');
 let ok=true;for(const[n,p,d]of R){ok=ok&&p;console.log(`  [${p?'PASS':'FAIL'}] ${n}${!p&&d?' — '+d:''}`);}
 console.log(ok?'\nALL PASS':'\nFAILURES');bot.kill('SIGKILL');process.exit(ok?0:1);
});
setTimeout(()=>{console.log('timeout');process.exit(1)},70000);
