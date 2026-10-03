import type { Product } from '../../types/product';
import type { WardrobeItemForCandidate } from '../intelligence/outfits/outfitCandidate';
import { fingerprint, type CacheContext } from './fingerprint';

export interface FeedPacketRequest {
  sessionId: string;
  generation: number;
  contextFingerprint: string;
  candidatePool: readonly Product[];
  anchors: readonly Product[];
  wardrobeItems: readonly WardrobeItemForCandidate[];
  exposure: [string, number][];
  shownAnchorIds: string[];
  /** Shown IDs whose pinned product snapshot still matches this batch. */
  reusableAnchorIds?: string[];
}
export interface FeedPacketEntry {
  anchorProductId: string;
  exposure: [string, number][];
  catalogVersion?: string;
  serialized: string;
}
export interface RecommendationFeedPacket {
  sessionId: string;
  generation: number;
  contextFingerprint: string;
  entries: FeedPacketEntry[];
}
export function anchorContext(candidatePool: readonly Product[], anchor: Product,
  wardrobeItems: readonly WardrobeItemForCandidate[], exposure?: ReadonlyMap<string, number>, catalogVersion?: string): CacheContext {
  if (candidatePool.length > 80 || new Set(candidatePool.map(product => product.id)).size !== candidatePool.length) throw new Error('Invalid 80-product pool');
  return { catalogVersion, input: { catalogProducts: [anchor, ...candidatePool.filter(product => product.id !== anchor.id)],
    requiredCatalogProductId: anchor.id, firstOnly: true, wardrobeItems,
    recommendationExposure: exposure === undefined ? undefined : new Map(exposure) } };
}

/** Lossless transport for the same canonical snapshots used by the cache codec. */
export const encodeSnapshot = fingerprint;
export function decodeSnapshot<T>(serialized: string): T {
  const decode = (node: unknown): unknown => {
    if (!Array.isArray(node)) throw new Error('Invalid snapshot');
    const [kind, value] = node;
    if (kind === 'undefined' && node.length === 1) return undefined;
    if (kind === 'object' && value === null) return null;
    if ((kind === 'string' && typeof value === 'string') || (kind === 'boolean' && typeof value === 'boolean')) return value;
    if (kind === 'number' && typeof value === 'string') return Number(value);
    if (kind === 'array' && Array.isArray(value)) return value.map(decode);
    if (kind === 'object' && Array.isArray(value)) {
      const result: Record<string, unknown> = {};
      for (const entry of value) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || Object.hasOwn(result, entry[0])) throw new Error('Invalid snapshot entry');
        Object.defineProperty(result, entry[0], { value: decode(entry[1]), enumerable: true, writable: true });
      }
      return result;
    }
    throw new Error('Invalid snapshot token');
  };
  return decode(JSON.parse(serialized)) as T;
}
