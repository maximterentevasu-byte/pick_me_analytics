import 'dotenv/config';
import input from 'input';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
  throw new Error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH in your environment before running npm run session');
}

const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
  connectionRetries: 5
});

await client.start({
  phoneNumber: async () => input.text('Phone number: '),
  password: async () => input.text('2FA password (if any): '),
  phoneCode: async () => input.text('Code from Telegram: '),
  onError: (err) => console.error(err)
});

console.log('\nSave this TELEGRAM_STRING_SESSION in Railway:\n');
console.log(client.session.save());

await client.disconnect();
