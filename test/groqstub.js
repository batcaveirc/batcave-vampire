// Keeps tests off the real Groq API: every call answers "none", instantly.
const orig = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('api.groq.com')) {
    return { ok: true, status: 200, json: async () => ({
      choices: [{ message: { content: '{"action":"none","confident":true,"quote":"","reason":"ok"}' } }],
    }) };
  }
  return orig(url, opts);
};
