// The Gemini adapter, against a stub HTTP layer. No network, no key needed.
const path = '../gemini.js';
let captured = null, reply = null, status = 200;
global.fetch = async (url, opts) => {
  captured = { url, body: JSON.parse(opts.body) };
  return { ok: status < 400, status, json: async () => reply };
};
const { geminiChat } = require(path);
let fails = 0;
const c = (n, ok, d='') => { if(!ok) fails++; console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`); };

(async () => {
  reply = { candidates: [{ content: { parts: [{ text: '{"action":"none"}' }] } }] };
  const body = {
    messages: [{role:'system',content:'SYS RULES'},{role:'user',content:'hello there'}],
    temperature: 0, max_tokens: 80,
  };
  const out = await geminiChat(body, 'KEY', 'gemini-2.0-flash');

  c('returns an OpenAI-shaped response the callers already parse',
    out?.choices?.[0]?.message?.content === '{"action":"none"}', JSON.stringify(out));
  c('system prompt goes to systemInstruction, not messages',
    captured.body.systemInstruction.parts[0].text === 'SYS RULES' &&
    captured.body.contents.every(x => x.parts[0].text !== 'SYS RULES'),
    JSON.stringify(captured.body).slice(0,160));
  c('user turn is carried across',
    captured.body.contents[0].parts[0].text === 'hello there');
  c('temperature and max tokens are carried across',
    captured.body.generationConfig.maxOutputTokens === 80 &&
    captured.body.generationConfig.temperature === 0);
  c('safety filters are OFF so it can CLASSIFY abuse instead of refusing',
    captured.body.safetySettings.length === 4 &&
    captured.body.safetySettings.every(s => s.threshold === 'BLOCK_NONE'),
    JSON.stringify(captured.body.safetySettings));
  c('the key travels in the query string, not a header',
    /key=KEY/.test(captured.url) && /gemini-2\.0-flash:generateContent/.test(captured.url), captured.url);

  // Failure paths
  status = 429;
  let threw = null;
  try { await geminiChat(body, 'KEY', 'm'); } catch (e) { threw = e; }
  c('a 429 raises a labelled error', threw && threw.status === 429 && /rate limited/.test(threw.message), String(threw));

  status = 200;
  reply = { candidates: [] };
  c('an empty answer is null, not a crash', (await geminiChat(body, 'KEY', 'm')) === null);

  const none = await geminiChat({ messages: [{role:'system',content:'x'}] }, 'K', 'm');
  c('a system-only body sends nothing', none === null);

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails?1:0);
})();
