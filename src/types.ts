export interface XNetworkNode {
  id: string;
  userId?: string | null;
  handle: string;
  name: string;
  bio: string;
  followsYou: boolean;
  iFollow: boolean;
  mutual: boolean;
  verified: boolean;
  dmTotal: number;
  dmSent: number;
  dmReceived: number;
  dmFirst?: string | null;
  dmLast?: string | null;
  groupDmMessages: number;
  mentionsSent: number;
  repliesSent: number;
  retweetsSent: number;
  interactionScore: number;
  tags: string[];
  url: string;
  taggedUrl?: string;
  avatarPath?: string;
  avatarUrl?: string;
}

export interface XNetworkEdge {
  source: string;
  target: string;
  type: 'dm' | 'reply' | 'mention';
  weight: number;
}

export interface XNetworkAccount {
  handle: string;
  id: string;
  displayName: string;
  createdAt?: string;
  bio?: string;
  avatarPath?: string;
  avatarUrl?: string;
}

export type XNetworkCounts = Record<string, number>;

export interface XNetworkDmMonthly {
  month: string;
  sent: number;
  received: number;
  uniqueCounterparties: number;
}

export interface XNetwork {
  account?: XNetworkAccount;
  counts?: XNetworkCounts;
  nodes: XNetworkNode[];
  edges: XNetworkEdge[];
  followersOnlyIds: string[];
  followingOnlyIds: string[];
  dmMonthly: XNetworkDmMonthly[];
}
