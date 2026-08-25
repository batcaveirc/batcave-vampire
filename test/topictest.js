const { FindIt } = require('../findit.js');
const sent=[]; const bot={send:(l)=>sent.push(l), say(){}, notice(){}, nick:'Dracula'};
const g = new FindIt(bot);
let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

g.rememberTopic('Welcome to the BatCave. Type !!help. Be civil.');
c('the room topic is remembered', g.savedTopic === 'Welcome to the BatCave. Type !!help. Be civil.');
g.rememberTopic('Findit 3 · Tasks 1/5 · 4 alive');
c('our own scoreboard never overwrites it',
  g.savedTopic === 'Welcome to the BatCave. Type !!help. Be civil.', g.savedTopic);

g.room = '#batcave'; g.players = new Map();
sent.length = 0;
g.cleanup();
const topicLines = sent.filter(l=>/^TOPIC/.test(l));
c('cleanup RESTORES the topic rather than clearing it',
  topicLines.some(l=>/Welcome to the BatCave/.test(l)), JSON.stringify(topicLines));
c('and never sends an empty topic', !topicLines.some(l=>/^TOPIC \S+ :$/.test(l)), JSON.stringify(topicLines));

// A room that genuinely had no topic must not get a fake one.
const g2 = new FindIt(bot); g2.room='#x'; g2.players=new Map();
sent.length=0; g2.cleanup();
c('a room with no topic is left with none',
  sent.filter(l=>/^TOPIC/.test(l)).every(l=>/:$/.test(l)));
console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
