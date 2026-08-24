'use strict';
// A second opinion, from a second account.
//
// Groq meters per ACCOUNT, so a second Groq key buys nothing — both share one
// allowance, and "both keys returned 429" is simply what a spent day looks
// like. Surviving a spent day needs a provider on a DIFFERENT meter.
//
// Google AI Studio's free tier is the practical choice: no card, a daily
// allowance comfortably larger than Groq's, and hosted, so it costs nothing in
// runner CPU. Running a local model on the Actions runner was the alternative
// and is a bad trade — no GPU means roughly 8-20 seconds per judgement on a
// prompt this size, against a room that produces messages every few seconds,
// and sustained inference on a CI runner risks the account that holds the
// channel access for both bots.
//
// Dormant until GEMINI_API_KEY exists. No key, no calls, no errors.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Ask Gemini, using the OpenAI-shaped body the rest of the bot already builds,
 * and hand back an OpenAI-shaped response so callers cannot tell the difference.
 * Translating at the edge keeps every call site provider-agnostic — the
 * alternative was six call sites each learning about two response formats.
 *
 * @param {object} body   {messages,temperature,max_tokens}
 * @param {string} key
 * @param {string} model
 * @returns {Promise<object>} {choices:[{message:{content}}]}
 */
async function geminiChat(body, key, model) {
    // Gemini takes the system prompt in its own field, not as a message.
    const system = (body.messages || []).filter((m) => m.role === 'system')
        .map((m) => m.content).join('\n\n');
    const contents = (body.messages || [])
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user',
                       parts: [{ text: m.content }] }));
    if (!contents.length) return null;

    const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents,
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            generationConfig: {
                temperature: body.temperature ?? 0,
                maxOutputTokens: body.max_tokens || 200,
            },
            // The bot's own filters decide what is abuse. Google's would refuse
            // to CLASSIFY the very messages we need classified — asking "is this
            // harassment?" trips a harassment filter and returns nothing, which
            // reads as "no problem found" and lets the abuse through.
            safetySettings: [
                'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
                'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT',
            ].map((category) => ({ category, threshold: 'BLOCK_NONE' })),
        }),
    });
    if (!res.ok) {
        const e = new Error(res.status === 429
            ? 'gemini rate limited (429)'
            : `gemini HTTP ${res.status}`);
        e.status = res.status;
        throw e;
    }
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || '').join('').trim();
    if (!text) return null;
    return { choices: [{ message: { content: text } }] };
}

module.exports = { geminiChat };
