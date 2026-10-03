import { DISCOVER_CATALOG_PAGE_SIZE, isAttributeRow, isFeedProductRow, isRecord, mapFeedRow } from '../../services/catalogProductAdapter';
import { enrichProduct } from '../../src/intelligence/style/productStyle';
import { decodeSnapshot, encodeSnapshot } from '../../src/recommendationCache/feedPacket';
import { RECOMMENDATION_ENGINE_VERSION } from '../../src/recommendationCache/fingerprint';
import type { ImportPreparationInput } from './recommendationCacheWorker';

const SNAPSHOT_FORMAT = 'discover-import-snapshot-v1';

/** Offline export of products/product_attributes, not a separately reconstructed Product model. */
export function createDiscoverImportSnapshot(raw: unknown, catalogVersion?: string): ImportPreparationInput {
  if (!isRecord(raw) || !Array.isArray(raw.products) || !Array.isArray(raw.attributes)) {
    throw new Error('Expected a raw catalog export with products and attributes arrays');
  }
  const rows = raw.products;
  if (rows.length !== 278 || !rows.every(isFeedProductRow) || new Set(rows.map(row => row.id)).size !== 278) {
    throw new Error('V1 requires exactly 278 valid, unique catalog rows');
  }
  if (!raw.attributes.every(isAttributeRow) || new Set(raw.attributes.map(row => row.product_id)).size !== raw.attributes.length) {
    throw new Error('Invalid or duplicate product_attributes rows');
  }
  const timestamp = (row: typeof rows[number]): bigint | null => {
    if (row.created_at === null || row.created_at === undefined) return null;
    if (typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) {
      throw new Error('Invalid created_at ordering value');
    }
    // PostgreSQL timestamps retain microseconds; Date alone would change tied order.
    const fraction = row.created_at.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? '';
    if (fraction.length > 6) throw new Error('Unsupported created_at precision');
    return BigInt(Date.parse(row.created_at)) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3, 6));
  };
  // Same database order as productService: created_at ascending (nulls last), then id.
  const ordered = rows.map(row => ({ row, at: timestamp(row) })).sort((a, b) =>
    (a.at === b.at ? 0 : a.at === null ? 1 : b.at === null ? -1 : a.at < b.at ? -1 : 1) ||
    (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
  const attributes = new Map(raw.attributes.map(row => [row.product_id, row]));
  const anchors = ordered.map(({ row }) => {
    const product = mapFeedRow(row);
    if (!product) throw new Error(`Unsupported Discover product: ${row.id}`);
    return enrichProduct(product, attributes.get(row.id));
  });
  return { candidatePool: anchors.slice(0, DISCOVER_CATALOG_PAGE_SIZE), anchors,
    engineVersion: RECOMMENDATION_ENGINE_VERSION, catalogVersion };
}

/** Plain JSON drops explicit undefined fields and would invalidate Discover keys. */
export function serializeDiscoverImportSnapshot(snapshot: ImportPreparationInput): string {
  return JSON.stringify({ format: SNAPSHOT_FORMAT, snapshot: encodeSnapshot(snapshot) });
}

/** Also retains support for existing, ordinary CLI JSON snapshots. */
export function parseRecommendationCliSnapshot<T>(text: string): T {
  const value: unknown = JSON.parse(text);
  if (isRecord(value) && 'format' in value) {
    if (value.format !== SNAPSHOT_FORMAT || typeof value.snapshot !== 'string') throw new Error('Unsupported import snapshot format');
    return decodeSnapshot<T>(value.snapshot);
  }
  return value as T;
}
