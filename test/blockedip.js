// A server that accepts the socket then hangs up — a blocked address.
// The bot must retry, count, and EXIT so a fresh runner takes over.
const net=require('net'); const {spawn}=require('child_process');
let PORT = 0;   /* the OS assigns one on listen — see below */ let out=''; let exited=null; let accepts=0;
const srv=net.createServer((s)=>{ accepts++; s.destroy(); });
srv.listen(0,'127.0.0.1', () => {
  PORT = srv.address().port;
  const bot=spawn('node',['../action-bot.js'],{
    env:{...process.env,IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',
      IRC_NICK:'Dracula',IRC_CHANNEL:'#batcave',GROQ_API_KEY:'k',SENTIENT_ON:'off'},
    stdio:['ignore','pipe','pipe']});
  const note=d=>{out+=d;};
  bot.stdout.on('data',note); bot.stderr.on('data',note);
  bot.on('exit',(c)=>{exited=c;});
  setTimeout(()=>{
    const tries=(out.match(/Rejected before registering \((\d)\/5\)/g)||[]);
    const gaveUp=/looks blocked. Exiting/.test(out);
    console.log(`  connection attempts the server saw : ${accepts}`);
    console.log(`  retry lines logged                 : ${tries.length} ${JSON.stringify(tries)}`);
    const ok1 = tries.length >= 4;
    const ok2 = gaveUp && exited === 1;
    console.log(`  [${ok1?'PASS':'FAIL'}] the counter actually advances past 1`);
    console.log(`  [${ok2?'PASS':'FAIL'}] and it exits(1) so a fresh runner takes over (exit=${exited})`);
    if(!ok1||!ok2) console.log('  --- log ---\n'+out.slice(-600));
    try{bot.kill('SIGKILL');}catch(e){}
    srv.close(); process.exit(ok1&&ok2?0:1);
  }, 115000);
});
