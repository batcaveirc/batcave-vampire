// The voice ladder: nobody is kicked for a first offence in a moderated room.
const net=require('net'); const {spawn}=require('child_process');
const PORT=6699; const out=[]; let sock=null;
const srv=net.createServer((s)=>{sock=s;let buf='';
 s.on('data',(d)=>{buf+=d.toString();const L=buf.split('\r\n');buf=L.pop();
  for(const l of L){if(!l.trim())continue;out.push(l);
   if(/^CAP REQ/.test(l))s.write(':f CAP * ACK :extended-join account-notify multi-prefix server-time\r\n');
   if(/^NICK/.test(l))setTimeout(()=>s.write(':f 001 Dracula :hi\r\n'),30);
   if(/^PING/.test(l))s.write('PONG :x\r\n');
   if(/^JOIN (\S+)/.test(l))setTimeout(()=>s.write(`:Dracula!b@h JOIN :${l.match(/^JOIN (\S+)/)[1]}\r\n`),20);
   if(/^NAMES (\S+)/.test(l)){const c=l.match(/^NAMES (\S+)/)[1];
     s.write(`:f 353 Dracula = ${c} :@Dracula vikram joker\r\n:f 366 Dracula ${c} :End\r\n`);}
   if(/^WHO (\S+)/.test(l))s.write(`:f 315 Dracula ${l.match(/^WHO (\S+)/)[1]} :End\r\n`);
   if(/^PRIVMSG ChanServ :INFO (\S+)/.test(l)){const c=l.match(/INFO (\S+)/)[1];
     s.write(`:ChanServ!s@services NOTICE Dracula :Information on ${c}: Founder Vlkram\r\n`);}
  }});
});
srv.listen(PORT,'127.0.0.1',async()=>{
 const bot=spawn('node',['-r',`${__dirname}/groqstub.js`,
   '../action-bot.js'],{
   env:{...process.env,IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',
     IRC_NICK:'Dracula',IRC_CHANNEL:'#batcave',OWNERS:'boss',WHITELIST:'vikram',
     MODERATED_ROOMS:'#batcave',DEVOICE_MINUTES:'1',WARN_LIMIT:'3',
     WARN_LIMIT_REGISTERED:'2',KICK_UNREGISTERED:'off',
     GROQ_API_KEY:'k',SENTIENT_ON:'off',RAID_GUARD:'off',STRICT_NICKS:'off',AUTO_VOICE:'on'},
   stdio:['ignore','pipe','pipe']});
 bot.stdout.on('data',d=>process.stdout.write('BOT> '+d));bot.stderr.on('data',d=>process.stderr.write(d));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const sent=re=>out.some(l=>re.test(l));
 const R=[];const check=(n,ok,d='')=>R.push([n,ok,d]);
 await wait(6000);

 // The bot must NEVER take a room's voice away by itself. Doing that from
 // config silenced every unregistered newcomer in both live rooms.
 check('never sets +m on its own',
       !out.some(l=>/^MODE #batcave \+m$/.test(l)),
       'a room going silent must be a human decision: ' + out.filter(l=>/^MODE #batcave/.test(l)).join(' | '));
 check('voices everyone present in a moderated room',
       sent(/^MODE #batcave \+v joker$/), out.filter(l=>/\+v/.test(l)).join(' | '));

 // a newcomer must be able to speak straight away, or +m locks them out
 out.length=0;
 sock.write(':newbie!n@1.1.1.1 JOIN #batcave * :real\r\n');
 await wait(1200);
 check('voices a newcomer on arrival', sent(/^MODE #batcave \+v newbie$/),
       'without this, +m means a newcomer joins into silence');

 // first offence: devoiced, NOT kicked
 out.length=0;
 sock.write(':joker!j@2.2.2.2 PRIVMSG #batcave :you are an idiot\r\n');
 await wait(1500);
 check('first offence takes the VOICE, not the room',
       sent(/^MODE #batcave -v joker$/) && !sent(/^KICK #batcave joker/),
       out.filter(l=>/MODE|KICK/.test(l)).join(' | '));
 check('and says when it comes back', sent(/Voice back in 1m/),
       out.filter(l=>/PRIVMSG #batcave/.test(l)).join(' | '));

 // A STRANGER's quota is one devoice. The second offence is the kick: an
 // unregistered guest gets the floor taken once, which is what moderating the
 // room buys them, and no more runway than that.
 out.length=0;
 sock.write(':joker!j@2.2.2.2 PRIVMSG #batcave :you are an idiot\r\n');
 await wait(1500);
 check('a stranger is kicked on the SECOND offence, not the first',
       sent(/^KICK #batcave joker/),
       out.filter(l=>/MODE|KICK/.test(l)).join(' | '));

 // A WHITELISTED regular is now TOLD and nothing else: never de-voiced,
 // never quieted, never kicked, however many times they trip the filter.
 out.length=0;
 for(let i=0;i<4;i++){
   sock.write(':vikram!v@3.3.3.3 PRIVMSG #batcave :you are an idiot\r\n');
   await wait(1200);
 }
 check('a whitelisted regular is untouched by the filter',
       !sent(/^KICK #batcave vikram/) && !sent(/^MODE #batcave -v vikram$/) && !sent(/^MODE #batcave \+q/),
       out.filter(l=>/MODE #batcave (-v|\+q)|KICK/.test(l)).join(' | ') || '(nothing)');
 check('and the bot says nothing about them at all',
       !sent(/PRIVMSG #batcave :.*vikram/i),
       out.filter(l=>/PRIVMSG #batcave/.test(l)).slice(-2).join(' | '));

 // A strike must be forgivable. Without this the ladder could park somebody one
 // word from a kick with no way back short of restarting the bot.
 out.length=0;
 sock.write(':joker2!j@4.4.4.4 PRIVMSG #batcave :you are an idiot\r\n');
 await wait(1400);
 out.length=0;
 sock.write(':boss!b@5.5.5.5 PRIVMSG #batcave :!!unwarn joker2\r\n');
 await wait(1400);
 check('a mod can clear a strike and hand the voice back',
       sent(/slate wiped clean/) && sent(/^MODE #batcave \+v joker2$/),
       out.filter(l=>/MODE|PRIVMSG #batcave/.test(l)).join(' | '));

 console.log('\n=== voice ladder ===');
 let ok=true;for(const[n,p,d]of R){ok=ok&&p;console.log(`  [${p?'PASS':'FAIL'}] ${n}${!p&&d?' — '+d:''}`);}
 console.log(ok?'\nALL PASS':'\nFAILURES');bot.kill('SIGKILL');process.exit(ok?0:1);
});
setTimeout(()=>{console.log('timeout');process.exit(1)},60000);
