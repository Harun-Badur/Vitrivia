import type { WardrobeItemForCandidate } from '../intelligence/outfits/outfitCandidate';
import type { Product } from '../../types/product';
import type { OutfitDiscoverRecommendation } from '../intelligence/recommendations/discoverRecommendation';
import type { PreparedDiscoverRanking } from '../intelligence/recommendations/getDiscoverRecommendations';
import { createRecommendationMemo } from '../../lib/recommendationMemo';
import { createFinalCacheKey, createRankingCacheKey, fingerprint,
  RECOMMENDATION_CACHE_SCHEMA_VERSION, type CacheContext } from './fingerprint';
import type { CacheLookup } from './memoryCache';

type WireValue = ['literal', string | boolean | null] | ['undefined'] | ['number', string] |
  ['ref', number] | ['catalog', string] | ['wardrobe', string];
type WireNode = { type: 'array'; values: WireValue[] } | { type: 'object'; entries: [string, WireValue][] };
interface Envelope { schemaVersion: number; kind: 'ranking' | 'final'; key: string; root: WireValue; nodes: WireNode[] }

function resources<T extends WardrobeItemForCandidate>({ input }: CacheContext<T>) {
  const byObject = new Map<object, WireValue>();
  const byId = new Map<string, object>();
  const register = (kind: 'catalog' | 'wardrobe', id: string, value: object) => {
    const key = JSON.stringify([kind, id]);
    if (byId.has(key)) throw new TypeError('Duplicate snapshot ID');
    byId.set(key, value);
    byObject.set(value, [kind, id]);
  };
  input.catalogProducts.forEach(product => register('catalog', product.id, product));
  input.wardrobeItems.forEach(item => register('wardrobe', item.id, item));
  return { byObject, byId };
}

function serialize<T extends WardrobeItemForCandidate>(kind: Envelope['kind'], value: unknown, context: CacheContext<T>): string {
  const key = kind === 'ranking' ? createRankingCacheKey(context) : createFinalCacheKey(context);
  const { byObject } = resources(context);
  const nodes: WireNode[] = [];
  const ids = new Map<object, number>();
  const encode = (item: unknown): WireValue => {
    if (item === undefined) return ['undefined'];
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return ['literal', item];
    if (typeof item === 'number') return ['number', Object.is(item, -0) ? '-0' : String(item)];
    if (typeof item !== 'object') throw new TypeError('Unsupported cache value');
    const external = byObject.get(item);
    if (external) return external;
    const previous = ids.get(item);
    if (previous !== undefined) return ['ref', previous];
    const id = nodes.length;
    ids.set(item, id);
    nodes.push({ type: 'array', values: [] });
    if (Array.isArray(item)) nodes[id] = { type: 'array', values: Array.from(item, encode) };
    else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Expected a plain cache value');
      nodes[id] = { type: 'object', entries: Object.entries(item).map(([name, child]) => [name, encode(child)]) };
    }
    return ['ref', id];
  };
  const root = encode(value);
  const envelope: Envelope = { schemaVersion: RECOMMENDATION_CACHE_SCHEMA_VERSION, kind,
    key: key.fingerprint, root, nodes };
  // Integrity covers the reference graph too, independently of the context key.
  return JSON.stringify({ envelope, integrity: fingerprint(envelope) });
}

function hydrate<T extends WardrobeItemForCandidate, V>(kind: Envelope['kind'], serialized: string,
  context: CacheContext<T>, validate: (value: unknown) => value is V): CacheLookup<V> {
  try {
    const payload = JSON.parse(serialized);
    const envelope = payload.envelope as Envelope;
    if (!envelope || envelope.schemaVersion !== RECOMMENDATION_CACHE_SCHEMA_VERSION ||
      envelope.kind !== kind || payload.integrity !== fingerprint(envelope) || !Array.isArray(envelope.nodes)) {
      return { status: 'miss', reason: 'invalid-payload' };
    }
    const key = kind === 'ranking' ? createRankingCacheKey(context) : createFinalCacheKey(context);
    if (envelope.key !== key.fingerprint) return { status: 'miss', reason: 'context-mismatch' };
    const { byId } = resources(context);
    const objects = envelope.nodes.map(node => {
      if (node.type === 'array' && Array.isArray(node.values)) return [] as unknown[];
      if (node.type === 'object' && Array.isArray(node.entries)) return {} as Record<string, unknown>;
      throw new TypeError('Invalid graph node');
    });
    const decode = (token: WireValue): unknown => {
      if (!Array.isArray(token)) throw new TypeError('Invalid reference');
      if (token[0] === 'undefined' && token.length === 1) return undefined;
      if (token[0] === 'literal' && token.length === 2 && (token[1] === null || typeof token[1] === 'string' || typeof token[1] === 'boolean')) return token[1];
      if (token[0] === 'number' && token.length === 2 && typeof token[1] === 'string') {
        const number = Number(token[1]);
        if (token[1] !== 'NaN' && String(number) !== token[1] && token[1] !== '-0') throw new TypeError('Invalid number');
        return number;
      }
      if (token[0] === 'ref' && token.length === 2 && Number.isInteger(token[1]) && token[1] >= 0 && token[1] < objects.length) return objects[token[1]];
      if ((token[0] === 'catalog' || token[0] === 'wardrobe') && token.length === 2 && typeof token[1] === 'string') {
        const object = byId.get(JSON.stringify(token));
        if (object) return object;
      }
      throw new TypeError('Missing or invalid cache reference');
    };
    envelope.nodes.forEach((node, index) => {
      const object = objects[index];
      if (node.type === 'array') for (const token of node.values) (object as unknown[]).push(decode(token));
      else {
        const names = new Set<string>();
        for (const entry of node.entries) {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || names.has(entry[0])) throw new TypeError('Invalid object entry');
          names.add(entry[0]);
          Object.defineProperty(object, entry[0], { value: decode(entry[1]), enumerable: true, writable: true, configurable: true });
        }
      }
    });
    const value = decode(envelope.root);
    if (!validate(value)) return { status: 'miss', reason: 'invalid-payload' };
    return { status: 'hit', value };
  } catch { return { status: 'miss', reason: 'invalid-payload' }; }
}

function isRankedList<T extends WardrobeItemForCandidate>(value: unknown, context: CacheContext<T>): boolean {
  const catalog = new Set(context.input.catalogProducts);
  const wardrobe = new Set(context.input.wardrobeItems);
  return Array.isArray(value) && value.every(entry => entry && typeof entry.rank === 'number' &&
    Number.isFinite(entry.rank) && entry.candidate && typeof entry.candidate.id === 'string' &&
    Array.isArray(entry.candidate.items) && entry.candidate.items.every((item: Record<string, unknown>) => item &&
      (item.sourceType === 'catalog' ? catalog.has(item.product as Product) && item.sourceId === (item.product as Product).id :
        item.sourceType === 'wardrobe' && wardrobe.has(item.wardrobeItem as T) && item.sourceId === (item.wardrobeItem as T).id)) &&
    Array.isArray(entry.candidate.roles) && Array.isArray(entry.candidate.sources) &&
    entry.rankingValue && Array.isArray(entry.reasons));
}

export function serializeRanking<T extends WardrobeItemForCandidate>(prepared: PreparedDiscoverRanking<T>, context: CacheContext<T>): string {
  const { ranked, requiredProduct, diverse, firstOnly } = prepared;
  if (!isRankedList(ranked, context) || (requiredProduct !== undefined && !context.input.catalogProducts.includes(requiredProduct))) {
    throw new TypeError('Ranking must reference the supplied snapshots');
  }
  // Computation memo is process-local; it is recreated, never persisted/shared.
  return serialize('ranking', { ranked, requiredProduct, diverse, firstOnly }, context);
}

export function hydrateRanking<T extends WardrobeItemForCandidate>(serialized: string, context: CacheContext<T>): CacheLookup<PreparedDiscoverRanking<T>> {
  const result = hydrate<T, Omit<PreparedDiscoverRanking<T>, 'recommendationMemo'>>('ranking', serialized, context,
    (value): value is Omit<PreparedDiscoverRanking<T>, 'recommendationMemo'> => {
      if (!value || typeof value !== 'object') return false;
      const entry = value as Omit<PreparedDiscoverRanking<T>, 'recommendationMemo'>;
      return isRankedList(entry.ranked, context) && typeof entry.diverse === 'boolean' &&
        (entry.requiredProduct === undefined || context.input.catalogProducts.includes(entry.requiredProduct)) &&
        (entry.firstOnly === undefined || typeof entry.firstOnly === 'boolean');
    });
  return result.status === 'hit' ? { status: 'hit', value: { ...result.value, recommendationMemo: createRecommendationMemo() } } : result;
}

export function serializeFinal<T extends WardrobeItemForCandidate>(result: readonly OutfitDiscoverRecommendation<T>[], context: CacheContext<T>): string {
  if (!isFinalList(result, context)) throw new TypeError('Result must reference the supplied snapshots');
  return serialize('final', result, context);
}

function isFinalList<T extends WardrobeItemForCandidate>(value: unknown, context: CacheContext<T>): boolean {
  return isRankedList(value, context) && (value as OutfitDiscoverRecommendation<T>[]).every(entry => entry.type === 'outfit' &&
    Array.isArray(entry.sources) && (entry.displayProducts === undefined || (Array.isArray(entry.displayProducts) &&
      entry.displayProducts.every(product => entry.candidate.items.some(item => item.sourceType === 'catalog' && item.product === product)))));
}

export function hydrateFinal<T extends WardrobeItemForCandidate>(serialized: string, context: CacheContext<T>): CacheLookup<readonly OutfitDiscoverRecommendation<T>[]> {
  return hydrate('final', serialized, context, (value): value is readonly OutfitDiscoverRecommendation<T>[] =>
    isFinalList(value, context));
}
