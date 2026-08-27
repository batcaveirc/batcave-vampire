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



console.log('\n— real nicks counted in #allindiachat.com, 2026-08-26 —');
// The owner counted the room by hand: 85 of 100 people were being written off
// as "not my half", including these three. A recruiter ignoring five sixths of
// a room is not being selective, it is broken.
for (const n of ['_______F_Delhi', '_Esha18', '_Shruti_', 'f25delhi', '24f_pune', 'Riya|F|22'])
  c(`${n} is recognised`, r.looksFeminine(n), 'still being skipped');

console.log('\n— and it has not become a yes-machine —');
for (const n of ['Aakash', 'RajCanada', 'soul', 'hunterrrrrr', 'JAILER', 'wolf25', 'Ashish'])
  c(`${n} is NOT counted`, !r.looksFeminine(n), 'false positive');


console.log('\n— solicitation nicks, taken from #allindiachat.com on 2026-08-27 —');
// Not invented. These are 95 real nicknames the recorder captured in the room
// the recruiter invites FROM. The list as it stood refused 7 of them; the
// other fourteen would have been sent an invitation into #batcave that day.
for (const n of ['M-Amdavada-Rp-','Fit-23-M-CAm','Muslimbull','BritFaceForIndianMansFeet',
  'HYD_bull','my_useless_cock','Daddy_Will_Use_U_Deep_Secretly','jeerrk_on_wife_pic',
  'WildBullRonny','BongHw','HINDU_BULL','BLR-30M-RealMeetBull','MatureDom4KinkyF',
  'BULL4HostingReal','HORNY_GAY_TEEN','gshower26'])
  c(`${n} is refused`, !!r.unwelcome(n), 'would be invited');

console.log('\n— and the words they hide inside ordinary names —');
// Every one of these contains a flagged word as a SUBSTRING. Matching on
// substrings would refuse all of them; matching on tokens and suffixes does not.
for (const n of ['ghost_rider','Freedom_Fighter','Camila','Sharp_Shooter','Domino',
  'Subhash','Bulletin_Board','Shower_Thoughts','Wisdom_Seeker','Priya_Chat_Fun'])
  c(`${n} is still welcome`, !r.unwelcome(n), `refused as ${r.unwelcome(n)}`);

console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);