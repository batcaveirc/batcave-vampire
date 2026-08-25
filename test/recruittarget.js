// The real numbers from the live probe: 189 present, 173 rejected as "not my
// half". A recruiter that reports "nobody eligible" in a room of 200 is broken.
const path = '../recruit.js';
const room = ['priya','neha','rahul','amit','vikas','sanjay','pooja','deepak',
              'suresh','anita','manoj','rajesh','kavita','arjun','ramesh'];
let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

function make(target) {
  delete require.cache[require.resolve(path)];
  process.env.RECRUIT_TARGET = target;
  const { Recruiter } = require(path);
  const r = new Recruiter({ send(){}, say(){}, nick:'D' },
    { membersOf:(ch)=>ch==='#home'?[]:room, prefixOf:()=>'', homeChannel:'#home' });
  r.channels = ['#src']; r.enabled = true;
  return r;
}
const fem = make('feminine').eligible('#src');
const oth = make('other').eligible('#src');
const all = make('all').eligible('#src');
console.log(`  room of ${room.length}: feminine=${fem.length} other=${oth.length} all=${all.length}`);
c('the two halves are disjoint', !fem.some(n=>oth.includes(n)));
c('together they cover EVERYONE', fem.length + oth.length === room.length,
  `${fem.length}+${oth.length} != ${room.length}`);
c('"all" reaches the whole room', all.length === room.length, `${all.length}`);
c('"feminine" alone leaves most of the room out', fem.length < room.length/2);

console.log('\n— nobody is asked twice, but not forever —');
const r = make('all');
const first = r.inviteOne();
c('someone gets invited', !!first, String(first));
c('and is not re-invited immediately', !r.eligible('#src').includes(first.target));
r.invited.set(first.target.toLowerCase(), Date.now() - 22*86400000);  // 22 days ago
c('but becomes eligible again after the re-ask window',
  r.eligible('#src').includes(first.target), 'still excluded after 22 days');

console.log('\n— explain() names the split —');
c('says which half it covers', make('feminine').explain().some(l=>/feminine.*half/.test(l)),
  JSON.stringify(make('feminine').explain()));

console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
