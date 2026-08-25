// The actual message from the live incident, run through the scripted filter's
// counting rule. Names are stripped; this is about whether it trips at all.
const fs = require('fs');
const src = fs.readFileSync('../action-bot.js','utf8');
const hing = fs.readFileSync('hinglish.txt','utf8').trim().split(',');
const eng  = src.match(/const DEFAULT_BADWORDS = \[([\s\S]*?)\];/)[1];
const engWords = [...eng.matchAll(/'([^']+)'/g)].map(x=>x[1]);

// Same normalisation + whole-word matching the bot uses.
const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g,' ');
const distinct = (set, msg) => {
  const words = new Set(norm(msg).split(/\s+/).filter(Boolean));
  return [...set].filter(w => words.has(w));
};

const ZENKO = "You sasti Randi k bchay haramzaday gandu sissy gay cuckold mental patients ma chudwao apni ___ ___ Teri ma ka Kya rate hai AJ 3 rupees? ___ dallay k bchay";
const before = distinct(new Set(engWords), ZENKO);
const after  = distinct(new Set([...engWords, ...hing]), ZENKO);

let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
console.log(`  english-only list matched: ${before.length} -> ${before.length>=3?'ban':before.length?'warning':'NOTHING (fell through to the slow AI)'}`);
console.log(`  with hinglish added:       ${after.length} -> ${after.length>=3?'BAN, instantly':after.length?'warning':'nothing'}  [${after.join(', ')}]`);
c('the old list under-reacted: a warning, not a ban', before.length > 0 && before.length < 3);
c('the new list trips the 3-word tirade rule -> instant ban', after.length >= 3);

console.log('\n— the harassment nick must be caught too —');
const badNick = (nick, set) => {
  const n = nick.toLowerCase().replace(/[^a-z0-9]/g,'');
  return [...set].some(w => w.length >= 4 && n.includes(w));
};
c('"NessieNangiBhabhi" is screened out', badNick('NessieNangiBhabhi', new Set([...engWords, ...hing])));
c('an ordinary nick is not', !badNick('hunterrrrrr', new Set([...engWords, ...hing])));
c('nor is a regular', !badNick('Aaloo_Khaoge', new Set([...engWords, ...hing])));

console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
