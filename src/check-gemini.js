import 'dotenv/config';
import { generateReply } from './gemini.js';

try {
  const samples = process.argv.includes('--multilingual') ? [
    { name: 'French', messages: ['Bonjour ! Je souhaite créer un site pour mon entreprise.', 'Quelles informations dois-je préparer ? Répondez en français.'], pattern: /bonjour|vous|votre|informations|préparer/i },
    { name: 'Arabic, multiple long messages', messages: ['مرحبا، عندي مشروع موقع وبدي اسأل عن الخطوات.', 'معلومات إضافية عن المشروع: '.repeat(600), 'شو المعلومات اللي لازم جهزها؟ جاوب بالعربي وباختصار.'], pattern: /[\u0600-\u06ff]/u },
    { name: 'Chinese', messages: ['你好，我想做一个网站。', '请问需要准备什么资料？请用中文回答。'], pattern: /[\u3400-\u9fff]/u },
  ] : [{ name: 'connection', messages: ['Hello! What can you help me with?'] }];
  for (const sample of samples) {
    const incoming = sample.messages.map((message) => ({ message, own: false }));
    const reply = await generateReply({ messages: incoming, incoming }, { env: { ...process.env, REPLY_PROVIDER: 'gemini' } });
    if (sample.pattern && !sample.pattern.test(reply)) throw Error(`${sample.name}: reply did not match the expected language.`);
    console.log(`Gemini ${sample.name} OK. Test reply:`, reply);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
