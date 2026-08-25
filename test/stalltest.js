// A server that accepts TCP and then says NOTHING — the zombie's exact shape.
const net=require('net'); const {spawn}=require('child_process');
const PORT=6710; let sawStuck=false, exited=null;
const srv=net.createServer(()=>{ /* accept, then total silence */ });
srv.listen(PORT,'127.0.0.1',()=>{
  const bot=spawn('node',['../action-bot.js'],{
    env:{...process.env,IRC_SERVER:'127.0.0.1',IRC_PORT:String(PORT),IRC_TLS:'off',
      IRC_NICK:'Dracula',IRC_CHANNEL:'#batcave',GROQ_API_KEY:'k',SENTIENT_ON:'off'},
    stdio:['ignore','pipe','pipe']});
  let out='';
  const note=d=>{ out+=d; if(/Stuck connecting/.test(out)) sawStuck=true; };
  bot.stdout.on('data',note); bot.stderr.on('data',note);
  bot.on('exit',(c)=>{ exited=c; });
  // The stall watchdog fires at 90s; give it a margin.
  setTimeout(()=>{
    console.log(`  [${sawStuck?'PASS':'FAIL'}] notices it is stuck connecting`);
    console.log(`  [${sawStuck?'PASS':'FAIL'}] and does not sit there silently forever`);
    if(!sawStuck) console.log('  --- what it did say ---\n' + out.slice(-600));
    try{bot.kill('SIGKILL');}catch(e){}
    process.exit(sawStuck?0:1);
  }, 145000);
});
