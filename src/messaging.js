import { createHash } from 'node:crypto';

// Keep reads inside the open conversation, away from floating chat windows.
export async function readConversation(page, myName = '') {
  return page.locator('main, [role="main"]').evaluateAll((mains, owner) => {
    const visible = (el) => el && el.getClientRects().length > 0;
    const attachmentSelector = '.msg-s-event-listitem__attachment, .msg-s-event-listitem__attachment-item, .msg-s-event-listitem__attachment-container, .msg-s-event-listitem__file-attachment, .msg-s-event-listitem__download-attachment, .msg-s-event-listitem__shared-image, .msg-s-event-listitem__shared-document, .msg-s-event-listitem__image, .msg-s-attachments, .msg-s-file-attachment, .msg-s-image-attachment, a[download]';
    const contentSelector = `.msg-s-event-listitem__body, ${attachmentSelector}`;
    const histories = mains.flatMap((main) => [...main.querySelectorAll(
      '.msg-s-message-list-content, .msg-s-message-list, [role="log"]',
    )]).filter(visible);
    const history = histories.sort((a, b) => b.querySelectorAll(contentSelector).length - a.querySelectorAll(contentSelector).length)[0]
      || mains.find((main) => visible(main) && main.querySelector(contentSelector));
    if (!history) return null;
    const entries = [];
    const byEvent = new Map();
    for (const node of [...history.querySelectorAll(contentSelector)].filter(visible)) {
      const event = node.closest('.msg-s-event-listitem, .msg-s-message-list__event') || node.closest('.msg-s-message-group') || node;
      let entry = byEvent.get(event);
      if (!entry) {
        entry = { node, event, texts: [], hasAttachment: false };
        byEvent.set(event, entry);
        entries.push(entry);
      }
      if (node.matches('.msg-s-event-listitem__body')) entry.texts.push(node.innerText.trim());
      if (node.matches(attachmentSelector)) entry.hasAttachment = true;
    }
    const names = [...history.querySelectorAll('.msg-s-message-group__name, .msg-s-event-listitem__name')];
    let previousSender = '';
    let previousOwn = false;
    const messages = entries.map(({ node: body, texts, hasAttachment }) => {
      const event = body.closest('.msg-s-message-list__event, .msg-s-event-listitem');
      const group = body.closest('.msg-s-message-group');
      const scope = event || group;
      let sender = '';
      for (const name of names) {
        if ((scope?.contains(name) || group?.contains(name)) && (name.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING)) sender = name.textContent.trim();
      }
      const markedOwn = Boolean(body.closest('.msg-s-message-group--is-self, .msg-s-event-listitem--self'));
      const own = markedOwn || (sender ? Boolean(owner && sender.toLocaleLowerCase() === owner.toLocaleLowerCase()) : previousOwn);
      if (!sender) sender = markedOwn ? (owner || 'You') : previousSender;
      previousSender = sender;
      previousOwn = own;
      return { sender, own, message: texts.join('\n\n'), id: body.closest('[data-event-urn]')?.getAttribute('data-event-urn') || event?.getAttribute('data-id') || '', ...(hasAttachment ? { hasAttachment: true } : {}) };
    });
    const last = messages.at(-1);
    if (!last || (!last.sender && !last.own)) return null;
    let boundary = messages.length - 1;
    while (boundary >= 0 && !messages[boundary].own) boundary--;
    const incoming = messages.slice(boundary + 1);
    if (incoming.some((message) => !message.sender)) return null;
    return { messages, incoming, last };
  }, myName.trim());
}

export async function readLastMessage(page, myName = '') {
  return (await readConversation(page, myName))?.last || null;
}

export function conversationFingerprint(conversation) {
  const boundary = conversation.messages.slice(0, conversation.messages.length - conversation.incoming.length).at(-1);
  return createHash('sha256').update(JSON.stringify({ boundary, incoming: conversation.incoming })).digest('hex');
}

export async function findComposer(page) {
  const composers = page.locator('main .msg-form__contenteditable[contenteditable="true"], main [role="textbox"][contenteditable="true"], [role="main"] .msg-form__contenteditable[contenteditable="true"], [role="main"] [role="textbox"][contenteditable="true"]');
  const visible = [];
  for (const composer of await composers.all()) {
    if (await composer.isVisible()) visible.push(composer);
  }
  return visible.length === 1 ? visible[0] : null;
}

export async function findSendButton(composer) {
  const form = composer.locator("xpath=ancestor::*[self::form or contains(concat(' ', normalize-space(@class), ' '), ' msg-form ')][1]");
  for (const button of await form.locator('button.msg-form__send-button, button[type="submit"], button[aria-label="Send"]').all()) {
    if (await button.isVisible()) return button;
  }
  const translated = form.getByRole('button', { name: /^(send|envoyer|enviar|senden|invia|إرسال|ارسال|送信|发送|傳送|보내기)(?:\s|$)/i });
  return await translated.count() === 1 ? translated : null;
}

export async function unreadConversationUrls(page, unreadOnly = false) {
  if (!unreadOnly) {
    return page.locator('main a[href*="/messaging/thread/"], [role="main"] a[href*="/messaging/thread/"], .msg-conversation-listitem a[href*="/messaging/thread/"]').evaluateAll((anchors) => {
      return [...new Set(anchors.filter((anchor) => anchor.getClientRects().length > 0).map((anchor) => {
        const url = new URL(anchor.href);
        return `${url.origin}${url.pathname}`;
      }))];
    });
  }
  return page.locator('.msg-conversation-listitem').evaluateAll((rows, unreadOnly) => {
    return [...new Set(rows.filter((row) => row.getClientRects().length > 0 && (!unreadOnly ||
      row.matches('.msg-conversation-listitem--unread') ||
      row.querySelector('.msg-conversation-card__unread-count, .notification-badge, [aria-label*="unread" i]')))
      .map((row) => row.querySelector('a[href*="/messaging/thread/"]')?.href)
      .filter(Boolean).map((href) => {
        const url = new URL(href);
        return `${url.origin}${url.pathname}`;
      }))];
  }, unreadOnly);
}

// Current LinkedIn uses clickable DIV rows, without <a href> thread links.
export async function discoverConversationUrls(page, { unreadOnly = false, onDiscover = async () => {} } = {}) {
  const urls = new Set(await unreadConversationUrls(page, unreadOnly));
  for (const url of urls) await onDiscover(url);
  const targets = await page.locator('.msg-conversation-listitem').evaluateAll((rows, unreadOnly) => rows
    .filter((row) => row.getClientRects().length > 0 && (!unreadOnly || row.matches('.msg-conversation-listitem--unread') || row.querySelector('.msg-conversation-card__unread-count, .notification-badge, [aria-label*="unread" i]')))
    .slice(0, 30).map((row) => row.querySelector('.msg-conversation-listitem__participant-names, h3')?.textContent.trim()).filter(Boolean), unreadOnly);
  for (const name of new Set(targets)) {
    const row = page.locator('.msg-conversation-listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
    if (await row.count() !== 1) continue;
    if (await row.locator('a[href*="/messaging/thread/"]').count()) continue;
    const link = row.locator('.msg-conversation-listitem__link').first();
    if (!(await link.isVisible().catch(() => false))) continue;
    const active = (await link.getAttribute('class') || '').includes('convo-item-link--active');
    const before = page.url();
    if (!active || !new URL(before).pathname.includes('/messaging/thread/')) {
      await link.click();
      await page.waitForURL((url) => url.href !== before && url.pathname.includes('/messaging/thread/'), { timeout: 10000 });
    }
    const current = new URL(page.url());
    if (!current.pathname.includes('/messaging/thread/')) continue;
    const url = `${current.origin}${current.pathname}`;
    urls.add(url);
    // Opening marks the row read: remember its URL immediately, before generation.
    await onDiscover(url);
  }
  return [...urls];
}
