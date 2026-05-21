import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface XNetworkNode {
  handle: string;
  interactionScore?: number;
  avatarUrl?: string;
}

interface XNetwork {
  account?: { handle?: string; avatarUrl?: string };
  nodes: XNetworkNode[];
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const CONCURRENCY = Number(process.env.X_AVATAR_CONCURRENCY ?? 6);
const HANDLE_LIMIT = Number(process.env.X_AVATAR_LIMIT ?? 500);
const EXPLICIT_HANDLES = (process.env.X_AVATAR_HANDLES ?? '')
  .split(',')
  .map((handle) => handle.trim().replace(/^@/, ''))
  .filter(Boolean);

function sanitizeHandle(handle: string): string {
  return handle.replace(/[^A-Za-z0-9_]/g, '_');
}

function extensionFromContentType(contentType: string | null, imageUrl: string): string {
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  if (contentType?.includes('gif')) return 'gif';
  const extension = path.extname(new URL(imageUrl).pathname).replace('.', '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) return extension;
  return 'jpg';
}

function fullSizeProfileImageUrl(imageUrl: string): string {
  return imageUrl.replace(/_normal(\.[a-z]+)$/i, '_400x400$1');
}

function extractProfileImageUrl(html: string): string | null {
  const match = html.match(/https:\/\/pbs\.twimg\.com\/profile_images\/[^"'?<>\s]+/);
  return match ? fullSizeProfileImageUrl(match[0]) : null;
}

async function readNetwork(networkPath: string): Promise<XNetwork> {
  return JSON.parse(await readFile(networkPath, 'utf8')) as XNetwork;
}

function handlesFromNetwork(network: XNetwork): string[] {
  if (EXPLICIT_HANDLES.length > 0) {
    return [...new Map(EXPLICIT_HANDLES.map((handle) => [handle.toLowerCase(), handle])).values()];
  }

  const handles = new Map<string, string>();
  if (network.account?.handle) {
    handles.set(network.account.handle.toLowerCase(), network.account.handle);
  }
  const ranked = [...network.nodes].sort((a, b) => (b.interactionScore ?? 0) - (a.interactionScore ?? 0));
  for (const node of ranked) {
    if (!node.handle || node.handle.includes(':')) continue;
    handles.set(node.handle.toLowerCase(), node.handle);
    if (HANDLE_LIMIT > 0 && handles.size >= HANDLE_LIMIT) break;
  }
  return [...handles.values()];
}

async function existingAvatarFiles(avatarDir: string): Promise<Map<string, string>> {
  try {
    const entries = await readdir(avatarDir, { withFileTypes: true });
    return new Map(
      entries
        .filter((entry) => entry.isFile())
        .map((entry) => [path.basename(entry.name, path.extname(entry.name)).toLowerCase(), entry.name]),
    );
  } catch {
    return new Map();
  }
}

async function fetchAvatar(handle: string, avatarDir: string): Promise<string | null> {
  const profileResponse = await fetch(`https://x.com/${encodeURIComponent(handle)}`, {
    headers: { 'user-agent': USER_AGENT },
  });

  if (!profileResponse.ok) {
    throw new Error(`profile ${profileResponse.status}`);
  }

  const imageUrl = extractProfileImageUrl(await profileResponse.text());
  if (!imageUrl) {
    return null;
  }

  const imageResponse = await fetch(imageUrl, {
    headers: { 'user-agent': USER_AGENT, referer: `https://x.com/${encodeURIComponent(handle)}` },
  });
  if (!imageResponse.ok) {
    throw new Error(`image ${imageResponse.status}`);
  }

  const extension = extensionFromContentType(imageResponse.headers.get('content-type'), imageUrl);
  const fileName = `${sanitizeHandle(handle)}.${extension === 'jpeg' ? 'jpg' : extension}`;
  const outputPath = path.join(avatarDir, fileName);
  const tempPath = `${outputPath}.tmp`;
  await writeFile(tempPath, Buffer.from(await imageResponse.arrayBuffer()));
  await rename(tempPath, outputPath);
  return fileName;
}

async function worker(
  handles: string[],
  avatarDir: string,
  filesByHandle: Map<string, string>,
  failures: string[],
  stats: { saved: number; skipped: number; missing: number; attempted: number },
) {
  for (;;) {
    const handle = handles.shift();
    if (!handle) return;

    try {
      const fileName = await fetchAvatar(handle, avatarDir);
      if (fileName) {
        filesByHandle.set(handle.toLowerCase(), fileName);
        stats.saved += 1;
      } else {
        stats.missing += 1;
        failures.push(`${handle}: no profile image found`);
      }
    } catch (error) {
      failures.push(`${handle}: ${error instanceof Error ? error.message : String(error)}`);
    }

    stats.attempted += 1;
    const processed = stats.skipped + stats.attempted;
    if (processed % 50 === 0) {
      console.log(`processed ${processed}`);
    }
  }
}

function attachAvatarUrls(network: XNetwork, filesByHandle: Map<string, string>): XNetwork {
  const urlForHandle = (handle?: string) => {
    if (!handle) return undefined;
    const fileName = filesByHandle.get(handle.toLowerCase());
    return fileName ? `/generated/x-avatars/${encodeURIComponent(fileName)}` : undefined;
  };
  return {
    ...network,
    account: network.account ? { ...network.account, avatarUrl: urlForHandle(network.account.handle) ?? network.account.avatarUrl } : undefined,
    nodes: network.nodes.map((node) => ({
      ...node,
      avatarUrl: urlForHandle(node.handle) ?? node.avatarUrl,
    })),
  };
}

async function main(): Promise<void> {
  const networkPath = path.resolve(process.argv[2] ?? 'public/generated/x-network.json');
  const avatarDir = path.resolve(process.argv[3] ?? 'public/generated/x-avatars');
  await mkdir(avatarDir, { recursive: true });

  const network = await readNetwork(networkPath);
  const handles = handlesFromNetwork(network);
  const filesByHandle = await existingAvatarFiles(avatarDir);
  const queue = handles.filter((handle) => !filesByHandle.has(handle.toLowerCase()));
  const stats = { saved: 0, skipped: handles.length - queue.length, missing: 0, attempted: 0 };
  const failures: string[] = [];

  console.log(`fetching ${queue.length} missing avatars (${stats.skipped} already cached)`);
  await Promise.all(
    Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker(queue, avatarDir, filesByHandle, failures, stats)),
  );

  const failurePath = path.join(avatarDir, '.fetch-failures.json');
  if (failures.length > 0) {
    await writeFile(failurePath, `${JSON.stringify(failures, null, 2)}\n`);
  } else {
    await rm(failurePath, { force: true });
  }

  await writeFile(networkPath, `${JSON.stringify(attachAvatarUrls(network, filesByHandle), null, 2)}\n`);
  console.log(
    `done: ${stats.saved} saved, ${stats.skipped} skipped, ${stats.missing} missing image, ${failures.length} failures`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
