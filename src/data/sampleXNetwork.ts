import type { XNetwork, XNetworkEdge, XNetworkNode } from '../types';

const sampleHandles = [
  'alicebuilds',
  'brunocodes',
  'cybernat',
  'dappdana',
  'elena_eth',
  'faridframes',
  'giga_gabi',
  'hazelhash',
  'ionresearch',
  'jules_xyz',
  'kai_protocol',
  'leona_labs',
  'mira_mev',
  'noah_nodes',
  'opal_ops',
  'pavelproofs',
  'quinn_quest',
  'rhea_rollups',
  'sami_signals',
  'tess_tokens',
];

const tagGroups = [
  ['role/founder', 'tech/crypto', 'signal/dm'],
  ['role/engineer', 'tech/zk', 'org/startup'],
  ['role/research', 'tech/ai', 'signal/mentions'],
  ['role/investor', 'tech/defi', 'org/fund'],
  ['role/designer', 'tech/consumer', 'signal/replies'],
];

function avatarDataUrl(handle: string, color: string): string {
  const initials = handle
    .split(/[_-]/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${color}"/><circle cx="72" cy="24" r="18" fill="rgba(255,255,255,.22)"/><text x="48" y="56" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="800" fill="white">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function colorForIndex(index: number): string {
  const colors = ['#10c8ee', '#f80c91', '#ff7617', '#7456f5', '#0be9b9', '#f62a68', '#f5ec49'];
  return colors[index % colors.length];
}

const nodes: XNetworkNode[] = Array.from({ length: 260 }, (_, index) => {
  const baseHandle = sampleHandles[index % sampleHandles.length];
  const handle = index < sampleHandles.length ? baseHandle : `${baseHandle}_${String(index + 1).padStart(3, '0')}`;
  const dmTotal = index % 6 === 0 ? 120 - (index % 70) : index % 4 === 0 ? 24 + (index % 33) : index % 11;
  const repliesSent = 6 + ((index * 13) % 240);
  const mentionsSent = 4 + ((index * 17) % 420);
  const retweetsSent = (index * 7) % 88;
  const groupDmMessages = index % 9 === 0 ? (index * 3) % 42 : 0;
  const interactionScore = dmTotal * 5 + repliesSent * 3 + mentionsSent + retweetsSent + groupDmMessages * 0.5;
  const inactive = index > 0 && index % 67 === 0;
  return {
    id: `sample-${index + 1}`,
    userId: `${1000000 + index}`,
    handle,
    name: handle
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    bio: 'Synthetic sample row. Import your X archive to replace this with your own network.',
    followsYou: index % 4 !== 0,
    iFollow: index % 3 !== 0,
    mutual: index % 5 !== 0,
    verified: index < 12 || index % 43 === 0,
    dmTotal,
    dmSent: Math.ceil(dmTotal * 0.55),
    dmReceived: Math.floor(dmTotal * 0.45),
    dmFirst: '2025-01-14T10:00:00.000Z',
    dmLast: `2026-${String((index % 5) + 1).padStart(2, '0')}-12T18:00:00.000Z`,
    groupDmMessages,
    mentionsSent,
    repliesSent,
    retweetsSent,
    interactionScore,
    tags: inactive ? ['status:inactive', ...tagGroups[index % tagGroups.length]] : tagGroups[index % tagGroups.length],
    inactive,
    inactiveReason: inactive ? 'no longer active' : undefined,
    url: `https://x.com/${handle}`,
    avatarUrl: avatarDataUrl(handle, colorForIndex(index)),
  };
}).sort((a, b) => b.interactionScore - a.interactionScore || a.handle.localeCompare(b.handle));

const edges: XNetworkEdge[] = nodes.filter((node) => !node.inactive).slice(0, 180).flatMap((node) => {
  const rows: XNetworkEdge[] = [];
  if (node.dmTotal > 0) rows.push({ source: 'account:sample_builder', target: node.id, type: 'dm', weight: node.dmTotal });
  if (node.repliesSent > 30) rows.push({ source: 'account:sample_builder', target: node.id, type: 'reply', weight: node.repliesSent });
  if (node.mentionsSent > 40) rows.push({ source: 'account:sample_builder', target: node.id, type: 'mention', weight: node.mentionsSent });
  return rows;
});

export const sampleXNetwork: XNetwork = {
  account: {
    id: 'sample-account',
    handle: 'sample_builder',
    displayName: 'Sample Builder',
    bio: 'Import your archive to make this yours.',
    avatarUrl: avatarDataUrl('sample_builder', '#52e1f5'),
  },
  counts: {
    followers: 12048,
    following: 932,
    mutuals: 618,
    tweets_total: 4200,
    tweets_replies: 1800,
    tweets_retweets: 620,
    tweet_mention_events: 2600,
    unique_handles_in_tweets: 1240,
    dm_conversations: 184,
    dm_counterparties: 134,
    dm_messages_total: nodes.reduce((total, node) => total + node.dmTotal, 0),
    dm_messages_sent: nodes.reduce((total, node) => total + node.dmSent, 0),
    dm_messages_received: nodes.reduce((total, node) => total + node.dmReceived, 0),
    interactions_rows: nodes.length,
    interactions_with_score_gt_0: nodes.length,
  },
  nodes,
  edges,
  followersOnlyIds: nodes.slice(220, 235).map((node) => node.id),
  followingOnlyIds: nodes.slice(235, 250).map((node) => node.id),
  dmMonthly: Array.from({ length: 18 }, (_, index) => ({
    month: `2025-${String((index % 12) + 1).padStart(2, '0')}`,
    sent: 14 + ((index * 9) % 50),
    received: 12 + ((index * 7) % 44),
    uniqueCounterparties: 5 + ((index * 3) % 20),
  })),
};
