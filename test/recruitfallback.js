// The exact live shape: one source room unreachable, two with people in them.
process.env.RECRUIT_CHANNELS = '#allindiachat.com,#desiadda,#chatsansar';
const { Recruiter } = require('../recruit.js');

const rooms = {
  '#allindiachat.com': [],                                  // banned — bot sees nobody
  '#desiadda':   ['Priyanshi', 'rahul', 'amit'],
  '#chatsansar': ['divya_31', 'Aditi30', 'anisha', 'ops_guy'],
  '#batcave':    [],
};
const sent = [];
const r = new Recruiter({ send: (l) => sent.push(l), say(){}, nick: 'Dracula' }, {
  membersOf: (c) => rooms[c] || [],
  prefixOf: (c, n) => (n === 'ops_guy' ? '@' : ''),
  homeChannel: '#batcave',
});
r.enabled = true;

let ok = true; const c = (n, p) => { if (!p) ok = false; console.log(`  [${p?'PASS':'FAIL'}] ${n}`); };

// Fire 5 times. The old code picked ONE room at random and gave up when empty,
// so roughly a third of these produced nothing at all.
// The fixture holds exactly 4 eligible people: Priyanshi in #desiadda, and
// divya_31/Aditi30/anisha in #chatsansar (ops_guy is an operator, rahul and
// amit match no hint). All four must be reached DESPITE a third of the
// channel list being a room the bot cannot enter.
let got = 0;
for (let i = 0; i < 4; i++) if (r.inviteOne()) got++;
c(`every eligible person is reached despite an unreachable room (got ${got}/4)`, got === 4);
c('and the 5th attempt finds the pool drained, not an error', r.inviteOne() === null);
c('never invites the operator', !sent.some(l => /ops_guy/.test(l)));
c('never invites the same person twice', new Set(sent).size === sent.length);
c(`recent list is populated for !!recruit (${r.recent.length})`, r.recent.length === 4);
c('recent entries name the room they came from', r.recent.every(x => x.chan && x.target));

const ex = r.explain();
c('explain() says plainly the room is unreachable',
  ex.some(l => /NOT IN THE ROOM/.test(l) && /allindiachat/.test(l)));
console.log('\n  explain():'); ex.forEach(l => console.log('    ' + l));
console.log('\n  sent:'); sent.forEach(l => console.log('    ' + l));
console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
