# Inbound-only LinkedIn assistant (developer test)

Local Node.js / Playwright application. Watches received connection invitations and recent conversations on a signed-in LinkedIn account. Replies only when the latest messages are incoming; it never starts a new conversation or sends a connection request. No credentials, cookies, or contact contents are committed to the repository.

## Gemini replies

1. Create your own API key in [Google AI Studio](https://aistudio.google.com/api-keys).
2. Add `GEMINI_API_KEY=your_actual_key` and `REPLY_PROVIDER=gemini` to your local `.env`. Never commit your key or put it in source code.
3. Set `GEMINI_MODEL=gemini-3.1-flash-lite`, or a text model available to your key. Optional `BOT_CONTEXT` supplies verified facts about your work, services, and links; keep it on one line.
4. Run `npm run test:gemini` to test the connection, or `npm run test:gemini -- --multilingual` for synthetic French, long Arabic, and Chinese message batches without accessing LinkedIn.
5. Run `npm run login` and finish sign-in/security checks manually in the bot browser. The command verifies and saves sign-in automatically. Run `npm run diagnose` to check the saved session, conversation discovery, message reading, composer, and Send button without generating or sending replies.
6. Run `npm run dry-run` to preview replies, then `npm start` with `DRY_RUN=false` to send.

Gemini receives all text messages currently loaded in the selected conversation (both sides), with every incoming message since your last reply identified as unanswered, plus your `BOT_CONTEXT`. This also applies during dry-run. Sender labels and cookies are not sent. The model is instructed to answer all points together in the contact's language, including mixed-language messages and explicit language requests. Long messages are preserved: input above 500,000 characters is rejected explicitly instead of truncated. Older history not loaded by LinkedIn and attachments are not included. Replies are limited to 3,000 characters and requests time out after 60 seconds. API usage follows your Google project's quota/billing settings. API errors leave the conversation queued. Set `REPLY_PROVIDER=local` for offline templates. API calls follow Google's [generateContent reference](https://ai.google.dev/api/generate-content).

## Setup (Windows / macOS / Linux)

1. Install Node.js 20+ and a modern browser.
2. `npm install`
3. `npx playwright install chromium`
4. Copy `.env.example` to `.env`. Set `MY_NAME` to your exact LinkedIn display name.
5. `npm run login` — sign in yourself in the launched browser. The command verifies sign-in automatically. Session is saved locally in ignored `.browser-profile/`.
6. `npm test` — tests the short-answer engine.
7. `npm run dry-run` — inspects incoming requests and unread conversations, printing what it *would* do. It does not accept/send.
8. Set `DRY_RUN=false` in `.env`, then `npm start` to enable actions. Leave the laptop and Chromium window running; Ctrl+C stops it.

**Important:** Unauthorised LinkedIn automation may violate LinkedIn's terms and cause account restrictions. Only test with an account you own, preferably separate from your personal profile. Do not try to defeat security challenges.

## How it works

- Opens LinkedIn's `.../mynetwork/invitation-manager/received/` and inspects Focused/Other invitations (incoming only).
- Looks for visible Accept buttons on invitation cards; clicks them in live mode, and handles an occasional explicit confirmation.
- Checks messaging before invitations. Discovers linked conversations and clickable DIV rows, and saves each discovered URL immediately. By default it inspects up to 30 loaded recent rows, including read conversations, so opening a thread does not prevent a reply. Set `ONLY_UNREAD=true` to limit discovery to unread conversations.
- Copies loaded conversation history, groups incoming messages after the last owner reply, and generates one response to the batch. Waits briefly for message bursts and checks the entire batch again after generation and before sending. New arrivals cause regeneration on a later cycle. Floating chats are excluded.
- Refuses to reply when sender identity is missing, when the latest message is from `MY_NAME`, when the message was already handled, or when a conversation-scoped Send button cannot be identified.
- Generates replies with Gemini when configured, or short local templates in local mode. Templates cover greetings, jobs, scheduling, costs, collaboration, portfolios, CV requests, services, development enquiries, support, follow-ups, deadlines, contact requests, farewells, French, Spanish, Arabic, and unknown questions. Specific questions take precedence over greetings.
- Polls every `POLL_SECONDS`, caps work per cycle, and stores queued conversations and send-attempt fingerprints in ignored `data/processed.json` to minimize duplicates. Invitation errors do not prevent the message check.
- Preserves existing drafts and waits for the scoped Send button to become enabled after typing.

## Tests and limitations

- `npm test` checks reply selection and uses local Chromium fixtures to verify message reading, composer selection, sending, draft preservation, and duplicate prevention. Browser tests require `npx playwright install chromium`.
- Browser selectors depend on LinkedIn's current English-language UI. They may need adjustments in DevTools when LinkedIn updates its interface.
- Files and media attachments are detected, including messages with no accompanying text. The bot replies that it cannot open files and can only read text, and asks the sender to paste the contents. Gemini uses the sender's language and can also answer accompanying text. Files are never opened, downloaded, or uploaded to Gemini; only an unreadable-attachment marker is included. Local template mode uses an English notice. Attachment detection depends on LinkedIn's DOM selectors.
- `MY_NAME` must exactly match the latest message sender label for the bot to identify its own messages.
- A send-attempt marker is saved before clicking Send. Success is recorded only when the outgoing reply appears in the conversation. This confirms the visible conversation, not recipient delivery/read status. Uncertain sends are not retried automatically.
- If LinkedIn requires sign-in/security confirmation during normal operation, the browser stays open and the bot waits for you to complete it manually, then resumes. No CAPTCHA bypass, cookie extraction, hidden API calls, or evasion is provided.
- The application runs only while this process and the Chromium browser remain open, not on a remote server.

## Notes for reviewer

Public repo contains code only. `.env`, `.browser-profile`, local state, and logs are ignored.

**Assessment-specific limitation:** This is a best-effort browser integration; it must be verified on the actual test account and adjusted if the 2026 UI differs from the selectors above.

## If replies are missing

Stop any older bot process and close its Chromium window before restarting with `npm start`. Use `npm run diagnose` to check the saved login session and conversation controls. Run `npm run dry-run -- --once --messages-only` for a single reply preview. Run `npm start -- --once --messages-only` for a single live message check without invitation actions, or `npm start -- --messages-only` to keep watching messages. The terminal explains skipped replies. The latest message must come from a contact, not your account. Keep `MY_NAME` equal to your profile display name. Leave `ONLY_UNREAD=false` to include missed messages that were already read.
