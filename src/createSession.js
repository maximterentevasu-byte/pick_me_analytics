require("dotenv").config();

const input = require("input");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

async function main() {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;

  if (!apiId || !apiHash) {
    throw new Error("Не заданы TG_API_ID / TG_API_HASH");
  }

  const stringSession = new StringSession("");

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => process.env.TG_PHONE || await input.text("Phone: "),
    password: async () => await input.text("2FA password (если есть): "),
    phoneCode: async () => await input.text("Code from Telegram: "),
    onError: (err) => console.error(err),
  });

  console.log("\n=== TG_STRING_SESSION ===\n");
  console.log(client.session.save());
  console.log("\nСкопируй это значение в .env\n");

  await client.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
