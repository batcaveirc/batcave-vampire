const tls=require('tls');
const nick='probe'+Math.floor(Math.random()*9000+1000);
const s=tls.connect({host:'irc.hybridirc.com',port:6697,servername:'irc.hybridirc.com'},()=>
  s.write(`NICK ${nick}\r\nUSER ${nick} 0 * :probe\r\n`));
let buf='';
s.on('data',d=>{buf+=d.toString();const L=buf.split('\r\n');buf=L.pop();
 for(const l of L){
  if(l.startsWith('PING')){s.write('PONG'+l.slice(4)+'\r\n');continue;}
  if(/ 001 /.test(l)){
    s.write('PRIVMSG ChanServ :HELP SET GUARD\r\n');
    s.write('JOIN #batcave\r\n');
    setTimeout(()=>{s.write('QUIT\r\n');process.exit(0)},7000);
  }
  const m=l.match(/^:ChanServ\S*\s+NOTICE\s+\S+\s+:(.*)$/i);
  if(m){const t=m[1].replace(/[\x02\x0F\x1F]|\x03\d{0,2}/g,'');
    if(/guard|channel|join|autovoice|voice/i.test(t)) console.log('  ',t.slice(0,105));}
  const n=l.match(/ 353 \S+ . (\S+) :(.*)$/);
  if(n) console.log('  IN CHANNEL:', n[2].slice(0,120));
 }});
setTimeout(()=>process.exit(0),15000);
