const orig = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('api.groq.com')) {
    const body = JSON.parse(opts.body);
    const sys = body.messages[0].content;
    let content = 'a plain answer';
    if (/compact JSON/.test(sys)) content = '{"q":"what has keys but no locks?","a":"a piano"}';
    else if (/would you rather/i.test(sys)) content = 'Would you rather always be early or always be late?';
    else if (/fortune/i.test(sys)) content = 'Tonight you will win an argument you should have lost.';
    else if (/slang and idioms/i.test(sys)) content = 'Jugaad means a scrappy improvised fix.';
    else if (/translate/i.test(sys)) content = 'how are you';
    return { ok:true, status:200, json: async()=>({choices:[{message:{content}}]}) };
  }
  return orig(url, opts);
};
