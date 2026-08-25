// Real nicks from #desiadda and #chatsansar, through the recruiter's filters.
const path='../recruit.js';
process.env.RECRUIT_TARGET='feminine';
delete require.cache[require.resolve(path)];
const { Recruiter } = require(path);
const room = ['MyMilfMomJaya','Reetu-F29-Married-Paid-Cam','HornyLund90','sluttyFATwhorex',
              'CuckSon4MOM','INCEST_LOVE','sandhyaslut','AnotherBitch21f',
              'IndiangirlUSA','Jayashree_','Aditi30','Tanu26f','anisha','Priyaa',
              'Aakash_USA','Aditya-USA','RAJCANADA','GymHunkNRI','Chetan_Pune'];
const r = new Recruiter({send(){},say(){},nick:'D'},
  {membersOf:(c)=>c==='#home'?[]:room, prefixOf:()=>'', homeChannel:'#home'});
r.channels=['#src']; r.enabled=true;
const elig = r.eligible('#src');

let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
console.log('  eligible:', elig.join(', ') || '(none)');
console.log();
for (const bad of ['MyMilfMomJaya','Reetu-F29-Married-Paid-Cam','HornyLund90','sluttyFATwhorex','CuckSon4MOM','INCEST_LOVE','sandhyaslut'])
  c(`never invites ${bad}`, !elig.includes(bad));
for (const good of ['IndiangirlUSA','Aditi30','Tanu26f','anisha'])
  c(`does invite ${good}`, elig.includes(good), 'missed a genuine candidate');
for (const male of ['Aakash_USA','Aditya-USA','RAJCANADA','GymHunkNRI'])
  c(`does not mistake ${male} for feminine`, !elig.includes(male));
console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
