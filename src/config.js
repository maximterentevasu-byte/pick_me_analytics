import 'dotenv/config';

function firstNonEmpty(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value != null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
}

function required(...names) {
  const value = firstNonEmpty(...names);
  if (value == null) {
    throw new Error(`Missing required env var. Set one of: ${names.join(', ')}`);
  }
  return value;
}

function optional(fallback, ...names) {
  const value = firstNonEmpty(...names);
  return value == null ? fallback : value;
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
  timezone: optional('Europe/Zurich', 'TIMEZONE'),
  channels: parseChannels(required('CHANNELS', 'CHANNEL_USERNAME')),
  cron: optional('5 0 * * 1', 'CRON_SCHEDULE'),
  runOnce: parseBool(optional('', 'RUN_ONCE'), false),
  dryRun: parseBool(optional('', 'DRY_RUN'), false),
  appendHeadersIfEmpty: parseBool(optional('true', 'APPEND_HEADERS_IF_EMPTY'), true),
  google: {
    sheetId: required('GOOGLE_SHEET_ID'),
    tabName: optional('Metrics', 'GOOGLE_SHEET_TAB'),
    clientEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    privateKey: required('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n')
  },
  telegram: {
    apiId: Number(required('TELEGRAM_API_ID', 'TG_API_ID')),
    apiHash: required('TELEGRAM_API_HASH', 'TG_API_HASH'),
    stringSession: optional('', 'TELEGRAM_STRING_SESSION', 'TG_STRING_SESSION'),
    phone: optional('', 'TELEGRAM_PHONE', 'TG_PHONE')
  }
};
