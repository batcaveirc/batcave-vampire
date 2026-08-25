// The real zombie: register successfully, then have the server vanish and
// refuse to come back. The process must EXIT, not retry forever.
const net=require('net'); const {spawn}=require('child_process');
const PORT=6712; let exited=null, out=''; let srv;
let allowConnect = true;
srv = net.createServer((s)=>{
  if (!allowConnect) { s.destroy(); return; }        // later: refuse everything
  let buf='';
  s.on('data',(d)=>{buf+=d.toString();const L=buf.split('\r\n');buf=L.pop();
    for(const l of L){
      if(/^NICK/.test(l)) setTimeout(()=>s.write(':f 001 Dracula :hi\r\n'),30);
      if(/^PING/.test(l)) s.write('PONG :x\r\n');
      if(/^JOIN (\S+)/.test(l)) s.write(`:Dracula!b@h JOIN :${l.match(/^JOIN (\S+)/)[1]}\r\n`);
      if(/^NAMES (\S+)/.test(l)){const c=l.match(/^NAMES (\S+)/)[1];
        s.write(`:f 353 Dracula = ${c} :@Dracula\r\n:f 366 Dracula ${c} :End\r\n`);}
    }});
  // Registered — now kill it and never accept again.
  setTimeout(()=>{ allowConnect=false; try{s.destroy();}catch(e){} }, 6000);
});
srv.listen(PORT,'127.0.0.1',()=>{
  const bot=spawn('node',['../action-bot.js'],{
    env:{...process.env,IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',
      IRC_NICK:'Dracula',IRC_CHANNEL:'#batcave',GROQ_API_KEY:'k',SENTIENT_ON:'off',
      DOWN_EXIT_MIN:'1'},                    // 1 minute, so the test finishes
    stdio:['ignore','pipe','pipe']});
  const note=d=>{out+=d;};
  bot.stdout.on('data',note); bot.stderr.on('data',note);
  bot.on('exit',(c)=>{ exited=c; });
  setTimeout(()=>{
    const registered = /Identified, joined|001|Connected/.test(out);
    const gaveUp = /No working connection for/.test(out);
    const ok = exited === 1 && gaveUp;
    console.log(`  [${registered?'PASS':'FAIL'}] it registers first (so everRegistered is true)`);
    console.log(`  [${gaveUp?'PASS':'FAIL'}] it notices it cannot get back`);
    console.log(`  [${exited===1?'PASS':'FAIL'}] and EXITS(1) instead of holding the slot (exit=${exited})`);
    if(!ok) console.log('  --- log ---\n'+out.slice(-700));
    try{bot.kill('SIGKILL');}catch(e){}
    srv.close(); process.exit(ok?0:1);
  }, 110000);
});
