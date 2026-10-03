import type { Product } from '../types/product';
import { getSupabaseClient } from '../lib/supabase';
import { enrichProduct } from '../src/intelligence/style/productStyle';
import { isAttributeRow, isFeedProductRow, mapFeedRow } from './catalogProductAdapter';

/** Identity map for products-table records. Recommendation metadata lives outside it. */
export class ProductRepository {
  private readonly products = new Map<string, Product>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly load: (ids: readonly string[]) => Promise<readonly Product[]>) {}

  /** Register only authoritative catalog records; refresh data without replacing identity. */
  register(products: readonly Product[]): Product[] {
    return products.map(product => {
      const canonical = this.products.get(product.id);
      if (!canonical) {
        this.products.set(product.id, product);
        return product;
      }
      if (canonical !== product) {
        for (const key of Object.keys(canonical) as (keyof Product)[]) {
          if (!Object.hasOwn(product, key)) delete canonical[key];
        }
        Object.assign(canonical, product);
      }
      return canonical;
    });
  }

  /** One batched fetch for misses, including coalescing overlapping concurrent requests. */
  async productsById(ids: readonly string[]): Promise<ReadonlyMap<string, Product>> {
    const unique = [...new Set(ids)];
    const missing = unique.filter(id => !this.products.has(id) && !this.pending.has(id));
    if (missing.length > 0) {
      const request = Promise.resolve().then(() => this.load(missing)).then(products => {
        this.register(products);
      }).finally(() => {
        for (const id of missing) if (this.pending.get(id) === request) this.pending.delete(id);
      });
      for (const id of missing) this.pending.set(id, request);
    }
    await Promise.all(unique.flatMap(id => this.pending.has(id) ? [this.pending.get(id)!] : []));
    return new Map(unique.flatMap(id => {
      const product = this.products.get(id);
      return product ? [[id, product] as const] : [];
    }));
  }
}

type Client = ReturnType<typeof getSupabaseClient>;
type QueryResult = { data: unknown[] | null; error: { message: string } | null };
let repositoryClient: Client;
let repository: ProductRepository | undefined;

export function getProductRepository(): ProductRepository {
  const client = getSupabaseClient();
  if (!repository || repositoryClient !== client) {
    repositoryClient = client;
    repository = new ProductRepository(ids => loadProductsById(client, ids));
  }
  return repository;
}

/** Shared bulk resolver; never reads product snapshots from recommendation payloads. */
export const productsById = (ids: readonly string[]): Promise<ReadonlyMap<string, Product>> =>
  getProductRepository().productsById(ids);

async function loadProductsById(client: Client, ids: readonly string[]): Promise<Product[]> {
  if (!client) throw new Error('Supabase bağlantısı yok');
  const products: Product[] = [];
  // Bound query URLs without changing the Discover candidate pool or pagination.
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80);
    const columns = 'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, images, product_url, category, affiliate_url, colors, sizes, created_at';
    let result: QueryResult = await client.from('products').select(columns).in('id', batch);
    if (result.error && /column .*images.* does not exist/i.test(result.error.message)) {
      result = await client.from('products').select(columns.replace(', images', '')).in('id', batch);
    }
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []).filter(isFeedProductRow);
    if (rows.length === 0) continue;
    let attributes: QueryResult = await client.from('product_attributes')
      .select('product_id, gender, colors, fit, subcategory, brand_slug, price_band, outfit_role')
      .in('product_id', rows.map(row => row.id));
    if (attributes.error && /column .*outfit_role.* does not exist/i.test(attributes.error.message)) {
      attributes = await client.from('product_attributes')
        .select('product_id, gender, colors, fit, subcategory, brand_slug, price_band')
        .in('product_id', rows.map(row => row.id));
    }
    const attributesById = new Map((attributes.data ?? []).filter(isAttributeRow).map(row => [row.product_id, row]));
    for (const row of rows) {
      const product = mapFeedRow(row);
      if (product) products.push(enrichProduct(product, attributesById.get(product.id)));
    }
  }
  return products;
}
