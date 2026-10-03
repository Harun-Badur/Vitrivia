/** Inserts only the approved PDF VALID rows; never updates existing rows. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { canonicalizeCatalogUrl, duplicateReason } from './lib/seedExpansionRules';
import { isFeedProvider, isGarmentCategory, isOutfitRole } from '../types/product';

async function main() {
  config({ quiet: true });
  const source = await readFile('scripts/data/pdf_catalog_dry_run.json', 'utf8');
  const dry = JSON.parse(source);
  const approved = dry.results.filter((r: any) => r.status === 'valid');
  if (dry.mode !== 'dry-run' || dry.results.length !== 150 || approved.length !== 120 || dry.results.filter((r: any) => r.status === 'skipped').length !== 30) throw new Error('Approved dry-run counts mismatch');
  for (const r of approved) {
    for (const f of ['title', 'brand', 'price', 'image_url', 'category', 'provider']) if (r.product[f] !== r.normalized[f]) throw new Error(`Approved field mismatch: ${r.row}/${f}`);
    for (const f of ['gender', 'outfit_role']) if (r.attributes[f] !== r.normalized[f]) throw new Error(`Approved attribute mismatch: ${r.row}/${f}`);
    if (!isFeedProvider(r.product.provider) || !isGarmentCategory(r.product.category) || !isOutfitRole(r.attributes.outfit_role) || !['women','men','unisex'].includes(r.attributes.gender)) throw new Error(`Invalid approved enums: ${r.row}`);
  }
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing import credentials');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const readAll = async (table: string, order: string) => {
    const all: any[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from(table).select('*').order(order).range(offset, offset + 499);
      if (error) throw new Error(`${table}_read:${error.message}`);
      all.push(...data); if (data.length < 500) return all;
    }
  };
  const before = await readAll('products','id');
  const attrsBefore = await readAll('product_attributes','product_id');
  await writeFile('scripts/data/pdf_catalog_before_import.json',JSON.stringify({products:before,attributes:attrsBefore},null,2));
  const ids = new Set<string>(before.flatMap(r => [r.id,`${r.provider}-${r.external_id}`]));
  const urls = new Set<string>(before.flatMap(r => { try { return [canonicalizeCatalogUrl(r.product_url)]; } catch { return []; } }));
  const identity = (r:any) => JSON.stringify([String(r.brand??'').trim().toLocaleLowerCase('tr-TR'),String(r.title??'').trim().toLocaleLowerCase('tr-TR'),Number(r.price),r.image_url]);
  const products = new Set(before.map(identity));
  const seenIds = new Set<string>(), seenUrls = new Set<string>(), seenProducts = new Set<string>();
  const duplicates: any[] = [], pending: any[] = [];
  for (const r of approved) {
    const p = r.product, canonical = canonicalizeCatalogUrl(p.product_url);
    const reason = duplicateReason(p.id,canonical,seenIds,seenUrls,ids,urls) ?? (products.has(identity(p)) ? 'product_already_in_catalog' : seenProducts.has(identity(p)) ? 'duplicate_product_in_input' : null);
    seenIds.add(p.id); seenUrls.add(canonical); seenProducts.add(identity(p));
    if (reason) duplicates.push({row:r.row,id:p.id,reason}); else pending.push(r);
  }
  const report:any = {sourceSha256:createHash('sha256').update(source).digest('hex'),before:before.length,approved:120,excludedSkipped:30,duplicates,insertedIds:[],status:'preflight_complete',failures:[],rollback:'not_needed'};
  const save = () => writeFile('scripts/data/pdf_catalog_import_result.json',JSON.stringify(report,null,2));
  await save();
  console.log(JSON.stringify({before:before.length,pending:pending.length,duplicates:duplicates.length}));
  if (pending.length) {
    report.status='inserting_products'; await save();
    const {data, error} = await db.from('products').insert(pending.map(r=>r.product)).select('id');
    if (error) { report.status='products_insert_failed'; report.failures.push(error.message); }
    else {
      report.insertedIds=data.map(r=>r.id); report.status='inserting_attributes'; await save();
      const {error: attrError} = await db.from('product_attributes').insert(pending.map(r=>r.attributes));
      if(attrError) {
        report.failures.push(`attributes_insert:${attrError.message}`);
        report.status='rolling_back'; await save();
        const {error: rollbackError} = await db.from('products').delete().in('id',report.insertedIds);
        report.rollback=rollbackError?`failed:${rollbackError.message}`:'completed';
        report.status=rollbackError?'rollback_failed':'rolled_back';
      } else report.status='inserted';
    }
  } else report.status='no_new_rows';
  await save();
  const after = await readAll('products','id');
  const attrsAfter = await readAll('product_attributes','product_id');
  const stable=(v:any):string=>JSON.stringify(v,Object.keys(v).sort());
  const afterById=new Map(after.map(r=>[r.id,r]));
  const attrsById=new Map(attrsAfter.map(r=>[r.product_id,r]));
  report.existingProductsUnchanged=before.every(r=>afterById.has(r.id)&&stable(r)===stable(afterById.get(r.id)));
  report.existingAttributesUnchanged=attrsBefore.every(r=>attrsById.has(r.product_id)&&stable(r)===stable(attrsById.get(r.product_id)));
  report.after=after.length;
  report.added=after.filter(r=>!ids.has(r.id)).length;
  report.verifiedImported= pending.filter(r=>{
    const p=afterById.get(r.product.id),a=attrsById.get(r.product.id);
    return p&&a&&Object.entries(r.product).every(([f,v])=>f==='images'?JSON.stringify(p[f])===JSON.stringify(v):p[f]===v)&&Object.entries(r.attributes).every(([f,v])=>a[f]===v);
  }).length;
  report.skippedIdsImported=dry.results.filter((r:any)=>r.status==='skipped'&&r.product.id&&afterById.has(r.product.id)&&!ids.has(r.product.id)).map((r:any)=>r.product.id);
  if(report.status==='inserted'&&(report.verifiedImported!==pending.length||!report.existingProductsUnchanged||!report.existingAttributesUnchanged||report.skippedIdsImported.length)) {report.failures.push('post_import_verification_failed');report.status='verification_failed';}
  await save();
  console.log(JSON.stringify(report));
}
main().catch(async e=>{console.error(e.message);process.exitCode=1;});
