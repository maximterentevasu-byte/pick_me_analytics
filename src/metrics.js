import {
  clamp,
  divide,
  formatDate,
  normalizeTo100,
  percent,
  round,
  sum
} from './utils.js';
import {
  fetchChannelPostsForPeriod,
  fetchStoriesForPeriod,
  getBroadcastStats,
  getMessageCommentCount,
  getMessageForwardCount,
  getMessageReactionCount,
  getMessageViewCount,
  getStoryStats
} from './telegram.js';

function getStoryReactionCount(storyStats) {
  const results = storyStats?.reactionsByEmotionGraph?.json?.data?.data || [];
  return Array.isArray(results)
    ? results.reduce((acc, item) => acc + (Array.isArray(item) ? Number(item[1] || 0) : 0), 0)
    : 0;
}

function qualityIndex({ erViewsPct, erActivitiesPct, reactionsPer1000Views, repostsPer1000Views, commentsPer1000Views, viralityPct }) {
  const score = (
    normalizeTo100(erViewsPct, 60) * 0.25 +
    normalizeTo100(erActivitiesPct, 25) * 0.2 +
    normalizeTo100(reactionsPer1000Views, 150) * 0.15 +
    normalizeTo100(repostsPer1000Views, 60) * 0.15 +
    normalizeTo100(commentsPer1000Views, 40) * 0.1 +
    normalizeTo100(viralityPct, 20) * 0.15
  );
  return round(clamp(score, 0, 100), 2);
}

export const SHEET_HEADERS = [
  'Дата начала недели',
  'Дата конца недели',
  'Канал',
  'Подписчики (на конец периода)',
  'Средний просмотр поста',
  'ER (по просмотрам) %',
  'ER (по активностям) %',
  'Ср. кол-во реакций',
  'Ср. кол-во комментариев',
  'Ср. кол-во репостов',
  'Кол-во постов',
  'Средний просмотр сторис',
  'ER сторис (по просмотрам) %',
  'Кол-во сторис',
  'Среднее кол-во реакций на сторис',
  'Среднее кол-во репостов сторис',
  'Доля пользователей с включёнными уведомлениями %',
  'Сумма просмотров постов',
  'Сумма реакций',
  'Сумма комментариев',
  'Сумма репостов',
  'Engagement на пост',
  'Реакции на 1000 просмотров',
  'Репосты на 1000 просмотров',
  'Комментариев на 1000 просмотров',
  'Виральность постов %',
  'Индекс качества контента'
];

export async function collectWeeklyMetrics(client, channelInfo, start, end) {
  const posts = await fetchChannelPostsForPeriod(client, channelInfo, start, end);
  const stats = await getBroadcastStats(client, channelInfo);

  const postViews = sum(posts.map(getMessageViewCount));
  const postReactions = sum(posts.map(getMessageReactionCount));
  const postComments = sum(posts.map(getMessageCommentCount));
  const postForwards = sum(posts.map(getMessageForwardCount));
  const postsCount = posts.length;
  const totalActivities = postReactions + postComments + postForwards;
  const subscribersEnd = channelInfo.followers || 0;

  const avgPostViews = round(divide(postViews, postsCount));
  const erViewsPct = percent(avgPostViews, subscribersEnd);
  const erActivitiesPct = percent(totalActivities, postViews);
  const avgReactions = round(divide(postReactions, postsCount));
  const avgComments = round(divide(postComments, postsCount));
  const avgForwards = round(divide(postForwards, postsCount));
  const engagementPerPost = round(divide(totalActivities, postsCount));
  const reactionsPer1000Views = round(divide(postReactions, postViews) * 1000);
  const repostsPer1000Views = round(divide(postForwards, postViews) * 1000);
  const commentsPer1000Views = round(divide(postComments, postViews) * 1000);
  const viralityPct = percent(postForwards, postViews);

  const stories = await fetchStoriesForPeriod(client, channelInfo, start, end).catch(() => []);
  const storyStatsList = [];
  for (const story of stories) {
    try {
      const stat = await getStoryStats(client, channelInfo, story.id);
      storyStatsList.push({ story, stat });
    } catch {
      storyStatsList.push({ story, stat: null });
    }
  }

  const storyCount = stories.length;
  const totalStoryViews = sum(storyStatsList.map(({ stat, story }) => stat?.viewsGraph?.json?.data?.overview?.[0]?.value ?? story?.views?.views_count ?? 0));
  const totalStoryReactions = sum(storyStatsList.map(({ stat }) => stat?.reactionsCount?.current ?? getStoryReactionCount(stat)));
  const totalStoryForwards = sum(storyStatsList.map(({ stat }) => stat?.forwardsCount?.current ?? 0));
  const avgStoryViews = round(divide(totalStoryViews, storyCount));
  const erStoriesViewsPct = percent(avgStoryViews, subscribersEnd);
  const avgStoryReactions = round(divide(totalStoryReactions, storyCount));
  const avgStoryForwards = round(divide(totalStoryForwards, storyCount));

  const enabledNotificationsPct = round(stats?.enabledNotifications?.part ? stats.enabledNotifications.part * 100 : 0, 2);
  const contentQualityIndex = qualityIndex({
    erViewsPct,
    erActivitiesPct,
    reactionsPer1000Views,
    repostsPer1000Views,
    commentsPer1000Views,
    viralityPct
  });

  return {
    row: [
      formatDate(start),
      formatDate(end),
      channelInfo.title,
      subscribersEnd,
      avgPostViews,
      erViewsPct,
      erActivitiesPct,
      avgReactions,
      avgComments,
      avgForwards,
      postsCount,
      avgStoryViews,
      erStoriesViewsPct,
      storyCount,
      avgStoryReactions,
      avgStoryForwards,
      enabledNotificationsPct,
      postViews,
      postReactions,
      postComments,
      postForwards,
      engagementPerPost,
      reactionsPer1000Views,
      repostsPer1000Views,
      commentsPer1000Views,
      viralityPct,
      contentQualityIndex
    ],
    debug: {
      channel: channelInfo.title,
      postsCount,
      storyCount,
      postViews,
      postReactions,
      postComments,
      postForwards,
      totalStoryViews,
      totalStoryReactions,
      totalStoryForwards,
      enabledNotificationsPct
    }
  };
}
