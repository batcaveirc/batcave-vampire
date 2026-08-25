// Built around the line that actually assembled the raid.
const { Watch } = require('../watch.js');
const homes = ['#batcave', '#🅱🅰🆃🅲🅰🆅🅴'];
const W = () => new Watch({ homes });
let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

const REAL = "Aao mera cuckpati Karan dekhna chahta hai #batcave #batcave #batcave 💦💦";

console.log('— the real attack line —');
let w = W();
let r = w.hear('#chatsansar','NessieNangiBhabhi', REAL, {abusive:true, badNick:true});
c('raises an alert', r.level === 'alert', JSON.stringify(r));
c('counts the repetition', r.count === 3, JSON.stringify(r));
c('and remembers where', w.seenIn('NessieNangiBhabhi').includes('#chatsansar'));
c('so the arrival is flagged', w.isFlagged('nessienangibhabhi'));

console.log('\n— what must NOT trigger it —');
w = W();
c('our own recruiting post', w.hear('#desiadda','Dracula','The BatCave stirs at #batcave — all welcome',{trusted:true}).level === 'none');
c('a regular recommending us', w.hear('#desiadda','LiBu','come to #batcave its fun',{trusted:true}).level === 'none');
c('a stranger simply naming it stays silent',
  w.hear('#desiadda','someone','is #batcave still active?',{}).level === 'watch');
c('a room we do not own', w.hear('#desiadda','x','join #someotherplace now now now',{}).level === 'none');
c('abuse with no mention of us', w.hear('#desiadda','x','you are all idiots',{abusive:true}).level === 'none');

console.log('\n— the two things that DO trigger it —');
w = W();
c('spammed repeatedly, no abuse',
  w.hear('#desiadda','x','#batcave #batcave #batcave',{}).level === 'alert');
w = W();
c('mentioned once, but abusive',
  w.hear('#desiadda','x','come #batcave you randi',{abusive:true}).level === 'alert');

console.log('\n— memory —');
w = W();
w.hear('#desiadda','x','#batcave #batcave #batcave',{});
w.hear('#chatsansar','x','#batcave #batcave #batcave',{});
c('collects every room they worked', w.seenIn('x').length === 2, JSON.stringify(w.seenIn('x')));
w.forget('x');
c('forget clears them', !w.isFlagged('x'));
const off = new Watch({homes, enabled:false});
c('WATCH=off disables it', off.hear('#desiadda','x',REAL,{abusive:true}).level === 'none');

console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
