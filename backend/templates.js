// Message templates — each gym can override the built-in message texts from
// its Settings tab. Placeholders like {{member}} are filled in at send time.
const APP_URL = process.env.APP_URL || '';

const DEFAULT_SETTINGS_TEMPLATES = {
  welcome: {
    subject: 'Welcome to {{gym}}',
    body:
      'Hi {{member}},\n\n' +
      'Your account is ready at {{gym}}!\n' +
      'Website: {{website}}\n' +
      'Login email: {{email}}\n\n' +
      'Use "Forgot Password" on the login page to set your password.',
  },
  payment_received: {
    subject: 'Payment received — {{gym}}',
    body:
      'Hi {{member}},\n\n' +
      'Payment received: {{amount}} ({{method}}).\n' +
      'Membership valid till: {{expiry}}.\n' +
      'Keep going strong!',
  },
  payment_online: {
    subject: 'Payment confirmation — {{gym}}',
    body:
      'Hi {{member}},\n\n' +
      'Payment received — {{amount}} ({{plan}}).\n' +
      'Welcome to {{gym}}!\n\n' +
      'Website: {{website}}\n' +
      'See you at the gym 💪',
  },
  inquiry: {
    subject: 'New membership inquiry — {{member}}',
    body:
      'New membership inquiry received on the website:\n\n' +
      'Name:  {{member}}\n' +
      'Email: {{email}}\n' +
      'Phone: {{phone}}\n' +
      'PIN code: {{pin}}',
  },
};

// Builds a message for a gym: the gym's stored template wins when it has text,
// otherwise the built-in default is used. `vars` fill the {{placeholders}};
// {{gym}} and {{website}} are always available.
function buildMsg(gym, key, vars, fallback) {
  const t = (gym && gym.settings && gym.settings.templates && gym.settings.templates[key]) || {};
  const subject = typeof t.subject === 'string' && t.subject.trim() ? t.subject : fallback.subject;
  const body = typeof t.body === 'string' && t.body.trim() ? t.body : fallback.body;
  const vals = { gym: gym ? gym.name : '', website: APP_URL, ...vars };
  const fill = (s) => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => (vals[k] != null ? String(vals[k]) : ''));
  return { subject: fill(subject), body: fill(body) };
}

module.exports = { DEFAULT_SETTINGS_TEMPLATES, buildMsg };