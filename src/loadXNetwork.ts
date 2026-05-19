import { sampleXNetwork } from './data/sampleXNetwork';
import type { XNetwork } from './types';

const GENERATED_DATA_PATH = '/generated/x-network.json';

export async function loadXNetwork(): Promise<XNetwork> {
  try {
    const response = await fetch(GENERATED_DATA_PATH, { cache: 'no-store' });
    if (!response.ok) {
      return sampleXNetwork;
    }
    return (await response.json()) as XNetwork;
  } catch {
    return sampleXNetwork;
  }
}
