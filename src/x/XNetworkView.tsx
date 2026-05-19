import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import Graphology from 'graphology';
import {
  ArrowDownUp,
  AtSign,
  BarChart3,
  Camera,
  Check,
  ExternalLink,
  GitBranch,
  Search,
  Table2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { XNetwork, XNetworkAccount, XNetworkEdge, XNetworkNode } from '../types';

type XNetworkTab = 'graph' | 'table' | 'stats';
type XGraphMode = 'network' | 'circle200';
type SortKey = 'score' | 'dmTotal' | 'repliesSent' | 'mentionsSent' | 'retweetsSent' | 'dmLast' | 'handle';

interface XGraphNodeAttributes {
  label: string;
  color: string;
  size: number;
  x: number;
  y: number;
  kind: 'account' | 'person';
  handle: string;
}

interface ProjectedXNode {
  id: string;
  node: XNetworkNode;
  x: number;
  y: number;
  radius: number;
  color: string;
}

interface XGraphEdgeAttributes {
  color: string;
  size: number;
  weight: number;
  interactionType: XNetworkEdge['type'];
}

const GRAPH_LIMIT_DEFAULT = 1500;
const GRAPH_LIMIT_MAX = 5000;
const GRAPH_EDGE_LIMIT = 180;
const TABLE_ROW_HEIGHT = 48;
const TABLE_VIEWPORT_HEIGHT = 620;
const X_GRAPH_COLORS = [
  '#10c8ee',
  '#f80c91',
  '#ff7617',
  '#7456f5',
  '#0be9b9',
  '#f62a68',
  '#1f93ff',
  '#ae00f5',
  '#f5ec49',
  '#52e1f5',
  '#ff3dac',
  '#ff9b2d',
  '#9a7cff',
  '#36f0cd',
  '#ff4d7d',
  '#55adff',
  '#c51cff',
  '#fff05f',
];
const TAG_NAMESPACE_COLORS: Record<string, string> = {
  tech: X_GRAPH_COLORS[0],
  role: X_GRAPH_COLORS[2],
  org: X_GRAPH_COLORS[4],
  signal: X_GRAPH_COLORS[3],
};
const EDGE_COLORS: Record<XNetworkEdge['type'], string> = {
  dm: 'rgba(82, 225, 245, 0.034)',
  reply: 'rgba(255, 61, 172, 0.026)',
  mention: 'rgba(154, 124, 255, 0.022)',
};

export function XNetworkView({
  xNetwork,
  initialSelectedHandle,
}: {
  xNetwork: XNetwork;
  initialSelectedHandle?: string | null;
}) {
  const [tab, setTab] = useState<XNetworkTab>('graph');
  const [query, setQuery] = useState(initialSelectedHandle ?? '');
  const [mutualOnly, setMutualOnly] = useState(false);
  const [followsMeOnly, setFollowsMeOnly] = useState(false);
  const [iFollowOnly, setIFollowOnly] = useState(false);
  const [dmOnly, setDmOnly] = useState(false);
  const [activeNamespaces, setActiveNamespaces] = useState<Set<string>>(() => new Set());
  const [showAllGraphNodes, setShowAllGraphNodes] = useState(false);
  const [graphMode, setGraphMode] = useState<XGraphMode>('network');
  const [selectedNode, setSelectedNode] = useState<XNetworkNode | null>(null);

  const namespaces = useMemo(() => buildTagNamespaces(xNetwork.nodes), [xNetwork.nodes]);
  const topNodes = useMemo(
    () => xNetwork.nodes
      .filter((node) => node.interactionScore > 0 && !isSelfNode(node, xNetwork.account?.handle))
      .sort(sortByScoreThenHandle),
    [xNetwork.account?.handle, xNetwork.nodes],
  );

  const filteredNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return xNetwork.nodes
      .filter((node) => {
        if (isSelfNode(node, xNetwork.account?.handle)) return false;
        if (mutualOnly && !node.mutual) return false;
        if (followsMeOnly && !node.followsYou) return false;
        if (iFollowOnly && !node.iFollow) return false;
        if (dmOnly && node.dmTotal <= 0) return false;
        if (activeNamespaces.size > 0 && !node.tags.some((tag) => activeNamespaces.has(tagNamespace(tag)))) {
          return false;
        }
        if (normalizedQuery) {
          const haystack = [
            node.handle,
            node.name,
            node.bio,
            node.userId,
            ...node.tags,
          ].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(normalizedQuery)) return false;
        }
        return true;
      })
      .sort(sortByScoreThenHandle);
  }, [activeNamespaces, dmOnly, followsMeOnly, iFollowOnly, mutualOnly, query, xNetwork.account?.handle, xNetwork.nodes]);

  const graphNodes = useMemo(() => {
    const limit = graphMode === 'circle200' ? 200 : showAllGraphNodes ? GRAPH_LIMIT_MAX : GRAPH_LIMIT_DEFAULT;
    const eligibleNodes = filteredNodes
      .filter((node) => node.interactionScore >= 10 && !node.id.startsWith('id:'));
    if (graphMode === 'circle200') {
      return eligibleNodes.slice(0, limit);
    }
    const avatarNodes = eligibleNodes.filter((node) => Boolean(node.avatarUrl));
    const missingAvatarNodes = eligibleNodes.filter((node) => !node.avatarUrl);
    return [...avatarNodes, ...missingAvatarNodes].slice(0, limit);
  }, [filteredNodes, graphMode, showAllGraphNodes]);

  const selectedFromRoute = useMemo(() => {
    if (!initialSelectedHandle) return null;
    const normalized = initialSelectedHandle.toLowerCase().replace(/^@/, '');
    return xNetwork.nodes.find((node) => node.handle.toLowerCase() === normalized || node.id === normalized) ?? null;
  }, [initialSelectedHandle, xNetwork.nodes]);

  useEffect(() => {
    if (selectedFromRoute) {
      setSelectedNode(selectedFromRoute);
      setTab('graph');
    }
  }, [selectedFromRoute]);

  const toggleNamespace = (namespace: string) => {
    setActiveNamespaces((current) => {
      const next = new Set(current);
      if (next.has(namespace)) {
        next.delete(namespace);
      } else {
        next.add(namespace);
      }
      return next;
    });
  };

  return (
    <section className="x-network-page" aria-label="X Network">
      <header className="x-network-hero">
        <div>
          <p className="eyebrow">Network / X</p>
          <h2>X Circle</h2>
          <p>
            {formatCount(xNetwork.counts?.followers)} followers · {formatCount(xNetwork.counts?.following)} following ·{' '}
            {formatCount(xNetwork.counts?.interactions_with_score_gt_0)} interactors
          </p>
        </div>
        <div className="x-network-hero-account" aria-label="X account">
          {xNetwork.account?.avatarUrl ? (
            <img src={xNetwork.account.avatarUrl} alt="" loading="eager" decoding="async" />
          ) : (
            <AtSign size={18} aria-hidden="true" />
          )}
          <div>
            <strong>@{xNetwork.account?.handle ?? 'me'}</strong>
            <span>{xNetwork.account?.displayName ?? 'Your X archive'}</span>
          </div>
        </div>
      </header>

      <div className="x-network-tabbar" aria-label="X Network view">
        <TabButton tab="graph" activeTab={tab} setTab={setTab} icon={<GitBranch size={16} />} label="Graph" />
        <TabButton tab="table" activeTab={tab} setTab={setTab} icon={<Table2 size={16} />} label="Table" />
        <TabButton tab="stats" activeTab={tab} setTab={setTab} icon={<BarChart3 size={16} />} label="Stats" />
      </div>

      {tab === 'graph' ? (
        <>
          <XNetworkFilters
            query={query}
            setQuery={setQuery}
            mutualOnly={mutualOnly}
            setMutualOnly={setMutualOnly}
            followsMeOnly={followsMeOnly}
            setFollowsMeOnly={setFollowsMeOnly}
            iFollowOnly={iFollowOnly}
            setIFollowOnly={setIFollowOnly}
            dmOnly={dmOnly}
            setDmOnly={setDmOnly}
            namespaces={namespaces}
            activeNamespaces={activeNamespaces}
            toggleNamespace={toggleNamespace}
          />
          <div className="x-network-graph-meta">
            <span>
              Rendering {graphNodes.length.toLocaleString()} of {filteredNodes.length.toLocaleString()} filtered profiles
            </span>
            <button
              type="button"
              aria-pressed={showAllGraphNodes}
              disabled={graphMode === 'circle200'}
              onClick={() => setShowAllGraphNodes((value) => !value)}
            >
              {graphMode === 'circle200' ? 'Top 200 Circle' : showAllGraphNodes ? 'Top 1,500' : 'Show up to 5,000'}
            </button>
          </div>
          <XNetworkGraph
            account={xNetwork.account}
            accountHandle={xNetwork.account?.handle}
            nodes={graphNodes}
            topInteractorNodes={topNodes.slice(0, 200)}
            edges={xNetwork.edges}
            graphMode={graphMode}
            setGraphMode={setGraphMode}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
          />
        </>
      ) : null}

      {tab === 'table' ? (
        <XNetworkTable nodes={filteredNodes.length > 0 ? filteredNodes : topNodes} onSelectNode={setSelectedNode} />
      ) : null}

      {tab === 'stats' ? (
        <XNetworkStats xNetwork={xNetwork} topNodes={topNodes} />
      ) : null}

      {selectedNode ? (
        <XNodeDrawer node={selectedNode} onClose={() => setSelectedNode(null)} />
      ) : null}
    </section>
  );
}

function TabButton({
  tab,
  activeTab,
  setTab,
  icon,
  label,
}: {
  tab: XNetworkTab;
  activeTab: XNetworkTab;
  setTab: (tab: XNetworkTab) => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button type="button" aria-pressed={activeTab === tab} onClick={() => setTab(tab)}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function XNetworkFilters({
  query,
  setQuery,
  mutualOnly,
  setMutualOnly,
  followsMeOnly,
  setFollowsMeOnly,
  iFollowOnly,
  setIFollowOnly,
  dmOnly,
  setDmOnly,
  namespaces,
  activeNamespaces,
  toggleNamespace,
}: {
  query: string;
  setQuery: (query: string) => void;
  mutualOnly: boolean;
  setMutualOnly: (value: boolean) => void;
  followsMeOnly: boolean;
  setFollowsMeOnly: (value: boolean) => void;
  iFollowOnly: boolean;
  setIFollowOnly: (value: boolean) => void;
  dmOnly: boolean;
  setDmOnly: (value: boolean) => void;
  namespaces: Array<{ namespace: string; count: number }>;
  activeNamespaces: Set<string>;
  toggleNamespace: (namespace: string) => void;
}) {
  return (
    <div className="x-network-filter-panel">
      <label className="x-network-search-field">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search handle, name, bio, tag..."
          aria-label="Search X Network"
        />
      </label>
      <div className="x-filter-switches" aria-label="X Network filters">
        <ToggleButton active={mutualOnly} onChange={setMutualOnly} label="Mutual only" />
        <ToggleButton active={followsMeOnly} onChange={setFollowsMeOnly} label="Follows me" />
        <ToggleButton active={iFollowOnly} onChange={setIFollowOnly} label="I follow" />
        <ToggleButton active={dmOnly} onChange={setDmOnly} label="DM > 0" />
      </div>
      <div className="x-tag-namespace-row" aria-label="Tag namespace filters">
        {namespaces.map(({ namespace, count }) => (
          <button
            key={namespace}
            type="button"
            aria-pressed={activeNamespaces.has(namespace)}
            onClick={() => toggleNamespace(namespace)}
            style={{ '--namespace-color': colorForNamespace(namespace) } as React.CSSProperties}
          >
            {namespace} ({count.toLocaleString()})
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onChange,
  label,
}: {
  active: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={() => onChange(!active)}>
      {active ? <Check size={14} aria-hidden="true" /> : null}
      {label}
    </button>
  );
}

function XNetworkGraph({
  account,
  accountHandle,
  nodes,
  topInteractorNodes,
  edges,
  graphMode,
  setGraphMode,
  selectedNode,
  onSelectNode,
}: {
  account?: XNetworkAccount;
  accountHandle?: string;
  nodes: XNetworkNode[];
  topInteractorNodes: XNetworkNode[];
  edges: XNetworkEdge[];
  graphMode: XGraphMode;
  setGraphMode: (mode: XGraphMode) => void;
  selectedNode: XNetworkNode | null;
  onSelectNode: (node: XNetworkNode) => void;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const projectedNodesRef = useRef<ProjectedXNode[]>([]);
  const imageCacheRef = useRef<Map<string, HTMLImageElement | 'error'>>(new Map());
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [graphFrame, setGraphFrame] = useState({ size: 520, areaWidth: 580, railWidth: 260 });
  const [imageVersion, setImageVersion] = useState(0);
  const [hoveredNode, setHoveredNode] = useState<XNetworkNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [indexQuery, setIndexQuery] = useState('');
  const graphModel = useMemo(() => buildGraphModel(accountHandle, nodes, edges, graphMode), [accountHandle, edges, graphMode, nodes]);
  const avatarCount = useMemo(() => nodes.filter((node) => Boolean(node.avatarUrl)).length, [nodes]);
  const indexEntries = useMemo(() => {
    const rankedNodes = nodes.map((node, index) => ({ node, rank: index + 1 }));
    const normalizedQuery = normalizeHandleSearch(indexQuery);
    if (!normalizedQuery) return rankedNodes;
    return rankedNodes.filter(({ node }) => normalizeHandleSearch(node.handle).includes(normalizedQuery));
  }, [indexQuery, nodes]);
  const indexTitle = graphMode === 'circle200'
    ? 'Top 200'
    : nodes.length >= GRAPH_LIMIT_MAX
      ? 'Top 5,000'
      : `Top ${nodes.length.toLocaleString()}`;

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const measure = () => {
      const shellLeft = shell.getBoundingClientRect().left;
      const parentWidth = shell.parentElement?.clientWidth ?? shell.getBoundingClientRect().width;
      const visibleWidth = Math.max(0, window.innerWidth - shellLeft - 24);
      const rowWidth = Math.min(parentWidth, visibleWidth);
      const railWidth = Math.floor(rowWidth < 560
        ? Math.max(180, Math.min(220, rowWidth * 0.36))
        : Math.max(240, Math.min(340, rowWidth * 0.34)));
      const gap = 14;
      const graphAreaWidth = Math.floor(Math.max(280, rowWidth - railWidth - gap - 1));
      const preferredGraphWidth = window.innerWidth * 0.72;
      const size = Math.floor(Math.max(260, Math.min(preferredGraphWidth, graphAreaWidth * 0.94)));
      setGraphFrame((current) => (
        current.size === size && current.areaWidth === graphAreaWidth && current.railWidth === railWidth
          ? current
          : { size, areaWidth: graphAreaWidth, railWidth }
      ));
    };

    measure();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (resizeObserver && shell.parentElement) {
      resizeObserver.observe(shell.parentElement);
    }
    window.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    if (typeof ResizeObserver === 'undefined') {
      const rect = wrap.getBoundingClientRect();
      setCanvasSize({
        width: Math.max(1, Math.floor(rect.width || 960)),
        height: Math.max(1, Math.floor(rect.height || 660)),
      });
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setCanvasSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    });
    resizeObserver.observe(wrap);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let hasCompletedCachedImage = false;
    const avatarSources: Array<{ avatarUrl?: string }> = account
      ? [account, ...nodes, ...topInteractorNodes]
      : [...nodes, ...topInteractorNodes];
    for (const source of avatarSources) {
      if (!source.avatarUrl) {
        continue;
      }

      const cachedImage = imageCacheRef.current.get(source.avatarUrl);
      if (cachedImage === 'error') {
        continue;
      }

      const image = cachedImage instanceof HTMLImageElement ? cachedImage : new Image();
      image.onload = () => {
        if (!active) return;
        imageCacheRef.current.set(source.avatarUrl!, image);
        setImageVersion((version) => version + 1);
      };
      image.onerror = () => {
        if (!active) return;
        imageCacheRef.current.set(source.avatarUrl!, 'error');
        setImageVersion((version) => version + 1);
      };

      if (!cachedImage) {
        image.decoding = 'async';
        image.loading = 'eager';
        image.src = source.avatarUrl;
        imageCacheRef.current.set(source.avatarUrl, image);
      } else if (image.complete && image.naturalWidth > 0) {
        hasCompletedCachedImage = true;
      }
    }
    if (hasCompletedCachedImage) {
      setImageVersion((version) => version + 1);
    }
    return () => {
      active = false;
    };
  }, [account, nodes, topInteractorNodes]);

  useEffect(() => {
    drawXNetworkCanvas({
      canvas: canvasRef.current,
      graphModel,
      nodes,
      selectedNode,
      hoveredNode,
      canvasSize,
      imageCache: imageCacheRef.current,
      projectedNodesRef,
      graphMode,
      zoom,
      account,
    });
  }, [account, canvasSize, graphMode, graphModel, hoveredNode, imageVersion, nodes, selectedNode, zoom]);

  useEffect(() => {
    if (graphMode === 'circle200') {
      setZoom(1);
    }
  }, [graphMode]);

  const adjustZoom = (nextZoom: number) => {
    setZoom(Math.max(0.55, Math.min(2.6, nextZoom)));
  };

  const saveTop200Circle = async () => {
    setExportStatus('Rendering top 200...');
    try {
      const result = await saveTop200CirclePng(topInteractorNodes, imageCacheRef.current, account);
      setExportStatus(result === 'picker' ? 'Saved top 200 PNG.' : 'Downloaded top 200 PNG.');
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : 'Could not save PNG.');
    }
  };

  const copyTop200Circle = async () => {
    setExportStatus('Rendering top 200...');
    try {
      await copyTop200CirclePng(topInteractorNodes, imageCacheRef.current, account);
      setExportStatus('Copied top 200 PNG.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setExportStatus(message.includes('focused') || message.includes('NotAllowed')
        ? 'Focus the portal tab, then click Copy PNG again.'
        : message || 'Could not copy PNG.');
    }
  };

  const updateHoveredNode = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = findHitNode(projectedNodesRef.current, x, y);
    setHoveredNode(hit?.node ?? null);
  };

  const clickNode = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = findHitNode(projectedNodesRef.current, x, y);
    if (hit) {
      onSelectNode(hit.node);
    }
  };

  const zoomWithWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    adjustZoom(zoom + (event.deltaY < 0 ? 0.08 : -0.08));
  };

  return (
    <div
      ref={shellRef}
      className="x-force-graph-shell"
      style={{
        '--x-graph-size': `${graphFrame.size}px`,
        '--x-graph-area-width': `${graphFrame.areaWidth}px`,
        '--x-graph-rail-width': `${graphFrame.railWidth}px`,
      } as React.CSSProperties}
    >
      <div ref={wrapRef} className="x-force-graph-canvas-wrap">
        <div className="x-graph-controls" aria-label="X graph controls">
          <div className="x-graph-mode-toggle" aria-label="Graph mode">
            <button
              type="button"
              aria-pressed={graphMode === 'network'}
              onClick={() => setGraphMode('network')}
            >
              Network
            </button>
            <button
              type="button"
              aria-pressed={graphMode === 'circle200'}
              onClick={() => setGraphMode('circle200')}
            >
              Top 200 Circle
            </button>
          </div>
          <div className="x-graph-zoom-controls" aria-label="Graph zoom controls">
            <button type="button" onClick={() => adjustZoom(zoom - 0.15)} aria-label="Zoom out">
              <ZoomOut size={15} aria-hidden="true" />
            </button>
            <input
              type="range"
              min="0.55"
              max="2.6"
              step="0.05"
              value={zoom}
              onChange={(event) => adjustZoom(Number(event.target.value))}
              aria-label="Graph zoom"
            />
            <button type="button" onClick={() => adjustZoom(zoom + 0.15)} aria-label="Zoom in">
              <ZoomIn size={15} aria-hidden="true" />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <button type="button" className="x-circle-export-button" onClick={saveTop200Circle}>
            <Camera size={15} aria-hidden="true" />
            Save to filesystem
          </button>
          <button type="button" className="x-circle-export-button" onClick={copyTop200Circle}>
            <Camera size={15} aria-hidden="true" />
            Copy PNG
          </button>
          {exportStatus ? <span className="x-graph-export-status">{exportStatus}</span> : null}
        </div>
        <canvas
          ref={canvasRef}
          className="x-force-graph-canvas"
          data-renderer-status="ready"
          onPointerMove={updateHoveredNode}
          onPointerLeave={() => setHoveredNode(null)}
          onPointerDown={clickNode}
          onWheel={zoomWithWheel}
          aria-label="X Network avatar graph"
        />
        <div className="x-force-graph-overlay" aria-hidden="true">
          <strong>{nodes.length.toLocaleString()}</strong>
          <span>visible nodes</span>
          <strong>{graphModel.edgeCount.toLocaleString()}</strong>
          <span>edges</span>
          <strong>{avatarCount.toLocaleString()}</strong>
          <span>pfps</span>
        </div>
        {hoveredNode ? (
          <div className="x-graph-hover-card" aria-hidden="true">
            <strong>@{hoveredNode.handle}</strong>
            <span>{hoveredNode.name}</span>
            <small>{Math.round(hoveredNode.interactionScore).toLocaleString()} score</small>
          </div>
        ) : null}
      </div>
      <aside className="x-graph-index" aria-label={`${indexTitle} X interactors`}>
        <div className="x-graph-index-toolbar">
          <div>
            <strong>{indexTitle}</strong>
            <span>{indexEntries.length.toLocaleString()} shown</span>
          </div>
          <label className="x-graph-index-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={indexQuery}
              onChange={(event) => setIndexQuery(event.target.value)}
              placeholder="Search handle"
              aria-label={`Search ${indexTitle} handles`}
            />
          </label>
        </div>
        <div className="x-graph-index-list">
          {indexEntries.map(({ node, rank }) => (
            <button
              key={node.id}
              type="button"
              aria-pressed={selectedNode?.id === node.id}
              onClick={() => onSelectNode(node)}
            >
              <span className="x-graph-index-rank">{rank}</span>
              {node.avatarUrl ? (
                <img src={node.avatarUrl} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="x-graph-index-dot" style={{ backgroundColor: colorForNode(node) }} />
              )}
              <strong>@{node.handle}</strong>
              <span className="x-graph-index-metrics">
                <small>{formatCount(totalInteractionCount(node))} interactions</small>
                <span className="x-graph-index-metric-row">
                  <small>{formatCount(node.dmTotal)} DM</small>
                  <small>{formatCount(node.repliesSent)} replies</small>
                  <small>{formatCount(node.mentionsSent)} mentions</small>
                  <small>{formatCount(node.retweetsSent)} retweets</small>
                </span>
              </span>
            </button>
          ))}
          {indexEntries.length === 0 ? (
            <p className="x-graph-index-empty">No handles match that search.</p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function buildGraphModel(
  accountHandle: string | undefined,
  nodes: XNetworkNode[],
  edges: XNetworkEdge[],
  graphMode: XGraphMode,
) {
  const graph = new Graphology<XGraphNodeAttributes, XGraphEdgeAttributes>({ type: 'directed', multi: true });
  const accountId = accountHandle ? `account:${accountHandle.toLowerCase()}` : 'account:me';
  graph.addNode(accountId, {
    label: `@${accountHandle ?? 'me'}`,
    color: 'rgba(245, 236, 73, 0.38)',
    size: 1.8,
    x: 0,
    y: 0,
    kind: 'account',
    handle: accountHandle ?? 'me',
  });

  nodes.forEach((node, index) => {
    const position = graphMode === 'circle200'
      ? xCirclePosition(index, nodes.length)
      : xGraphPosition(node, index, nodes.length);
    graph.addNode(node.id, {
      label: `@${node.handle}`,
      color: colorForNode(node),
      size: nodeSize(node),
      x: position.x,
      y: position.y,
      kind: 'person',
      handle: node.handle,
    });
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  let edgeCount = 0;
  const visibleEdges = graphMode === 'circle200' ? [] : edges
    .filter((edge) => nodeIds.has(edge.target))
    .sort((a, b) => b.weight - a.weight || a.target.localeCompare(b.target))
    .slice(0, GRAPH_EDGE_LIMIT);
  for (const edge of visibleEdges) {
    graph.addDirectedEdgeWithKey(`${edge.type}:${edge.target}:${edgeCount}`, accountId, edge.target, {
      color: EDGE_COLORS[edge.type],
      size: Math.max(0.012, Math.min(0.055, Math.log(edge.weight + 1) * 0.007)),
      weight: edge.weight,
      interactionType: edge.type,
    });
    edgeCount += 1;
  }

  resolveXGraphNodeCollisions(graph);

  return { graph, edgeCount };
}

function drawXNetworkCanvas({
  canvas,
  graphModel,
  nodes,
  selectedNode,
  hoveredNode,
  canvasSize,
  imageCache,
  projectedNodesRef,
  graphMode,
  zoom,
  account,
}: {
  canvas: HTMLCanvasElement | null;
  graphModel: ReturnType<typeof buildGraphModel>;
  nodes: XNetworkNode[];
  selectedNode: XNetworkNode | null;
  hoveredNode: XNetworkNode | null;
  canvasSize: { width: number; height: number };
  imageCache: Map<string, HTMLImageElement | 'error'>;
  projectedNodesRef: MutableRefObject<ProjectedXNode[]>;
  graphMode: XGraphMode;
  zoom: number;
  account?: XNetworkAccount;
}) {
  if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return;
  }

  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d');
  } catch {
    return;
  }
  if (!context) {
    return;
  }

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(canvasSize.width * dpr);
  canvas.height = Math.floor(canvasSize.height * dpr);
  canvas.style.width = `${canvasSize.width}px`;
  canvas.style.height = `${canvasSize.height}px`;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, canvasSize.width, canvasSize.height);

  const graphNodes = graphModel.graph
    .nodes()
    .map((id) => ({ id, attributes: graphModel.graph.getNodeAttributes(id) }))
    .filter((node) => node.attributes.kind === 'person');
  const bounds = xGraphPositionBounds(graphNodes.map((node) => node.attributes));
  const padding = graphMode === 'circle200' ? 62 : 34;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const projectedNodes = graphNodes
    .map((graphNode) => {
      const node = nodeById.get(graphNode.id);
      if (!node) return null;
      const selected = selectedNode?.id === node.id;
      const hovered = hoveredNode?.id === node.id;
      return {
        id: graphNode.id,
        node,
        x: projectCoordinate(graphNode.attributes.x, bounds.minX, bounds.maxX, padding, canvasSize.width - padding),
        y: projectCoordinate(graphNode.attributes.y, bounds.minY, bounds.maxY, padding, canvasSize.height - padding),
        radius: (selected || hovered) ? (graphMode === 'circle200' ? 18 : 10) : avatarRadius(node, nodes.length, graphMode),
        color: graphNode.attributes.color,
      };
    })
    .filter((node): node is ProjectedXNode => Boolean(node));
  resolveProjectedNodeCollisions(projectedNodes, canvasSize.width, canvasSize.height, padding);
  const centerX = canvasSize.width / 2;
  const centerY = canvasSize.height / 2;
  for (const node of projectedNodes) {
    node.x = centerX + (node.x - centerX) * zoom;
    node.y = centerY + (node.y - centerY) * zoom;
    node.radius *= zoom;
  }
  if (graphMode === 'circle200') {
    repelProjectedNodesFromCenter(projectedNodes, centerX, centerY, 48 * zoom);
  }
  projectedNodesRef.current = projectedNodes;
  const projectedById = new Map(projectedNodes.map((node) => [node.id, node]));

  if (graphMode !== 'circle200') {
    context.save();
    context.globalCompositeOperation = 'source-over';
    context.lineCap = 'round';
    for (const edge of graphModel.graph.edges()) {
      const [, target] = graphModel.graph.extremities(edge);
      const targetNode = projectedById.get(target);
      if (!targetNode) continue;
      context.strokeStyle = graphModel.graph.getEdgeAttribute(edge, 'color');
      context.lineWidth = Math.max(0.25, graphModel.graph.getEdgeAttribute(edge, 'size'));
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(targetNode.x, targetNode.y);
      context.stroke();
    }
    context.restore();
  }

  const sortedNodes = [...projectedNodes].sort((a, b) => a.radius - b.radius);
  for (const projected of sortedNodes) {
    drawAvatarNode(context, projected, imageCache, selectedNode?.id === projected.id, hoveredNode?.id === projected.id);
  }

  drawAccountAvatarNode(context, centerX, centerY, account, imageCache, graphMode === 'circle200' ? 42 * zoom : 12);
}

function drawAvatarNode(
  context: CanvasRenderingContext2D,
  projected: ProjectedXNode,
  imageCache: Map<string, HTMLImageElement | 'error'>,
  selected: boolean,
  hovered: boolean,
) {
  const { node, x, y, radius, color } = projected;
  const image = node.avatarUrl ? imageCache.get(node.avatarUrl) : null;
  context.save();
  context.shadowColor = color;
  context.shadowBlur = selected || hovered ? 11 : 4;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius + 1.2, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.clip();
  if (image && image !== 'error' && image.complete && image.naturalWidth > 0) {
    context.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    context.fillStyle = color;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.restore();

  if (selected || hovered) {
    context.save();
    context.strokeStyle = '#f8fafc';
    context.lineWidth = selected ? 2.2 : 1.5;
    context.beginPath();
    context.arc(x, y, radius + 2.6, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}

function drawAccountAvatarNode(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  account: XNetworkAccount | undefined,
  imageCache: Map<string, HTMLImageElement | 'error'>,
  radius: number,
) {
  const image = account?.avatarUrl ? imageCache.get(account.avatarUrl) : null;
  context.save();
  context.shadowColor = '#52e1f5';
  context.shadowBlur = radius > 20 ? 22 : 12;
  context.fillStyle = '#52e1f5';
  context.beginPath();
  context.arc(x, y, radius + 4, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.clip();
  if (image && image !== 'error' && image.complete && image.naturalWidth > 0) {
    context.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    context.fillStyle = '#030712';
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    context.fillStyle = '#52e1f5';
    context.font = `700 ${Math.max(10, Math.floor(radius * 0.62))}px Inter, ui-sans-serif, system-ui`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('@', x, y);
  }
  context.restore();

  context.save();
  context.strokeStyle = '#f8fafc';
  context.lineWidth = radius > 20 ? 3 : 1.5;
  context.beginPath();
  context.arc(x, y, radius + 5.5, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function avatarRadius(node: XNetworkNode, visibleCount: number, graphMode: XGraphMode): number {
  if (graphMode === 'circle200') {
    return Math.max(14, Math.min(21, 13 + Math.log(node.interactionScore + 2) * 0.72));
  }
  const densityScale = visibleCount > 3000 ? 0.72 : visibleCount > 1800 ? 0.84 : 1;
  const base = node.avatarUrl ? 5.2 : 3.2;
  const max = node.avatarUrl ? 7.6 : 5.4;
  return Math.max(3, Math.min(max, base + Math.log(node.interactionScore + 2) * 0.28) * densityScale);
}

function findHitNode(projectedNodes: ProjectedXNode[], x: number, y: number): ProjectedXNode | null {
  let best: ProjectedXNode | null = null;
  let bestDistance = Infinity;
  for (const node of projectedNodes) {
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance <= node.radius + 4 && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

function xGraphPositionBounds(nodes: XGraphNodeAttributes[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function projectCoordinate(value: number, min: number, max: number, targetMin: number, targetMax: number): number {
  if (max === min) {
    return (targetMin + targetMax) / 2;
  }
  return targetMin + ((value - min) / (max - min)) * (targetMax - targetMin);
}

function resolveProjectedNodeCollisions(
  nodes: ProjectedXNode[],
  width: number,
  height: number,
  padding: number,
): void {
  if (nodes.length < 2) {
    return;
  }

  const passes = nodes.length > 3000 ? 10 : 18;
  const maxRadius = Math.max(...nodes.map((node) => node.radius), 4);
  const cellSize = maxRadius * 2.8;

  for (let pass = 0; pass < passes; pass += 1) {
    const grid = new Map<string, number[]>();
    let moved = false;

    nodes.forEach((node, index) => {
      const key = `${Math.floor(node.x / cellSize)}:${Math.floor(node.y / cellSize)}`;
      const bucket = grid.get(key) ?? [];
      bucket.push(index);
      grid.set(key, bucket);
    });

    for (let index = 0; index < nodes.length; index += 1) {
      const current = nodes[index];
      const cellX = Math.floor(current.x / cellSize);
      const cellY = Math.floor(current.y / cellSize);

      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const neighborIndexes = grid.get(`${cellX + offsetX}:${cellY + offsetY}`);
          if (!neighborIndexes) continue;

          for (const nextIndex of neighborIndexes) {
            if (nextIndex <= index) continue;
            const next = nodes[nextIndex];
            let dx = next.x - current.x;
            let dy = next.y - current.y;
            let distance = Math.hypot(dx, dy);

            if (distance === 0) {
              const angle = ((index + 1) * 47 + (nextIndex + 1) * 23) % 360;
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              distance = 1;
            }

            const minimumDistance = current.radius + next.radius + 1.2;
            if (distance >= minimumDistance) continue;

            const push = ((minimumDistance - distance) / distance) * 0.52;
            current.x -= dx * push;
            current.y -= dy * push;
            next.x += dx * push;
            next.y += dy * push;
            moved = true;
          }
        }
      }
    }

    for (const node of nodes) {
      node.x = Math.max(padding + node.radius, Math.min(width - padding - node.radius, node.x));
      node.y = Math.max(padding + node.radius, Math.min(height - padding - node.radius, node.y));
    }

    if (!moved) {
      break;
    }
  }
}

function repelProjectedNodesFromCenter(
  nodes: ProjectedXNode[],
  centerX: number,
  centerY: number,
  centerRadius: number,
): void {
  for (const node of nodes) {
    let dx = node.x - centerX;
    let dy = node.y - centerY;
    let distance = Math.hypot(dx, dy);
    const minimumDistance = centerRadius + node.radius + 9;
    if (distance >= minimumDistance) continue;
    if (distance === 0) {
      const angle = Math.abs(hashString(node.id)) % 360;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      distance = 1;
    }
    const scale = minimumDistance / distance;
    node.x = centerX + dx * scale;
    node.y = centerY + dy * scale;
  }
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

async function renderTop200CircleBlob(
  nodes: XNetworkNode[],
  imageCache: Map<string, HTMLImageElement | 'error'>,
  account?: XNetworkAccount,
): Promise<Blob> {
  const size = 1600;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas renderer unavailable.');
  }

  const exportNodes = nodes.slice(0, 200);
  const center = size / 2;
  const accountRadius = 64;
  const projectedNodes = exportNodes.map((node, index) => {
    const position = xCirclePosition(index, exportNodes.length);
    return {
      id: node.id,
      node,
      x: center + position.x * 76,
      y: center + position.y * 76,
      radius: Math.max(37, Math.min(50, 35 + Math.log(node.interactionScore + 2) * 1.25)),
      color: colorForNode(node),
    };
  });
  resolveProjectedNodeCollisions(projectedNodes, size, size, 88);
  repelProjectedNodesFromCenter(projectedNodes, center, center, accountRadius);

  context.fillStyle = '#000';
  context.fillRect(0, 0, size, size);
  drawExportGrid(context, size);

  const [accountImage, images] = await Promise.all([
    loadXAvatarImage(account, imageCache),
    Promise.all(projectedNodes.map((projected) => loadXAvatarImage(projected.node, imageCache))),
  ]);
  projectedNodes.forEach((projected, index) => {
    drawExportAvatarNode(context, projected, images[index]);
  });
  drawExportCenterAccount(context, center, center, accountRadius, accountImage, account);

  context.save();
  context.fillStyle = 'rgba(248, 250, 252, 0.92)';
  context.font = '700 34px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText('X Circle · Top 200', 56, 76);
  context.fillStyle = 'rgba(148, 163, 184, 0.78)';
  context.font = '600 22px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText(account?.displayName ?? account?.handle ?? 'your archive', 56, 108);
  context.restore();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Could not render PNG.');
  }
  return blob;
}

async function saveTop200CirclePng(
  nodes: XNetworkNode[],
  imageCache: Map<string, HTMLImageElement | 'error'>,
  account?: XNetworkAccount,
): Promise<'picker' | 'download'> {
  const blob = await renderTop200CircleBlob(nodes, imageCache, account);
  const savePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (savePicker) {
    const fileHandle = await savePicker({
      suggestedName: 'x-circle-top-200.png',
      types: [
        {
          description: 'PNG image',
          accept: { 'image/png': ['.png'] },
        },
      ],
    });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return 'picker';
  }

  const link = document.createElement('a');
  link.download = 'x-circle-top-200.png';
  link.href = URL.createObjectURL(blob);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return 'download';
}

async function copyTop200CirclePng(
  nodes: XNetworkNode[],
  imageCache: Map<string, HTMLImageElement | 'error'>,
  account?: XNetworkAccount,
): Promise<void> {
  const blob = await renderTop200CircleBlob(nodes, imageCache, account);
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard image copy is unavailable in this browser.');
  }
  window.focus();
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}

function drawExportGrid(context: CanvasRenderingContext2D, size: number): void {
  context.save();
  context.lineWidth = 1;
  for (let coordinate = 0; coordinate <= size; coordinate += 72) {
    context.strokeStyle = coordinate % 144 === 0 ? 'rgba(82, 225, 245, 0.13)' : 'rgba(255, 61, 172, 0.075)';
    context.beginPath();
    context.moveTo(coordinate, 0);
    context.lineTo(coordinate, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, coordinate);
    context.lineTo(size, coordinate);
    context.stroke();
  }
  context.restore();
}

function drawExportAvatarNode(
  context: CanvasRenderingContext2D,
  projected: ProjectedXNode,
  image: HTMLImageElement | null,
): void {
  const { x, y, radius, color } = projected;
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 18;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius + 4, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.clip();
  if (image) {
    context.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    context.fillStyle = color;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.restore();
}

function drawExportCenterAccount(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  image: HTMLImageElement | null,
  account?: XNetworkAccount,
): void {
  context.save();
  context.shadowColor = '#52e1f5';
  context.shadowBlur = 32;
  context.fillStyle = '#52e1f5';
  context.beginPath();
  context.arc(x, y, radius + 8, 0, Math.PI * 2);
  context.fill();
  context.shadowColor = '#ff3dac';
  context.shadowBlur = 20;
  context.strokeStyle = '#ff3dac';
  context.lineWidth = 4;
  context.stroke();
  context.shadowBlur = 0;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.clip();
  if (image) {
    context.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    context.fillStyle = '#030712';
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    context.fillStyle = '#52e1f5';
    context.font = '800 40px Inter, ui-sans-serif, system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('@', x, y);
  }
  context.restore();

  context.save();
  context.fillStyle = 'rgba(248, 250, 252, 0.95)';
  context.font = '800 28px Inter, ui-sans-serif, system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`@${account?.handle ?? 'me'}`, x, y + radius + 38);
  context.restore();
}

function loadXAvatarImage(
  node: { avatarUrl?: string } | null | undefined,
  imageCache: Map<string, HTMLImageElement | 'error'>,
): Promise<HTMLImageElement | null> {
  if (!node?.avatarUrl) {
    return Promise.resolve(null);
  }

  const cachedImage = imageCache.get(node.avatarUrl);
  if (cachedImage && cachedImage !== 'error' && cachedImage.complete && cachedImage.naturalWidth > 0) {
    return Promise.resolve(cachedImage);
  }

  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), 2800);
    image.decoding = 'async';
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = node.avatarUrl!;
  });
}

function XNetworkTable({
  nodes,
  onSelectNode,
}: {
  nodes: XNetworkNode[];
  onSelectNode: (node: XNetworkNode) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [scrollTop, setScrollTop] = useState(0);
  const sorted = useMemo(() => sortNodes(nodes, sortKey, sortDirection), [nodes, sortDirection, sortKey]);
  const start = Math.max(0, Math.floor(scrollTop / TABLE_ROW_HEIGHT) - 6);
  const visibleCount = Math.ceil(TABLE_VIEWPORT_HEIGHT / TABLE_ROW_HEIGHT) + 12;
  const visibleRows = sorted.slice(start, start + visibleCount);

  const changeSort = (nextKey: SortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(nextKey);
      setSortDirection(nextKey === 'handle' ? 'asc' : 'desc');
    }
  };

  return (
    <section className="x-table-section" aria-label="X interaction table">
      <div className="x-table-summary">
        <strong>{sorted.length.toLocaleString()}</strong>
        <span>interaction rows, virtualized in the viewport</span>
      </div>
      <div
        className="x-table-viewport"
        style={{ height: TABLE_VIEWPORT_HEIGHT }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table className="x-interaction-table">
          <thead>
            <tr>
              <th>Rank</th>
              <SortableTh label="Handle" sortKey="handle" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <th>Name</th>
              <th>Mutual</th>
              <SortableTh label="DM s/r" sortKey="dmTotal" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableTh label="Replies" sortKey="repliesSent" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableTh label="Mentions" sortKey="mentionsSent" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableTh label="RTs" sortKey="retweetsSent" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableTh label="Score" sortKey="score" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableTh label="Last DM" sortKey="dmLast" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <th>Tags</th>
            </tr>
          </thead>
          <tbody style={{ height: sorted.length * TABLE_ROW_HEIGHT }}>
            <tr aria-hidden="true" style={{ height: start * TABLE_ROW_HEIGHT }} />
            {visibleRows.map((node, index) => (
              <tr key={node.id} style={{ height: TABLE_ROW_HEIGHT }}>
                <td>{(start + index + 1).toLocaleString()}</td>
                <td>
                  <button type="button" className="x-table-handle" onClick={() => onSelectNode(node)}>
                    @{node.handle}
                  </button>
                </td>
                <td>{node.name}</td>
                <td>{node.mutual ? 'yes' : node.followsYou ? 'follows me' : node.iFollow ? 'i follow' : 'no'}</td>
                <td>{node.dmTotal ? `${node.dmSent.toLocaleString()}/${node.dmReceived.toLocaleString()}` : '-'}</td>
                <td>{formatNumber(node.repliesSent)}</td>
                <td>{formatNumber(node.mentionsSent)}</td>
                <td>{formatNumber(node.retweetsSent)}</td>
                <td>{formatNumber(Math.round(node.interactionScore))}</td>
                <td>{formatShortDate(node.dmLast)}</td>
                <td>{node.tags.slice(0, 3).join(', ')}</td>
              </tr>
            ))}
            <tr aria-hidden="true" style={{ height: Math.max(0, sorted.length - start - visibleRows.length) * TABLE_ROW_HEIGHT }} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  return (
    <th>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-sort={activeKey === sortKey ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        {label}
        <ArrowDownUp size={12} aria-hidden="true" />
      </button>
    </th>
  );
}

function XNetworkStats({
  xNetwork,
  topNodes,
}: {
  xNetwork: XNetwork;
  topNodes: XNetworkNode[];
}) {
  const counts = xNetwork.counts ?? {};
  const namespaceCounts = buildTagNamespaces(xNetwork.nodes);
  return (
    <section className="x-stats-section" aria-label="X Network stats">
      <div className="x-stat-grid">
        <BigNumber label="Followers" value={counts.followers} />
        <BigNumber label="Following" value={counts.following} />
        <BigNumber label="Mutuals" value={counts.mutuals} />
        <BigNumber label="DM messages" value={counts.dm_messages_total} />
        <BigNumber label="Interaction rows" value={counts.interactions_rows} />
        <BigNumber label="Long-tail followers" value={xNetwork.followersOnlyIds.length} />
      </div>

      <div className="x-stats-grid">
        <BarList title="Top by score" rows={topNodes.slice(0, 10).map((node) => ({ label: `@${node.handle}`, value: node.interactionScore }))} />
        <BarList title="Top by DMs" rows={topNodes.filter((node) => node.dmTotal > 0).sort((a, b) => b.dmTotal - a.dmTotal).slice(0, 10).map((node) => ({ label: `@${node.handle}`, value: node.dmTotal }))} />
        <BarList title="Top by mentions" rows={topNodes.filter((node) => node.mentionsSent > 0).sort((a, b) => b.mentionsSent - a.mentionsSent).slice(0, 10).map((node) => ({ label: `@${node.handle}`, value: node.mentionsSent }))} />
        <BarList title="Tag namespaces" rows={namespaceCounts.map((row) => ({ label: row.namespace, value: row.count }))} />
      </div>

      <section className="x-monthly-chart" aria-label="DM volume by month">
        <header>
          <h3>Monthly DM Volume</h3>
          <span>{xNetwork.dmMonthly.length.toLocaleString()} months</span>
        </header>
        <div>
          {xNetwork.dmMonthly.slice(-36).map((row) => {
            const max = Math.max(...xNetwork.dmMonthly.map((month) => month.sent + month.received), 1);
            return (
              <span
                key={row.month}
                title={`${row.month}: ${row.sent.toLocaleString()} sent, ${row.received.toLocaleString()} received`}
                style={{ height: `${Math.max(4, ((row.sent + row.received) / max) * 100)}%` }}
              />
            );
          })}
        </div>
      </section>
    </section>
  );
}

function BigNumber({ label, value }: { label: string; value: number | undefined }) {
  return (
    <article className="x-big-number">
      <strong>{formatCount(value)}</strong>
      <span>{label}</span>
    </article>
  );
}

function BarList({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <section className="x-bar-list" aria-label={title}>
      <h3>{title}</h3>
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <strong>{formatNumber(Math.round(row.value))}</strong>
          <i style={{ width: `${Math.max(3, (row.value / max) * 100)}%` }} />
        </div>
      ))}
    </section>
  );
}

function XNodeDrawer({ node, onClose }: { node: XNetworkNode; onClose: () => void }) {
  return (
    <aside className="x-node-drawer" aria-label={`X profile details for @${node.handle}`}>
      <header>
        <div>
          <p className="eyebrow">X profile</p>
          <h3>@{node.handle}</h3>
          <span>{node.name}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close X profile details">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <p>{node.bio || 'No bio captured in the local archive.'}</p>
      <div className="x-node-metrics">
        <BigNumber label="Score" value={Math.round(node.interactionScore)} />
        <BigNumber label="DMs" value={node.dmTotal} />
        <BigNumber label="Replies" value={node.repliesSent} />
        <BigNumber label="Mentions" value={node.mentionsSent} />
      </div>
      <dl className="x-node-detail-list">
        <div><dt>DM history</dt><dd>{formatShortDate(node.dmFirst)} to {formatShortDate(node.dmLast)}</dd></div>
        <div><dt>Sent / received</dt><dd>{node.dmSent.toLocaleString()} / {node.dmReceived.toLocaleString()}</dd></div>
        <div><dt>Retweets</dt><dd>{node.retweetsSent.toLocaleString()}</dd></div>
        <div><dt>Group DM messages</dt><dd>{node.groupDmMessages.toLocaleString()}</dd></div>
        <div><dt>Relationship</dt><dd>{node.mutual ? 'mutual' : node.followsYou ? 'follows me' : node.iFollow ? 'i follow' : 'archive-only'}</dd></div>
      </dl>
      {node.tags.length > 0 ? (
        <div className="x-drawer-tags">
          {node.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      ) : null}
      <div className="x-drawer-links">
        {node.url ? (
          <a href={node.url} target="_blank" rel="noopener noreferrer">
            Open X profile <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : null}
        {node.taggedUrl && node.taggedUrl !== node.url ? (
          <a href={node.taggedUrl} target="_blank" rel="noopener noreferrer">
            Tagged source <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </aside>
  );
}

function buildTagNamespaces(nodes: XNetworkNode[]) {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const tag of node.tags) {
      const namespace = tagNamespace(tag);
      counts.set(namespace, (counts.get(namespace) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([namespace, count]) => ({ namespace, count }))
    .sort((a, b) => b.count - a.count || a.namespace.localeCompare(b.namespace))
    .slice(0, 10);
}

function sortByScoreThenHandle(a: XNetworkNode, b: XNetworkNode): number {
  return b.interactionScore - a.interactionScore || a.handle.localeCompare(b.handle);
}

function sortNodes(nodes: XNetworkNode[], key: SortKey, direction: 'asc' | 'desc') {
  const sorted = [...nodes].sort((a, b) => {
    const multiplier = direction === 'asc' ? 1 : -1;
    if (key === 'handle') return multiplier * a.handle.localeCompare(b.handle);
    if (key === 'dmLast') return multiplier * String(a.dmLast ?? '').localeCompare(String(b.dmLast ?? ''));
    const aValue = key === 'score' ? a.interactionScore : a[key];
    const bValue = key === 'score' ? b.interactionScore : b[key];
    return multiplier * ((aValue as number) - (bValue as number));
  });
  return sorted;
}

function normalizeHandleSearch(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '');
}

function totalInteractionCount(node: XNetworkNode): number {
  return node.dmTotal + node.repliesSent + node.mentionsSent + node.retweetsSent;
}

function isSelfNode(node: XNetworkNode, accountHandle: string | undefined): boolean {
  const handle = accountHandle?.toLowerCase();
  return Boolean(handle && node.handle.toLowerCase() === handle);
}

function tagNamespace(tag: string): string {
  return tag.includes('/') ? tag.split('/')[0] : 'other';
}

function colorForNamespace(namespace: string): string {
  return TAG_NAMESPACE_COLORS[namespace] ?? '#8a93a6';
}

function colorForNode(node: XNetworkNode): string {
  const namespace = node.tags[0] ? tagNamespace(node.tags[0]) : 'other';
  const namespaceColor = TAG_NAMESPACE_COLORS[namespace];
  if (namespaceColor) {
    return namespaceColor;
  }
  return X_GRAPH_COLORS[Math.abs(hashString(`${node.handle}:${node.id}`)) % X_GRAPH_COLORS.length];
}

function nodeSize(node: XNetworkNode): number {
  return Math.max(1.55, Math.min(4.6, 1.3 + Math.log(node.interactionScore + 2) * 0.36));
}

function xGraphPosition(node: XNetworkNode, index: number, total: number): { x: number; y: number } {
  const namespace = node.tags[0] ? tagNamespace(node.tags[0]) : 'other';
  const namespaceOffset = Math.abs(hashString(namespace)) % 360;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = index * goldenAngle + (namespaceOffset * Math.PI) / 180;
  const radius = 4.6 + Math.sqrt(index + 1) * (total > 3000 ? 0.34 : 0.42);
  const scorePull = Math.max(0, Math.min(1.8, Math.log(node.interactionScore + 2) * 0.08));

  return {
    x: Math.cos(angle) * Math.max(2.8, radius - scorePull),
    y: Math.sin(angle) * Math.max(2.8, radius - scorePull),
  };
}

function xCirclePosition(index: number, total: number): { x: number; y: number } {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const normalized = Math.sqrt((index + 0.5) / Math.max(1, total));
  const angle = index * goldenAngle;
  const radius = 2.2 + 6.2 * normalized;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function resolveXGraphNodeCollisions(graph: Graphology<XGraphNodeAttributes, XGraphEdgeAttributes>): void {
  const nodes = graph.nodes().filter((node) => graph.getNodeAttribute(node, 'kind') === 'person');
  if (nodes.length < 2) {
    return;
  }

  const positions = nodes.map((node) => ({
    id: node,
    x: graph.getNodeAttribute(node, 'x'),
    y: graph.getNodeAttribute(node, 'y'),
    radius: graph.getNodeAttribute(node, 'size') * 0.092 + 0.24,
  }));
  const passes = graph.order > 3000 ? 30 : 42;
  const maxRadius = Math.max(...positions.map((position) => position.radius), 0.4);
  const cellSize = maxRadius * 2.4;

  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;
    const grid = new Map<string, number[]>();

    positions.forEach((position, index) => {
      const key = `${Math.floor(position.x / cellSize)}:${Math.floor(position.y / cellSize)}`;
      const bucket = grid.get(key) ?? [];
      bucket.push(index);
      grid.set(key, bucket);
    });

    for (let index = 0; index < positions.length; index += 1) {
      const current = positions[index];
      const cellX = Math.floor(current.x / cellSize);
      const cellY = Math.floor(current.y / cellSize);

      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const neighborIndexes = grid.get(`${cellX + offsetX}:${cellY + offsetY}`);
          if (!neighborIndexes) continue;

          for (const nextIndex of neighborIndexes) {
            if (nextIndex <= index) continue;
            const next = positions[nextIndex];
            let dx = next.x - current.x;
            let dy = next.y - current.y;
            let distance = Math.hypot(dx, dy);

            if (distance === 0) {
              const angle = ((index + 1) * 41 + (nextIndex + 1) * 19) % 360;
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              distance = 1;
            }

            const minimumDistance = current.radius + next.radius;
            if (distance >= minimumDistance) continue;

            const push = ((minimumDistance - distance) / distance) * 0.54;
            const pushX = dx * push;
            const pushY = dy * push;
            current.x -= pushX;
            current.y -= pushY;
            next.x += pushX;
            next.y += pushY;
            moved = true;
          }
        }
      }
    }

    if (!moved) {
      break;
    }
  }

  for (const position of positions) {
    graph.mergeNodeAttributes(position.id, { x: position.x, y: position.y });
  }
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function formatCount(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '0';
}

function formatNumber(value: number): string {
  return value > 0 ? value.toLocaleString() : '-';
}

function formatShortDate(value?: string | null): string {
  if (!value) return '-';
  return value.slice(0, 10);
}
