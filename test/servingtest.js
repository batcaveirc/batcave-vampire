// A de-voice must actually last. Two ways it used to be undone:
//   the bot's own 30s voice sweep, and ChanServ re-voicing on rejoin.
const net=require('net'); const {spawn}=require('child_process');
let PORT = 0;   /* the OS assigns one on listen — see below */ const out=[]; let sock=null;
const srv=net.createServer((s)=>{sock=s; s.on('error',()=>{});let buf='';
 s.on('data',(d)=>{buf+=d.toString();const L=buf.split('\r\n');buf=L.pop();
  for(const l of L){if(!l.trim())continue;out.push(l);
   if(/^CAP REQ/.test(l))s.write(':f CAP * ACK :extended-join account-notify multi-prefix server-time\r\n');
   if(/^NICK/.test(l))setTimeout(()=>s.write(':f 001 Dracula :hi\r\n'),30);
   if(/^PING/.test(l))s.write('PONG :x\r\n');
   if(/^JOIN (\S+)/.test(l))setTimeout(()=>s.write(`:Dracula!b@h JOIN :${l.match(/^JOIN (\S+)/)[1]}\r\n`),20);
   if(/^NAMES (\S+)/.test(l)){const c=l.match(/^NAMES (\S+)/)[1];
     s.write(`:f 353 Dracula = ${c} :@Dracula joker\r\n:f 366 Dracula ${c} :End\r\n`);}
   if(/^WHO (\S+)/.test(l))s.write(`:f 315 Dracula ${l.match(/^WHO (\S+)/)[1]} :End\r\n`);
  }});
});
srv.listen(0,'127.0.0.1', async() => {
  PORT = srv.address().port;
 const bot=spawn('node',['-r',`${__dirname}/groqstub.js`,
   '../action-bot.js'],{
   env:{...process.env,IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',
     IRC_NICK:'Dracula',IRC_CHANNEL:'#batcave',OWNERS:'',WHITELIST:'',
     MODERATED_ROOMS:'#batcave',DEVOICE_MINUTES:'2',WARN_LIMIT:'3',
     GROQ_API_KEY:'k',SENTIENT_ON:'off',RAID_GUARD:'off',STRICT_NICKS:'off',AUTO_VOICE:'on'},
   stdio:['ignore','pipe','pipe']});
 bot.stderr.on('data',d=>process.stderr.write(d));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const R=[];const check=(n,ok,d='')=>R.push([n,ok,d]);
 await wait(6000);

 // Offend once -> de-voiced for 2 minutes.
 out.length=0;
 sock.write(':joker!j@2.2.2.2 PRIVMSG #batcave :you are a fucking bastard\r\n');
 await wait(1500);
 check('the de-voice happens', out.some(l=>/^MODE #batcave -v joker$/.test(l)),
       out.filter(l=>/MODE/.test(l)).join(' | ')||'(nothing)');

 // The 30s sweep must NOT hand it back. Wait past one full sweep.
 out.length=0;
 await wait(35000);
 check('the 30s sweep does NOT return the voice early',
       !out.some(l=>/^MODE #batcave \+v joker$/.test(l)),
       out.filter(l=>/\+v joker/.test(l)).join(' | ')||'(nothing)');

 // Rejoining must not shed the sentence (ChanServ would re-voice them).
 out.length=0;
 sock.write(':joker!j@2.2.2.2 PART #batcave\r\n');
 await wait(400);
 sock.write(':joker!j@2.2.2.2 JOIN #batcave * :real\r\n');
 await wait(8000);
 const gave = out.filter(l=>/^MODE #batcave \+v joker$/.test(l)).length;
 const took = out.filter(l=>/^MODE #batcave -v joker$/.test(l)).length;
 check('rejoining does not end the sentence', took >= 1 && gave === 0,
       `+v x${gave}, -v x${took}`);

 console.log('\n=== does a punishment actually last? ===');
 let ok=true;for(const[n,p,d]of R){ok=ok&&p;console.log(`  [${p?'PASS':'FAIL'}] ${n}${!p&&d?' — '+d:''}`);}
 console.log(ok?'\nALL PASS':'\nFAILURES');bot.kill('SIGKILL');process.exit(ok?0:1);
});
setTimeout(()=>{console.log('timeout');process.exit(1)},120000);
