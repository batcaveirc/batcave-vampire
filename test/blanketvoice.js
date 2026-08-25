// With ChanServ autovoicing everyone, +v must NOT confer trust — otherwise the
// whole room is "trusted" and nobody can ever be punished.
const net=require('net'); const {spawn}=require('child_process');
let PORT = 0;   /* the OS assigns one on listen — see below */ const out=[]; let sock=null;
// Everyone arrives already voiced, exactly as `*!*@* +V` produces.
const NAMES = '@Dracula +joker +alice +bob +carol +dave';
const srv=net.createServer((s)=>{sock=s;let buf='';
 s.on('data',(d)=>{buf+=d.toString();const L=buf.split('\r\n');buf=L.pop();
  for(const l of L){if(!l.trim())continue;out.push(l);
   if(/^CAP REQ/.test(l))s.write(':f CAP * ACK :extended-join account-notify multi-prefix server-time\r\n');
   if(/^NICK/.test(l))setTimeout(()=>s.write(':f 001 Dracula :hi\r\n'),30);
   if(/^PING/.test(l))s.write('PONG :x\r\n');
   if(/^JOIN (\S+)/.test(l))setTimeout(()=>s.write(`:Dracula!b@h JOIN :${l.match(/^JOIN (\S+)/)[1]}\r\n`),20);
   if(/^NAMES (\S+)/.test(l)){const c=l.match(/^NAMES (\S+)/)[1];
     s.write(`:f 353 Dracula = ${c} :${NAMES}\r\n:f 366 Dracula ${c} :End\r\n`);}
   if(/^WHO (\S+)/.test(l))s.write(`:f 315 Dracula ${l.match(/^WHO (\S+)/)[1]} :End\r\n`);
  }});
});
srv.listen(0,'127.0.0.1', async() => {
  PORT = srv.address().port;
 const bot=spawn('node',['-r',`${__dirname}/groqstub.js`,
   '../action-bot.js'],{
   env:{...process.env,IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',
     IRC_NICK:'Dracula',IRC_CHANNEL:'#batcave',OWNERS:'',WHITELIST:'alice',
     MODERATED_ROOMS:'#batcave',DEVOICE_MINUTES:'2',WARN_LIMIT:'3',
     GROQ_API_KEY:'k',SENTIENT_ON:'off',RAID_GUARD:'off',STRICT_NICKS:'off',AUTO_VOICE:'on'},
   stdio:['ignore','pipe','pipe']});
 bot.stderr.on('data',d=>process.stderr.write(d));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const R=[];const check=(n,ok,d='')=>R.push([n,ok,d]);
 await wait(6000);

 // joker is voiced by ChanServ like everyone else, and is NOT whitelisted.
 out.length=0;
 sock.write(':joker!j@2.2.2.2 PRIVMSG #batcave :you are an idiot\r\n');
 await wait(1600);
 check('a blanket-voiced stranger is still punished',
       out.some(l=>/^MODE #batcave -v joker$/.test(l)) || out.some(l=>/^KICK #batcave joker/.test(l)),
       out.filter(l=>/MODE|KICK|PRIVMSG #batcave/.test(l)).join(' | ')||'(nothing happened)');
 check('and is NOT let off with a bare warning',
       !out.some(l=>/no action taken/.test(l)),
       out.filter(l=>/PRIVMSG #batcave/.test(l)).join(' | '));

 // alice IS on the WHITELIST secret -> still gets the privilege.
 out.length=0;
 sock.write(':alice!a@3.3.3.3 PRIVMSG #batcave :you are an idiot\r\n');
 await wait(1600);
 check('a genuinely whitelisted regular is untouched entirely',
       !out.some(l=>/^MODE #batcave -v alice$/.test(l)) && !out.some(l=>/KICK #batcave alice/.test(l))
       && !out.some(l=>/PRIVMSG #batcave :.*alice/i.test(l)),
       out.filter(l=>/MODE|KICK|PRIVMSG #batcave/.test(l)).join(' | ')||'(nothing — correct)');

 // Orders must not be available to a blanket-voiced nobody.
 out.length=0;
 sock.write(':joker!j@2.2.2.2 PRIVMSG #batcave :Dracula kick bob\r\n');
 await wait(1600);
 check('a blanket-voiced stranger cannot give orders',
       !out.some(l=>/^KICK #batcave bob/.test(l)),
       out.filter(l=>/KICK/.test(l)).join(' | ')||'(nothing)');

 console.log('\n=== blanket autovoice must not confer trust ===');
 let ok=true;for(const[n,p,d]of R){ok=ok&&p;console.log(`  [${p?'PASS':'FAIL'}] ${n}${!p&&d?' — '+d:''}`);}
 console.log(ok?'\nALL PASS':'\nFAILURES');bot.kill('SIGKILL');process.exit(ok?0:1);
});
setTimeout(()=>{console.log('timeout');process.exit(1)},70000);
