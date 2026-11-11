import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReply } from '../src/reply.js';

test('greets briefly', () => assert.match(makeReply('hey'), /Hey!/));
test('responds to recruiting', () => assert.match(makeReply('We have a job opportunity'), /role/));
test('responds to meeting', () => assert.match(makeReply('Can we schedule a call?'), /time zone/));
test('responds to pricing', () => assert.match(makeReply('What is the cost?'), /tell me/));
test('responds to emoji', () => assert.match(makeReply('😊'), /reaching out/));
test('responds to empty', () => assert.match(makeReply(''), /reaching out/));
test('responds to lengthy message', () => assert.match(makeReply('details '.repeat(150)), /focus on first/));
test('responds to unknown question without fabricating', () => assert.match(makeReply('What is the secret launch date?'), /context/));
test('supports Arabic', () => assert.match(makeReply('مرحبا، عندي سؤال'), /أهلاً/));

for (const [message, expected] of [
  ['Hi, can we schedule a call?', /time zone/],
  ['Hello, what is your pricing?', /tell me/],
  ['Interested in collaborating', /project/],
  ['Can I see your portfolio?', /examples/],
  ['Please send your CV', /experience/],
  ['What services do you offer?', /achieve/],
  ['I need a website', /features/],
  ['The app is not working', /error message/],
  ['Just following up', /topic/],
  ['What is the deadline?', /date/],
  ['What is your email?', /here on LinkedIn/],
  ['Where are you based in?', /location/],
  ['Stop messaging about this job', /Understood/],
  ['Bye, take care', /Take care/],
  ['Bonjour', /Bonjour/],
  ['How are you?', /checking in/],
  ['شو سعر الخدمة؟', /المطلوب/],
  ['بدنا موعد مكالمة', /زمنية/],
  ['عندي فرصة عمل', /الوظيفة/],
]) {
  test(`responds to: ${message}`, () => assert.match(makeReply(message), expected));
}
