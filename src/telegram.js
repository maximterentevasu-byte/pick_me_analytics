import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { DateTime } from 'luxon';
import { config } from './config.js';
import { safeNumber, toUnix } from './utils.js';

export async function createTelegramClient() {
  const session = new StringSession(config.telegram.stringSession);
  const client = new TelegramClient(session, config.telegram.apiId, config.telegram.apiHash, {
    connectionRetries: 5,
    useWSS: false
  });

  await client.connect();
  if (!await client.checkAuthorization()) {
    throw new Error('Telegram client is not authorized. Generate TELEGRAM_STRING_SESSION locally using npm run session.');
  }

  return client;
}

export async function resolveChannel(client, channelRef) {
  const entity = await client.getEntity(channelRef);
  const full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));

  return {
    entity,
    full,
    title: entity.title || entity.username || channelRef,
    channelId: entity.id,
    statsDc: full.fullChat?.statsDc,
    linkedChatId: full.fullChat?.linkedChatId || null,
    followers: full.fullChat?.participantsCount || 0,
    canViewStats: Boolean(full.fullChat?.canViewStats)
  };
}

async function withStatsDc(client, statsDc, fn) {
  if (!statsDc) {
    return fn(client);
  }

  return client._borrowExportedSender(statsDc, async (sender) => {
    return fn({
      invoke: (request) => client.invoke(request, sender)
    });
  });
}

export async function getBroadcastStats(client, channelInfo) {
  if (!channelInfo.canViewStats) {
    return null;
  }

  return withStatsDc(client, channelInfo.statsDc, async (dcClient) => {
    return dcClient.invoke(new Api.stats.GetBroadcastStats({
      channel: channelInfo.entity,
      dark: false
    }));
  });
}

export async function fetchChannelPostsForPeriod(client, channelInfo, start, end) {
  const messages = [];
  const offsetDate = toUnix(end.plus({ seconds: 1 }));

  for await (const message of client.iterMessages(channelInfo.entity, {
    offsetDate,
    reverse: false
  })) {
    if (!message?.date) continue;

    const messageDate = DateTime.fromJSDate(message.date, { zone: config.timezone });
    if (messageDate < start) break;
    if (messageDate > end) continue;
    if (!message.post) continue;
    if (message.groupedId) {
      // album items inflate post count; keep only first item by groupedId
      const existing = messages.find((m) => m.groupedId && message.groupedId && m.groupedId.toString() === message.groupedId.toString());
      if (existing) continue;
    }

    messages.push(message);
  }

  return messages;
}

export function getMessageReactionCount(message) {
  const results = message?.reactions?.results || [];
  return results.reduce((acc, item) => acc + safeNumber(item.count), 0);
}

export function getMessageCommentCount(message) {
  return safeNumber(message?.replies?.replies);
}

export function getMessageForwardCount(message) {
  return safeNumber(message?.forwards);
}

export function getMessageViewCount(message) {
  return safeNumber(message?.views);
}

export async function fetchStoriesForPeriod(client, channelInfo, start, end) {
  const stories = [];
  let offsetId = 0;
  let keepGoing = true;

  while (keepGoing) {
    const page = await client.invoke(new Api.stories.GetStoriesArchive({
      peer: channelInfo.entity,
      offsetId,
      limit: 100
    }));

    const pageStories = page.stories || [];
    if (!pageStories.length) break;

    for (const story of pageStories) {
      const dateValue = story?.date ? DateTime.fromSeconds(story.date, { zone: config.timezone }) : null;
      if (!dateValue) continue;
      if (dateValue < start) {
        keepGoing = false;
        break;
      }
      if (dateValue > end) continue;
      stories.push(story);
    }

    const last = pageStories[pageStories.length - 1];
    offsetId = last?.id || 0;
    if (!offsetId) break;
  }

  return stories;
}

export async function getStoryStats(client, channelInfo, storyId) {
  if (!channelInfo.canViewStats) return null;

  return withStatsDc(client, channelInfo.statsDc, async (dcClient) => {
    return dcClient.invoke(new Api.stats.GetStoryStats({
      channel: channelInfo.entity,
      id: storyId,
      dark: false
    }));
  });
}
