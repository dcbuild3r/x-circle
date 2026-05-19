# X Circle

Turn your X archive into a private, local X network graph and a Top 200 circle screenshot.

This is a standalone extraction of the X Network graph from the local Obsidian Portal. It runs fully in the browser after you generate `public/generated/x-network.json` from your own X archive.

## Features

- Force-style X interaction graph with small avatar nodes.
- Top 200 circle view with your profile centered.
- Save-to-filesystem PNG export.
- Copy-to-clipboard PNG export.
- Searchable right rail with ranks, DM/reply/mention/retweet stats.
- Virtualized interaction table and basic stats view.
- Sample data fallback so the app works before you import an archive.

## Quick Start

```bash
bun install
bun run dev
```

Open the Vite URL and you should see the sample X Circle.

## Import Your X Archive

1. Request and download your X archive from X.
2. Unzip it. The folder should contain a `data/` directory with files like `account.js`, `tweets.js`, `follower.js`, `following.js`, and `direct-messages.js`.
3. Generate the local network JSON:

```bash
bun run import:archive -- --archive-dir ~/Downloads/twitter-archive/data
```

This writes:

- `public/generated/x-network.json`, used by the app.
- `data/x-network/interactions.jsonl`, a normalized local table.
- `data/x-network/top-interactions.md`, a readable top-200 summary.

Generated data is ignored by Git.

## Optional Profile Images

The archive does not include profile images for everyone. You can optionally fetch public X profile images for the top handles:

```bash
bun run fetch:avatars
```

Useful environment variables:

```bash
X_AVATAR_LIMIT=200 bun run fetch:avatars
X_AVATAR_HANDLES=alice,bob,charlie bun run fetch:avatars
X_AVATAR_CONCURRENCY=3 bun run fetch:avatars
```

Fetched avatars are saved under `public/generated/x-avatars/` and the generated JSON is updated with local avatar URLs.

## Data Model

The app expects:

```ts
interface XNetwork {
  account?: XNetworkAccount;
  counts?: Record<string, number>;
  nodes: XNetworkNode[];
  edges: XNetworkEdge[];
  followersOnlyIds: string[];
  followingOnlyIds: string[];
  dmMonthly: XNetworkDmMonthly[];
}
```

Interaction score is:

```txt
DM * 5 + reply * 3 + mention + retweet + groupDM * 0.5
```

## Privacy

All imported archive data stays local. Do not commit `public/generated/` or `data/x-network/` if it contains your private network.

## Repository Status

This folder is ready to become a public repo. Before publishing, decide whether to keep the MIT license, rename the package, and add screenshots generated from sample data only.
