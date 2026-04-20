import cron from 'node-cron';
import { config } from './config.js';
import { collectWeeklyMetrics, SHEET_HEADERS } from './metrics.js';
import { ensureHeaders, appendRows } from './sheets.js';
import { createTelegramClient, resolveChannel } from './telegram.js';
import { getLastCompletedWeekRange, serializeError } from './utils.js';

async function runCollector() {
  const { start, end } = getLastCompletedWeekRange(config.timezone);
  const client = await createTelegramClient();

  try {
    const rows = [];

    for (const channelRef of config.channels) {
      const channelInfo = await resolveChannel(client, channelRef);
      const result = await collectWeeklyMetrics(client, channelInfo, start, end);
      rows.push(result.row);
      console.log(JSON.stringify({ level: 'info', message: 'channel processed', debug: result.debug }));
    }

    if (config.dryRun) {
      console.log(JSON.stringify({ level: 'info', message: 'dry run rows', rows }, null, 2));
      return;
    }

    if (config.appendHeadersIfEmpty) {
      await ensureHeaders(SHEET_HEADERS);
    }

    if (rows.length) {
      await appendRows(rows);
      console.log(JSON.stringify({ level: 'info', message: 'rows appended', count: rows.length }));
    }
  } finally {
    await client.disconnect();
  }
}

async function main() {
  if (config.runOnce) {
    await runCollector();
    return;
  }

  cron.schedule(config.cron, async () => {
    try {
      await runCollector();
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'collector failed', error: serializeError(error) }));
    }
  }, {
    timezone: config.timezone
  });

  console.log(JSON.stringify({
    level: 'info',
    message: 'scheduler started',
    cron: config.cron,
    timezone: config.timezone,
    channels: config.channels
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ level: 'fatal', message: 'startup failed', error: serializeError(error) }));
  process.exit(1);
});
