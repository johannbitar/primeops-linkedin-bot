import "dotenv/config";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateReply } from "./gemini.js";
import { readConversation, conversationFingerprint, findComposer, findSendButton, discoverConversationUrls } from "./messaging.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = path.join(root, ".browser-profile");
const statePath = path.join(root, "data", "processed.json");
const loginOnly = process.argv.includes("--login");
const diagnoseOnly = process.argv.includes("--diagnose");
const once = process.argv.includes('--once');
const dryRun =
  diagnoseOnly || process.argv.includes("--dry-run") || process.env.DRY_RUN !== "false";
const myName = (process.env.MY_NAME || "").trim();
const maxAccept = Number(process.env.MAX_ACCEPT_PER_CYCLE || 5);
const maxReplies = Number(process.env.MAX_REPLIES_PER_CYCLE || 5);
const pollMs = Math.max(10000, Number(process.env.POLL_SECONDS || 15) * 1000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...v) => console.log(new Date().toISOString(), ...v);

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return { ...state, replied: state.replied || {}, pending: state.pending || [] };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { replied: {}, pending: [] };
  }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${statePath}.tmp`, statePath);
}
function isNameMatch(sender) {
  return sender.trim().toLocaleLowerCase() === myName.toLocaleLowerCase();
}
async function loggedIn(page) {
  const url = new URL(page.url());
  if (/\/(login|checkpoint|uas\/login|authwall|signup)/i.test(url.pathname)) return false;
  if (url.hostname !== 'www.linkedin.com' && url.hostname !== 'linkedin.com') return false;
  const security = page
    .getByRole('heading', { name: /verify your identity|security verification|unusual activity/i })
    .first();
  return !(await security.isVisible().catch(() => false));
}
async function go(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  if (!(await loggedIn(page))) {
    if (diagnoseOnly) throw Error('LinkedIn login/checkpoint required. Run npm run login and complete sign-in in the bot browser.');
    log('LinkedIn needs sign-in/security verification. Complete it in this browser; the bot will resume automatically.');
    while (!(await loggedIn(page))) await page.waitForTimeout(2000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    if (!(await loggedIn(page))) throw Error('LinkedIn login/checkpoint is still active.');
  }
}

async function acceptIncoming(page) {
  log("Checking incoming invitations...");
  await go(
    page,
    "https://www.linkedin.com/mynetwork/invitation-manager/received/",
  );
  let accepted = 0;
  const seen = new Set();
  for (const section of ["Focused", "Other"]) {
    const button = page
      .getByRole("button", { name: new RegExp(`^${section}(?:\\s|$)`, "i") })
      .first();
    const roleTab = page
      .getByRole("tab", { name: new RegExp(`^${section}(?:\\s|$)`, "i") })
      .first();
    const tab = (await button.isVisible().catch(() => false))
      ? button
      : roleTab;
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
    for (
      let attempts = 0;
      attempts < maxAccept && accepted < maxAccept;
      attempts++
    ) {
      const cards = page.locator(
        ".invitation-card, .invitations-card, [data-test-incoming-invitation-card]",
      );

      const cardButtons = cards.getByRole("button", {
        name: /^Accept(?:\s|$)/i,
      });

      const allButtons = page.getByRole("button", {
        name: /^Accept .+ invitation$/i,
      });

      const buttons =
        (await cardButtons.count()) > 0 ? cardButtons : allButtons;

      log(
        `[${section}] Found ${await cards.count()} invitation cards and ${await buttons.count()} Accept buttons`,
      );
      const n = await buttons.count();
      let target = null;
      for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        const label =
          (await b.getAttribute("aria-label").catch(() => null)) ||
          (await b.innerText().catch(() => ""));
        if (!seen.has(label) && (await b.isVisible().catch(() => false))) {
          seen.add(label);
          target = b;
          break;
        }
      }
      if (!target) break;
      if (dryRun) {
        log(
          "[DRY RUN] Would accept invitation:",
          await target.getAttribute("aria-label").catch(() => "visible button"),
        );
        continue;
      }
      await target.click();
      const confirm = page
        .getByRole("button", { name: /accept invite/i })
        .first();
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      accepted++;
      log("Accepted incoming invitation", accepted);
      await page.waitForTimeout(700);
    }
  }
  log(
    dryRun
      ? "Invitation review finished (no changes)"
      : `Invitations accepted this cycle: ${accepted}`,
  );
}

async function selectUnreadFilter(page) {
  const direct = page.getByRole("button", { name: /^unread(?:\s*\(?\d+\)?)?$/i }).first();
  if (await direct.isVisible().catch(() => false)) {
    if (await direct.getAttribute('aria-pressed') !== 'true') await direct.click();
    return true;
  }
  const tab = page.getByRole('tab', { name: /^unread(?:\s|$)/i }).first();
  if (await tab.isVisible().catch(() => false)) {
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
    return true;
  }
  const allUnread = page.getByText("Unread", { exact: true }).first();
  if (await allUnread.isVisible().catch(() => false)) {
    await allUnread.click();
    return true;
  }
  const filter = page.getByRole("button", { name: /filter/i }).first();
  if (await filter.isVisible().catch(() => false)) {
    await filter.click();
    const unread = page.getByText("Unread", { exact: true }).first();
    if (await unread.isVisible().catch(() => false)) {
      await unread.click();
      return true;
    }
  }
  return false;
}
export async function replyToConversation(page, state, options = {}) {
  const reviewOnly = options.dryRun ?? dryRun;
  const persist = options.saveState ?? saveState;
  const owner = options.myName ?? myName;
  // Let short message bursts settle before copying the conversation.
  await page.waitForTimeout(options.settleMs ?? 1200);
  const conversation = await readConversation(page, owner);
  if (!conversation) {
    log("No reliable message/sender detected; skipping safely");
    return;
  }
  const { last, incoming } = conversation;
  if (last.own || isNameMatch(last.sender)) {
    log("Latest message is ours; skipping");
    return true;
  }
  const convo = page.url();
  if (!convo.includes("/messaging/")) {
    log("Unexpected conversation URL; skipping");
    return;
  }
  const fingerprint = conversationFingerprint(conversation);
  const hash = `${new URL(convo).pathname}|${fingerprint}`;
  if (state.replied[hash]) {
    log(state.replied[hash]?.status === 'uncertain' ? 'Previous send is uncertain; inspect this conversation manually.' : 'Already processed this incoming batch');
    return true;
  }
  const composer = await findComposer(page);
  if (!composer) {
    log("No safe composer found. Did not send.");
    return;
  }
  if ((await composer.innerText()).trim()) {
    log("Existing draft detected; leaving it untouched");
    return;
  }
  const sendButton = await findSendButton(composer);
  if (!sendButton || !(await sendButton.isVisible().catch(() => false))) {
    log("No safe, conversation-scoped Send button. Did not send.");
    return;
  }
  log(`Generating one reply for ${incoming.length} incoming messages (${incoming.reduce((n, message) => n + message.message.length, 0)} characters)`);
  const reply = await (options.generateReply ?? generateReply)(conversation);
  log('Generated reply:', reply);
  if (reviewOnly) return;
  // Check again immediately before composing in case a newer message arrived.
  const unchanged = async () => {
    const current = await readConversation(page, owner);
    return current && !current.last.own && conversationFingerprint(current) === fingerprint;
  };
  if (!(await unchanged()) || (await composer.innerText()).trim()) {
    log('Conversation or draft changed during generation; keeping it queued.');
    return;
  }
  await composer.fill(reply);
  const waitEnabled = async () => {
    const until = Date.now() + 4000;
    while (!(await sendButton.isEnabled()) && Date.now() < until) await page.waitForTimeout(150);
    return sendButton.isEnabled();
  };
  if (!(await waitEnabled())) {
    await composer.fill('');
    await composer.focus();
    await page.keyboard.insertText(reply);
  }
  if (!(await waitEnabled()) || !(await unchanged())) {
    if ((await composer.innerText()).trim() === reply.trim()) await composer.fill('');
    log('Send is disabled or new messages arrived; keeping the conversation queued.');
    return;
  }
  // Persist before clicking: an uncertain send must never be retried automatically.
  state.replied[hash] = { status: 'uncertain', reply, at: new Date().toISOString() };
  persist(state);
  await sendButton.click({ timeout: 10000 });
  const until = Date.now() + (options.deliveryTimeoutMs ?? 10000);
  let confirmed = false;
  while (Date.now() < until) {
    const after = await readConversation(page, owner);
    const normalize = (text) => text.replace(/\s+/gu, ' ').trim();
    confirmed = Boolean(after?.messages.some((message) => message.own && normalize(message.message) === normalize(reply) && (
      message === after.last || (message.id && !conversation.messages.some((before) => before.id === message.id))
    )));
    if (confirmed) break;
    await page.waitForTimeout(250);
  }
  if (!confirmed) throw Error('Send was clicked but the outgoing message did not appear. Inspect LinkedIn; this send will not be retried automatically.');
  state.replied[hash] = { status: 'sent', at: new Date().toISOString() };
  persist(state);
  log('Reply confirmed in the conversation');
  return true;
}
async function answerIncoming(page, state) {
  const onlyUnread = process.env.ONLY_UNREAD === 'true';
  log(onlyUnread ? 'Checking unread messages...' : 'Checking recent conversations for unanswered incoming messages...');
  await go(page, "https://www.linkedin.com/messaging/");
  const selected = onlyUnread ? await selectUnreadFilter(page) : false;
  if (!onlyUnread) {
    const unread = page.getByRole('button', { name: /^unread(?:\s*\(?\d+\)?)?$/i }).first();
    if (await unread.isVisible().catch(() => false) && await unread.getAttribute('aria-pressed') === 'true') await unread.click();
  }
  if (onlyUnread && !selected) {
    log(
      "Unread filter unavailable; checking explicit unread badges and previously queued messages.",
    );
  }
  await page.waitForTimeout(1000);
  const urls = await discoverConversationUrls(page, {
    unreadOnly: onlyUnread && !selected,
    onDiscover: async (url) => {
      if (!dryRun && !state.pending.includes(url)) {
        state.pending.push(url);
        saveState(state);
      }
    },
  });
  const queue = [...new Set([...state.pending, ...urls])];
  log(`Found ${urls.length} candidate conversations; ${state.pending.length} pending`);
  if (!dryRun) {
    state.pending = queue;
    saveState(state);
  }
  for (const url of queue.slice(0, maxReplies)) {
    try {
      await go(page, url);
      await page.locator('main .msg-s-event-listitem, main .msg-s-event-listitem__body, [role="main"] .msg-s-event-listitem, [role="main"] .msg-s-event-listitem__body').last().waitFor({ state: 'visible', timeout: 15000 });
      const handled = await replyToConversation(page, state);
      if (!dryRun && handled) {
        state.pending = state.pending.filter((pending) => pending !== url);
        saveState(state);
      } else if (!dryRun) {
        state.pending = [...state.pending.filter((pending) => pending !== url), url];
        saveState(state);
      }
    } catch (e) {
      if (/LinkedIn login\/checkpoint/i.test(e.message)) throw e;
      log("Conversation failed safely:", e.message);
      if (!dryRun) {
        state.pending = [...state.pending.filter((pending) => pending !== url), url];
        saveState(state);
      }
    }
  }
  log('Finished checking conversations');
}
async function main() {
  if (!loginOnly && !diagnoseOnly && process.env.REPLY_PROVIDER === 'gemini' && !process.env.GEMINI_API_KEY?.trim()) {
    throw Error('Set GEMINI_API_KEY in .env, then run npm run test:gemini.');
  }
  if (!loginOnly && !myName)
    throw Error(
      "Set MY_NAME to your exact LinkedIn profile display name in .env",
    );
  log('Starting in', loginOnly ? 'LOGIN ONLY (no sending)' : dryRun ? 'DRY RUN (no sending)' : 'LIVE MODE');
  log('Reply provider:', process.env.REPLY_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'local'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: diagnoseOnly,
    viewport: { width: 1320, height: 850 },
    args: ["--disable-notifications"],
  }).catch((error) => {
    if (/Opening in existing browser session|profile.*in use|ProcessSingleton/i.test(error.message)) {
      throw Error('The bot browser profile is already open. Stop the old bot and close its Chromium window, then run this command again.');
    }
    throw error;
  });
  const page = context.pages()[0] || (await context.newPage());
  let stopped = false;
  process.once("SIGINT", () => {
    stopped = true;
    log("Stop requested.");
    void context.close().catch(() => {});
  });
  try {
    if (diagnoseOnly) {
      await go(page, 'https://www.linkedin.com/messaging/');
      log('Diagnosis: LinkedIn inbox loaded');
      for (const selector of ['main', '[role="main"]', '.msg-conversation-listitem', 'a[href*="/messaging/thread/"]', '.msg-s-message-list-content', '.msg-s-event-listitem__body', '[contenteditable="true"]']) {
        log('Selector count:', selector, await page.locator(selector).count());
      }
      log('Unread filter detected:', await page.getByText('Unread', { exact: true }).count());
      if (process.argv.includes('--verbose')) log('Conversation row structure:', JSON.stringify(await page.locator('.msg-conversation-listitem').evaluateAll((rows) => rows.slice(0, 2).map((row) => ({
        tag: row.tagName, className: row.className, attributes: [...row.attributes].map((attribute) => attribute.name),
        children: [...row.querySelectorAll('[role], [tabindex], [data-conversation-id], [data-id], a, h3')].slice(0, 12).map((child) => ({ tag: child.tagName, className: child.className, role: child.getAttribute('role'), attributes: [...child.attributes].map((attribute) => attribute.name) })),
      })))));
      log('Discovered conversation count:', (await discoverConversationUrls(page)).length);
      const conversation = await readConversation(page, myName);
      const composer = await findComposer(page);
      log('Conversation detection:', { loadedMessages: conversation?.messages.length || 0, unansweredMessages: conversation?.incoming.length || 0, latestIsOurs: conversation?.last.own, composerFound: Boolean(composer), sendButtonFound: composer ? Boolean(await findSendButton(composer)) : false });
      if (process.argv.includes('--verbose')) log('Latest message structure:', JSON.stringify(await page.locator('main .msg-s-event-listitem__body').last().evaluate((body) => {
        const ancestors = [];
        for (let element = body; element && ancestors.length < 5; element = element.parentElement) ancestors.push({ tag: element.tagName, className: element.className, senderLabels: element.querySelectorAll('.msg-s-message-group__name, .msg-s-event-listitem__name').length });
        return ancestors;
      }).catch(() => [])));
      log('Diagnosis finished; no invitations accepted, replies generated, or messages sent.');
      return;
    }
    if (loginOnly) {
      await go(page, 'https://www.linkedin.com/messaging/');
      log('LinkedIn sign-in verified and saved. You can now run npm start.');
      return;
    }
    const state = loadState();
    while (!stopped) {
      try {
        await answerIncoming(page, state);
        try {
          if (!process.argv.includes('--messages-only')) await acceptIncoming(page);
        } catch (e) {
          if (/LinkedIn login\/checkpoint/i.test(e.message)) throw e;
          log("Invitation check failed; continuing to messages:", e.message);
        }
      } catch (e) {
        log("Cycle stopped:", e.message);
        if (
          /LinkedIn login\/checkpoint/i.test(
            e.message,
          )
        )
          break;
      }
      if (once) break;
      if (!stopped) await sleep(pollMs);
    }
  } finally {
    await context.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
