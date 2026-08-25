// Spoken orders, driven through the real bot over a socket.
const net=require('net'); const {spawn}=require('child_process');
const PORT=6702; const out=[]; let sock=null;
const srv=net.createServer((s)=>{sock=s;let buf='';
 s.on('data',(d)=>{buf+=d.toString();const L=buf.split('\r\n');buf=L.pop();
  for(const l of L){if(!l.trim())continue;out.push(l);
   if(/^CAP REQ/.test(l))s.write(':f CAP * ACK :extended-join account-notify multi-prefix server-time\r\n');
   if(/^NICK/.test(l))setTimeout(()=>s.write(':f 001 Dracula :hi\r\n'),30);
   if(/^PING/.test(l))s.write('PONG :x\r\n');
   if(/^JOIN (\S+)/.test(l))setTimeout(()=>s.write(`:Dracula!b@h JOIN :${l.match(/^JOIN (\S+)/)[1]}\r\n`),20);
   if(/^NAMES (\S+)/.test(l)){const c=l.match(/^NAMES (\S+)/)[1];
     s.write(`:f 353 Dracula = ${c} :@Dracula boss vikram troll42\r\n:f 366 Dracula ${c} :End\r\n`);}
   if(/^WHO (\S+)/.test(l))s.write(`:f 315 Dracula ${l.match(/^WHO (\S+)/)[1]} :End\r\n`);
  }});
});
srv.listen(PORT,'127.0.0.1',async()=>{
 const bot=spawn('node',['-r',`${__dirname}/groqstub.js`,
   '../action-bot.js'],{
   env:{...process.env,IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',
     IRC_NICK:'Dracula',IRC_CHANNEL:'#batcave',OWNERS:'boss',WHITELIST:'vikram',
     MODERATED_ROOMS:'#batcave',DEVOICE_MINUTES:'1',WARN_LIMIT:'3',
     GROQ_API_KEY:'k',SENTIENT_ON:'off',RAID_GUARD:'off',STRICT_NICKS:'off',AUTO_VOICE:'on'},
   stdio:['ignore','pipe','pipe']});
 bot.stderr.on('data',d=>process.stderr.write(d));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const sent=re=>out.some(l=>re.test(l));
 const R=[];const check=(n,ok,d='')=>R.push([n,ok,d]);
 await wait(6000);

 const order=async(who,text)=>{out.length=0;
   sock.write(`:${who}!u@h PRIVMSG #batcave :${text}\r\n`);await wait(1500);};

 await order('boss','Dracula kick troll42');
 check('a mod can order a kick in plain English', sent(/^KICK #batcave troll42/),
       out.filter(l=>/KICK|MODE/.test(l)).join(' | ')||'(nothing)');

 await order('vikram','Dracula devoice troll42');
 check('a whitelisted regular can too', sent(/^MODE #batcave -v troll42$/),
       out.filter(l=>/KICK|MODE/.test(l)).join(' | ')||'(nothing)');

 await order('troll42','Dracula kick vikram');
 check('a STRANGER giving orders is ignored', !sent(/KICK #batcave vikram/),
       out.filter(l=>/KICK|MODE/.test(l)).join(' | ')||'(nothing)');

 await order('boss','Dracula kick vikram');
 check('orders cannot be turned on a whitelisted regular',
       !sent(/^KICK #batcave vikram/) && sent(/one of ours/),
       out.filter(l=>/KICK|PRIVMSG #batcave/.test(l)).join(' | ')||'(nothing)');

 await order('boss','Dracula kick Luna1');
 check('and never on the other bot', !sent(/KICK #batcave Luna1/),
       out.filter(l=>/KICK/.test(l)).join(' | ')||'(nothing)');

 await order('boss',"Dracula don't kick troll42");
 check('a negated order does nothing', !sent(/KICK #batcave troll42/),
       out.filter(l=>/KICK|MODE/.test(l)).join(' | ')||'(nothing)');

 await order('boss','Dracula should we kick troll42?');
 check('a question does nothing', !sent(/KICK #batcave troll42/),
       out.filter(l=>/KICK|MODE/.test(l)).join(' | ')||'(nothing)');

 console.log('\n=== spoken orders ===');
 let ok=true;for(const[n,p,d]of R){ok=ok&&p;console.log(`  [${p?'PASS':'FAIL'}] ${n}${!p&&d?' — '+d:''}`);}
 console.log(ok?'\nALL PASS':'\nFAILURES');bot.kill('SIGKILL');process.exit(ok?0:1);
});
setTimeout(()=>{console.log('timeout');process.exit(1)},70000);
