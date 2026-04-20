import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).toLowerCase());
}

function parseChannels(raw) {
  return String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export const config = {
  timezone: process.env.TIMEZONE || 'Europe/Zurich',
  channels: parseChannels(required('CHANNELS')),
  cron: process.env.CRON_SCHEDULE || '5 0 * * 1',
  runOnce: parseBool(process.env.RUN_ONCE, false),
  dryRun: parseBool(process.env.DRY_RUN, false),
  appendHeadersIfEmpty: parseBool(process.env.APPEND_HEADERS_IF_EMPTY, true),
  google: {
    sheetId: required('GOOGLE_SHEET_ID'),
    tabName: process.env.GOOGLE_SHEET_TAB || 'Metrics',
    clientEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    privateKey: required('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n')
  },
  telegram: {
    apiId: Number(required('TELEGRAM_API_ID')),
    apiHash: required('TELEGRAM_API_HASH'),
    stringSession: process.env.TELEGRAM_STRING_SESSION || '',
    phone: process.env.TELEGRAM_PHONE || ''
  }
};
