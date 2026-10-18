// Fake Groq for moderation tests: flags EVERY message, quoting it whole, with
// the reason in STUB_REASON. Chat replies (not JSON-asking) get "none" too.
const orig = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('api.groq.com')) {
    const body = JSON.parse(opts.body);
    const msg = body.messages[body.messages.length - 1].content;
    const reason = process.env.STUB_REASON_FILE
      ? require('fs').readFileSync(process.env.STUB_REASON_FILE, 'utf8').trim() : 'abuse';
    const content = JSON.stringify({ action: 'warn', confident: true, quote: msg, reason });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  }
  return orig(url, opts);
};
