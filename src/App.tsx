import { useEffect, useState } from 'react';
import { XNetworkView } from './x/XNetworkView';
import { loadXNetwork } from './loadXNetwork';
import type { XNetwork } from './types';

export default function App() {
  const [xNetwork, setXNetwork] = useState<XNetwork | null>(null);

  useEffect(() => {
    let active = true;
    loadXNetwork().then((network) => {
      if (active) setXNetwork(network);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!xNetwork) {
    return (
      <main className="app-shell">
        <section className="loading-panel">Loading X Circle...</section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <XNetworkView xNetwork={xNetwork} />
    </main>
  );
}
