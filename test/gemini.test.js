import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReply } from '../src/gemini.js';

const env = { REPLY_PROVIDER: 'gemini', GEMINI_API_KEY: 'fixture-key', GEMINI_MODEL: 'fixture-model', BOT_CONTEXT: 'I build websites.' };
const success = (parts = [{ text: 'What features do you need?' }], finishReason = 'STOP') => ({
  ok: true, json: async () => ({ candidates: [{ finishReason, content: { parts } }] }),
});

test('Gemini uses header authentication and separates instructions from message', async () => {
  const reply = await generateReply('Need a website', { env, fetch: async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/fixture-model:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'fixture-key');
    assert.ok(!url.includes('fixture-key'));
    const body = JSON.parse(options.body);
    assert.match(body.systemInstruction.parts[0].text, /I build websites/);
    assert.equal(body.contents[0].parts[0].text, 'Need a website');
    assert.ok(options.signal);
    return success([{ thought: true, text: 'Internal thinking' }, { text: 'What features do you need?' }]);
  } });
  assert.equal(reply, 'What features do you need?');
});

test('missing key fails before any request', async () => {
  await assert.rejects(generateReply('Hi', { env: { REPLY_PROVIDER: 'gemini' }, fetch: () => assert.fail('Unexpected request') }), /Set GEMINI_API_KEY/);
});

test('key selects Gemini while explicit local mode stays offline', async () => {
  assert.equal(await generateReply('Hi', { env: { GEMINI_API_KEY: 'fixture-key' }, fetch: async () => success() }), 'What features do you need?');
  assert.match(await generateReply('Hi', { env: { ...env, REPLY_PROVIDER: 'local' }, fetch: () => assert.fail('Unexpected request') }), /Hey!/);
});

for (const status of [400, 401, 403, 404, 429, 503]) {
  test(`Gemini HTTP ${status} produces an error without exposing the key`, async () => {
    await assert.rejects(generateReply('Hi', { env, fetch: async () => ({ ok: false, status }) }), (error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.ok(!error.message.includes(env.GEMINI_API_KEY));
      return true;
    });
  });
}

test('empty, blocked, truncated and oversized responses are never sent', async () => {
  for (const response of [success([]), success([{ text: 'partial' }], 'MAX_TOKENS'), success([{ text: 'blocked' }], 'SAFETY'), success([{ text: 'x'.repeat(3001) }])]) {
    await assert.rejects(generateReply('Hi', { env, fetch: async () => response }), /no reply sent/);
  }
});

test('network and timeout errors remain controlled', async () => {
  await assert.rejects(generateReply('Hi', { env, fetch: async () => { throw Error('secret fixture-key'); } }), /Cannot reach Gemini/);
  await assert.rejects(generateReply('Hi', { env, fetch: async () => { throw new DOMException('timeout', 'TimeoutError'); } }), /timed out/);
});

test('model cannot redirect the API key to another host', async () => {
  await assert.rejects(generateReply('Hi', { env: { ...env, GEMINI_MODEL: 'https://other.test' } }), /Invalid GEMINI_MODEL/);
});

test('passes the complete multilingual conversation and all long incoming messages without truncation', async () => {
  const long = '中文 تفاصيل '.repeat(3000);
  const incoming = [{ message: 'Bonjour, je souhaite discuter.' }, { message: long }];
  const messages = [{ own: true, message: 'Previous answer' }, ...incoming];
  await generateReply({ messages, incoming }, { env, fetch: async (_url, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(input.unansweredMessages, incoming.map((entry) => entry.message));
    assert.equal(input.conversation[2].text, long);
    assert.equal(input.conversation[0].role, 'account_owner');
    assert.match(body.systemInstruction.parts[0].text, /ALL unanswered messages/);
    assert.match(body.systemInstruction.parts[0].text, /language used by the contact/);
    assert.equal(body.generationConfig.maxOutputTokens, 4096);
    return success([{ text: 'أكيد، خلينا نحكي عن التفاصيل.' }]);
  } });
});

test('oversized input fails explicitly rather than silently dropping user messages', async () => {
  await assert.rejects(generateReply('x'.repeat(500001), { env, fetch: () => assert.fail('Unexpected request') }), /no messages were truncated/);
});

test('attachment markers tell Gemini to explain the limitation without sending files or URLs', async () => {
  const incoming = [{ message: 'Peux-tu lire ce fichier ?', hasAttachment: true }];
  await generateReply({ messages: incoming, incoming }, { env, fetch: async (_url, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.contents[0].parts[0].text);
    assert.match(input.unansweredMessages[0], /contents unavailable/);
    assert.match(input.unansweredMessages[0], /Peux-tu lire/);
    assert.match(body.systemInstruction.parts[0].text, /cannot open files and can only read text/);
    assert.match(body.systemInstruction.parts[0].text, /paste the relevant contents/);
    assert.deepEqual(Object.keys(body.contents[0].parts[0]), ['text']);
    return success([{ text: 'Je ne peux pas ouvrir les fichiers. Merci de coller le texte ici.' }]);
  } });
});
