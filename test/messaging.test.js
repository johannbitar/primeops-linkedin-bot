import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readLastMessage, readConversation, conversationFingerprint, findComposer, unreadConversationUrls, discoverConversationUrls } from '../src/messaging.js';
import { replyToConversation } from '../src/bot.js';
import { makeReply } from '../src/reply.js';

test('conversation DOM handling in a local browser (no LinkedIn connection)', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();

  await t.test('reads event rows without the old group wrapper and inherits consecutive sender', async () => {
    await page.setContent(`<main><ul class="msg-s-message-list-content">
      <li class="msg-s-message-list__event"><span class="msg-s-message-group__name">Alice</span><p class="msg-s-event-listitem__body">Hello</p></li>
      <li class="msg-s-message-list__event" data-event-urn="event:2"><p class="msg-s-event-listitem__body">Can we call?</p></li>
    </ul></main><aside><p class="msg-s-event-listitem__body">Unrelated chat</p></aside>`);
    assert.deepEqual(await readLastMessage(page), { sender: 'Alice', own: false, message: 'Can we call?', id: 'event:2' });
  });
  await t.test('recognizes outgoing messages even without a sender label', async () => {
    await page.setContent(`<main><div class="msg-s-message-list-content"><div class="msg-s-message-group msg-s-message-group--is-self"><p class="msg-s-event-listitem__body">My reply</p></div></div></main>`);
    assert.equal((await readLastMessage(page)).own, true);
  });
  await t.test('detects file-only messages and keeps them after earlier text in chronological order', async () => {
    await page.setContent(`<main><div role="log">
      <div class="msg-s-event-listitem"><span class="msg-s-message-group__name">Owner</span><p class="msg-s-event-listitem__body">Previous response</p></div>
      <div class="msg-s-event-listitem" data-event-urn="file:1"><span class="msg-s-message-group__name">Contact</span><div class="msg-s-event-listitem__attachment"><a download href="https://files.invalid/private.pdf">private.pdf</a></div></div>
    </div></main>`);
    const conversation = await readConversation(page, 'Owner');
    assert.equal(conversation.messages.length, 2);
    assert.deepEqual(conversation.incoming, [{ sender: 'Contact', own: false, message: '', id: 'file:1', hasAttachment: true }]);
    assert.equal(conversation.last.hasAttachment, true);
    const before = conversationFingerprint(conversation);
    await page.locator('[data-event-urn]').evaluate((event) => { event.dataset.eventUrn = 'file:2'; });
    assert.notEqual(conversationFingerprint(await readConversation(page, 'Owner')), before);
  });
  await t.test('combines caption and file markers once and recognizes owner attachments', async () => {
    await page.setContent(`<main><div role="log">
      <div class="msg-s-event-listitem"><span class="msg-s-message-group__name">Contact</span><p class="msg-s-event-listitem__body">Please review this</p><div class="msg-s-event-listitem__attachment"><a download href="https://files.invalid/file.pdf">file.pdf</a></div></div>
      <div class="msg-s-event-listitem msg-s-event-listitem--self"><div class="msg-s-event-listitem__shared-image">Image</div></div>
    </div></main>`);
    const conversation = await readConversation(page, 'Owner');
    assert.equal(conversation.messages.length, 2);
    assert.equal(conversation.messages[0].message, 'Please review this');
    assert.equal(conversation.messages[0].hasAttachment, true);
    assert.equal(conversation.last.own, true);
    assert.deepEqual(conversation.incoming, []);
  });
  await t.test('rejects messages with unknown sender and ignores hidden history', async () => {
    await page.setContent(`<main><div class="msg-s-message-list-content" hidden><span class="msg-s-message-group__name">Hidden</span><p class="msg-s-event-listitem__body">Old</p></div><div class="msg-s-message-list-content"><p class="msg-s-event-listitem__body">Unknown</p></div></main>`);
    assert.equal(await readLastMessage(page), null);
  });
  await t.test('finds only one visible main composer and triggers input on fill', async () => {
    await page.setContent(`<main><div class="msg-form"><div role="textbox" contenteditable="true" oninput="this.nextElementSibling.disabled=false"></div><button disabled>Send</button></div></main><aside><div role="textbox" contenteditable="true">Other chat</div></aside>`);
    const composer = await findComposer(page);
    await composer.fill('Thanks for reaching out!');
    assert.equal(await page.locator('main button').isEnabled(), true);
    assert.equal(await page.locator('aside div').innerText(), 'Other chat');
    await page.locator('main').evaluate((main) => main.insertAdjacentHTML('beforeend', '<div role="textbox" contenteditable="true">Draft</div>'));
    assert.equal(await findComposer(page), null);
  });
  await t.test('snapshots stable thread URLs and supports explicit unread badges', async () => {
    await page.setContent(`<ul><li class="msg-conversation-listitem msg-conversation-listitem--unread"><a href="https://www.linkedin.com/messaging/thread/one/?x=1">Alice</a></li><li class="msg-conversation-listitem"><a href="https://www.linkedin.com/messaging/thread/two/">Bob</a></li></ul>`);
    assert.deepEqual(await unreadConversationUrls(page, true), ['https://www.linkedin.com/messaging/thread/one/']);
    assert.equal((await unreadConversationUrls(page)).length, 2);
  });
  await t.test('collects every incoming message after the latest owner response, including long Unicode text', async () => {
    await page.setContent(`<div role="main"><div role="log">
      <div class="msg-s-event-listitem"><span class="msg-s-message-group__name">Contact</span><p class="msg-s-event-listitem__body">Already answered</p></div>
      <div class="msg-s-event-listitem"><span class="msg-s-message-group__name">Owner</span><p class="msg-s-event-listitem__body">Previous reply</p></div>
      <div class="msg-s-message-group"><span class="msg-s-message-group__name">Contact</span>
      <div class="msg-s-event-listitem"><p class="msg-s-event-listitem__body">مرحبا، عندي أسئلة</p></div>
      <div class="msg-s-event-listitem" data-event-urn="last"><p class="msg-s-event-listitem__body">Bonjour, voici les détails</p></div></div>
    </div></div>`);
    const long = 'تفاصيل المشروع 中文 '.repeat(2000);
    await page.locator('.msg-s-event-listitem__body').last().evaluate((body, text) => { body.textContent = text; }, long);
    const conversation = await readConversation(page, 'Owner');
    assert.equal(conversation.messages.length, 4);
    assert.equal(conversation.incoming.length, 2);
    assert.equal(conversation.incoming[1].message, long.trim());
    assert.equal(conversation.incoming[0].own, false);
    const before = conversationFingerprint(conversation);
    await page.locator('[data-event-urn="last"]').evaluate((event) => { event.dataset.eventUrn = 'new-event'; });
    assert.notEqual(conversationFingerprint(await readConversation(page, 'Owner')), before);
  });
  await t.test('sends through a div-based composer, persists before clicking, and prevents duplicates', async () => {
    // Fulfilled locally: no request reaches LinkedIn or another external service.
    await page.route('https://fixture.test/**', (route) => route.fulfill({
      contentType: 'text/html', body: `<main>
        <div class="msg-s-message-list-content"><div class="msg-s-message-list__event"><span class="msg-s-message-group__name">Fixture Sender</span><p class="msg-s-event-listitem__body">Hi, can we schedule a call?</p></div></div>
        <div class="msg-form"><div class="msg-form__contenteditable" contenteditable="true" oninput="this.nextElementSibling.disabled=false"></div><button class="msg-form__send-button" disabled onclick="window.sends=(window.sends||0)+1; const row=document.createElement('div');row.className='msg-s-message-group--is-self';const body=document.createElement('p');body.className='msg-s-event-listitem__body';body.textContent=this.previousElementSibling.innerText;row.append(body);document.querySelector('.msg-s-message-list-content').append(row);this.previousElementSibling.textContent=''">Send</button></div>
      </main>`,
    }));
    await page.goto('https://fixture.test/messaging/thread/one/');
    const state = { replied: {}, pending: [] };
    let writes = 0;
    const options = { dryRun: false, saveState: () => { writes++; }, settleMs: 0, generateReply: (conversation) => makeReply(conversation.incoming.map((entry) => entry.message).join('\n')) };
    await replyToConversation(page, state, { ...options, dryRun: true });
    assert.equal(await page.evaluate(() => window.sends || 0), 0);
    await page.locator('[contenteditable]').fill('My existing draft');
    await replyToConversation(page, state, options);
    assert.equal(await page.locator('[contenteditable]').innerText(), 'My existing draft');
    assert.equal(writes, 0);
    await page.locator('[contenteditable]').fill('');
    await assert.rejects(replyToConversation(page, state, {
      ...options, generateReply: async () => { throw Error('Gemini HTTP 429'); },
    }), /429/);
    assert.equal(writes, 0);
    assert.equal(await page.evaluate(() => window.sends || 0), 0);
    assert.deepEqual(state.replied, {});
    await page.exposeFunction('checkPersisted', () => assert.equal(writes, 1));
    await page.locator('button').evaluate((button) => button.addEventListener('click', () => window.checkPersisted()));
    assert.equal(await replyToConversation(page, state, options), true);
    assert.equal(writes, 2);
    await replyToConversation(page, state, options);
    assert.equal(await page.evaluate(() => window.sends), 1);
  });
  await t.test('discovers clickable conversation DIVs without any thread anchors', async () => {
    await page.setContent(`<main><ul><li class="msg-conversation-listitem"><div class="msg-conversation-listitem__link" onclick="history.pushState({},'', '/messaging/thread/clicked/')"><h3 class="msg-conversation-listitem__participant-names">Fixture contact</h3></div></li></ul></main>`);
    const saved = [];
    assert.deepEqual(await discoverConversationUrls(page, { onDiscover: async (url) => saved.push(url) }), ['https://fixture.test/messaging/thread/clicked/']);
    assert.deepEqual(saved, ['https://fixture.test/messaging/thread/clicked/']);
  });
  const setConversation = async () => {
    await page.setContent(`<main><div role="log">
      <div class="msg-s-event-listitem"><span class="msg-s-message-group__name">Contact</span><p class="msg-s-event-listitem__body">Bonjour, pouvez-vous expliquer vos services ?</p></div>
      <div class="msg-s-event-listitem"><p class="msg-s-event-listitem__body">Et les prochaines étapes ?</p></div>
    </div><form class="msg-form"><div contenteditable="true" role="textbox"></div><button type="button" class="msg-form__send-button">Envoyer</button></form></main>`);
  };
  await t.test('sends one combined French answer and confirms the outgoing bubble', async () => {
    await setConversation();
    await page.locator('button').evaluate((button) => button.addEventListener('click', () => {
      const event = document.createElement('div'); event.className = 'msg-s-message-group--is-self';
      const body = document.createElement('p'); body.className = 'msg-s-event-listitem__body';
      body.textContent = document.querySelector('[contenteditable]').innerText;
      event.append(body); document.querySelector('[role="log"]').append(event);
      document.querySelector('[contenteditable]').textContent = '';
    }));
    const state = { replied: {} };
    let generations = 0;
    await replyToConversation(page, state, { dryRun: false, settleMs: 0, saveState: () => {}, generateReply: async (conversation) => {
      generations++;
      assert.equal(conversation.incoming.length, 2);
      return 'Bonjour ! Quels services recherchez-vous et quel est votre objectif ?';
    } });
    assert.equal(generations, 1);
    assert.equal(Object.values(state.replied)[0].status, 'sent');
    assert.match((await readLastMessage(page)).message, /^Bonjour/);
  });
  await t.test('discards a stale generated answer when another message arrives', async () => {
    await setConversation();
    const state = { replied: {} };
    await replyToConversation(page, state, { dryRun: false, settleMs: 0, saveState: () => assert.fail('Should not persist a send'), generateReply: async () => {
      await page.locator('[role="log"]').evaluate((history) => history.insertAdjacentHTML('beforeend', '<div class="msg-s-event-listitem"><p class="msg-s-event-listitem__body">Please answer in Arabic instead</p></div>'));
      return 'Stale reply';
    } });
    assert.deepEqual(state.replied, {});
    assert.equal(await page.locator('[contenteditable]').innerText(), '');
  });
  await t.test('an unconfirmed send is recorded as uncertain and is never clicked twice', async () => {
    await setConversation();
    await page.locator('button').evaluate((button) => button.addEventListener('click', () => {
      window.uncertainClicks = (window.uncertainClicks || 0) + 1;
      document.querySelector('[contenteditable]').textContent = '';
    }));
    const state = { replied: {} };
    const options = { dryRun: false, settleMs: 0, deliveryTimeoutMs: 100, saveState: () => {}, generateReply: async () => 'Test reply' };
    await assert.rejects(replyToConversation(page, state, options), /outgoing message did not appear/);
    assert.equal(Object.values(state.replied)[0].status, 'uncertain');
    await replyToConversation(page, state, options);
    assert.equal(await page.evaluate(() => window.uncertainClicks), 1);
  });
  await t.test('sends a text-only limitation for an attachment-only conversation', async () => {
    await page.setContent(`<main><div role="log"><div class="msg-s-event-listitem"><span class="msg-s-message-group__name">Contact</span><div class="msg-s-file-attachment"><a download href="https://files.invalid/file.pdf">File</a></div></div></div><form class="msg-form"><div contenteditable="true" role="textbox"></div><button type="button" class="msg-form__send-button">Send</button></form></main>`);
    await page.locator('button').evaluate((button) => button.addEventListener('click', () => {
      const event = document.createElement('div'); event.className = 'msg-s-event-listitem msg-s-event-listitem--self';
      const body = document.createElement('p'); body.className = 'msg-s-event-listitem__body';
      body.textContent = document.querySelector('[contenteditable]').innerText;
      event.append(body); document.querySelector('[role="log"]').append(event);
      document.querySelector('[contenteditable]').textContent = '';
    }));
    const state = { replied: {} };
    const { generateReply } = await import('../src/gemini.js');
    await replyToConversation(page, state, { dryRun: false, settleMs: 0, saveState: () => {}, generateReply: (conversation) => generateReply(conversation, { env: { REPLY_PROVIDER: 'local' } }) });
    assert.equal(Object.values(state.replied)[0].status, 'sent');
    assert.match((await readLastMessage(page)).message, /can't open files.*only read text.*paste/i);
  });
});
