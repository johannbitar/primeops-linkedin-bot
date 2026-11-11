export function makeReply(input) {
  const text = (input || '').trim();
  const s = text.toLowerCase();
  if (/\b(not interested|no thanks|stop messaging|do not contact|don.t contact|unsubscribe)\b/i.test(s)) {
    return 'Understood. Thank you for letting me know.';
  }
  if (!text || /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\p{Punctuation}]+$/u.test(text)) {
    return 'Hey, thanks for reaching out! What did you have in mind?';
  }
  if (/\b(urgent|asap|immediately|emergency)\b/i.test(s)) {
    return 'Thanks for the heads-up. Could you share the key details so I can understand what you need?';
  }
  if (/\b(job|role|position|hiring|recruiter|interview|opportunity)\b/i.test(s)) {
    return 'Thanks for reaching out! Could you share the role, location, and main requirements?';
  }
  if (/\b(meeting|call|schedule|availability|free tomorrow|zoom)\b/i.test(s)) {
    return 'Happy to discuss. What time and time zone did you have in mind?';
  }
  if (/\b(price|pricing|cost|budget|quote|rate)\b/i.test(s)) {
    return 'Thanks for asking! Could you tell me a little more about what you need so I can give you a useful answer?';
  }
  if (/\b(projects?|collaborat\w*|partnerships?|work together)\b/i.test(s)) {
    return 'That sounds interesting. Could you share a few details about the project and what you have in mind?';
  }
  if (/\b(portfolio|previous work|work samples|case stud(?:y|ies)|github)\b/i.test(s)) {
    return 'What kind of work would you like to see? That will help me identify the most relevant examples.';
  }
  if (/\b(resume|cv|curriculum vitae)\b/i.test(s)) {
    return 'Thanks for asking. What role is this for, and which experience or skills are you looking for?';
  }
  if (/\b(services?|what do you do|what can you do|help my business)\b/i.test(s)) {
    return 'What are you looking to achieve? Share your needs and I can understand which services would be relevant.';
  }
  if (/\b(website|web app|mobile app|automation|chatbot|software|development)\b/i.test(s)) {
    return 'Could you share what you want to build, the main features, and your target timeline?';
  }
  if (/\b(support|not working|broken|error|bug|issue|problem)\b/i.test(s)) {
    return 'Could you describe what happened, what you expected, and any error message? Please leave out passwords and private account details.';
  }
  if (/\b(follow(?:ing)?[ -]?up|checking in|any updates?|heard back)\b/i.test(s)) {
    return 'Thanks for following up. Could you remind me which topic you are checking on?';
  }
  if (/\b(deadline|timeline|how long|delivery|turnaround)\b/i.test(s)) {
    return 'What needs to be delivered, and what date are you aiming for? The scope will help determine a realistic timeline.';
  }
  if (/\b(email|phone number|whatsapp|contact details)\b/i.test(s)) {
    return 'You can share the details here on LinkedIn. What would you like to discuss?';
  }
  if (/\b(where are you|based in|your location)\b/i.test(s)) {
    return 'Is there a location or time-zone requirement for what you have in mind?';
  }
  if (/\b(bye|goodbye|take care|talk soon)\b/i.test(s)) {
    return 'Take care! Thanks for getting in touch.';
  }
  if (/\b(thank you|thanks|appreciate it)\b/i.test(s) && text.length < 140) {
    return 'You’re very welcome! Happy to help.';
  }
  if (/\b(hola|buenos|gracias)\b/i.test(s)) {
    return '¡Hola! Gracias por escribir. ¿En qué puedo ayudarte?';
  }
  if (/[\u0600-\u06FF]/u.test(text)) {
    if (/سعر|تكلفة|ميزاني|بكم/.test(text)) return 'أكيد، ممكن تخبرني أكتر عن المطلوب والميزانية التقريبية؟';
    if (/اجتماع|مكالمة|موعد/.test(text)) return 'أي وقت بناسبك، وبأي منطقة زمنية؟';
    if (/وظيف|توظيف|فرصة عمل/.test(text)) return 'شكراً لتواصلك! ممكن تبعت تفاصيل الوظيفة ومكان العمل والمتطلبات؟';
    return 'أهلاً! شكراً على رسالتك. كيف فيني ساعدك؟';
  }
  if (/\b(bonjour|salut|merci)\b/i.test(s)) {
    return 'Bonjour ! Merci pour votre message. Comment puis-je vous aider ?';
  }
  if (/\b(how are you|how.s it going)\b/i.test(s) && text.length < 90) {
    return 'Thanks for checking in! How can I help you today?';
  }
  if (/\b(hello|hi|hey|good morning|good evening)\b/i.test(s) && text.length < 90) {
    return 'Hey! Great to hear from you. How can I help?';
  }
  if (text.length > 700) {
    return 'Thanks for the detailed message! What would you like me to focus on first?';
  }
  if (text.includes('?')) {
    return 'Good question. Could you share a bit more context so I can answer accurately?';
  }
  return 'Thanks for reaching out! Could you tell me a little more about what you have in mind?';
}
