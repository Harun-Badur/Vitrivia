/** PDF-only validation. Contains no database write operation. */
import { readFile, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { canonicalizeCatalogUrl, duplicateReason, mapExpansionCategory, isGenericTitle } from './lib/seedExpansionRules';
import { detectCatalogProvider, extractCatalogExternalId } from './lib/retailProviders';
import { isFeedProvider, isGarmentCategory, isOutfitRole } from '../types/product';

async function main() {
config({ quiet: true });
const fields = ['product_url','title','brand','price','image_url','category','gender','provider','outfit_role'];
const cells: string[] = JSON.parse(await readFile('scripts/data/pdf_catalog_cells.json','utf8'));
if (fields.some((v,i)=>cells[i]!==v) || cells.length!==1359) throw new Error('PDF cell structure/count mismatch');
const rawRows = Array.from({length:150},(_,i)=>Object.fromEntries(fields.map((f,j)=>[f,cells[9+i*9+j]])));
const categoryMap: Record<string,string> = { 'üst giyim':'upper_body','gömlek':'upper_body','tişört':'upper_body','sweatshirt':'upper_body','kazak':'upper_body','ceket':'upper_body','mont':'upper_body','pantolon':'lower_body','jean':'lower_body','etek':'lower_body','şort':'lower_body','elbise':'dresses','ayakkabı':'shoes','çanta':'bags','aksesuar':'accessories' };
const parsePrice = (s:string) => {
  let n=s.replace(/\s|TL/g,'');
  if (!/^\d[\d.,]*$/.test(n)) return NaN;
  if(n.includes(',')&&n.includes('.')) n=n.lastIndexOf(',')>n.lastIndexOf('.')?n.replace(/\./g,'').replace(',','.'):n.replace(/,/g,'');
  else if(/^\d{1,3}(\.\d{3})+$/.test(n)) n=n.replace(/\./g,'');
  else n=n.replace(',','.');
  return Number(n);
};
const rows=rawRows.map(r=>({...r,price:parsePrice(r.price),category:r.outfit_role==='hat'?'hats':categoryMap[r.category]??mapExpansionCategory(r.category),gender:({'Kadın':'women','Erkek':'men','Unisex':'unisex'} as Record<string,string>)[r.gender],provider:r.provider.toLowerCase()}));
await writeFile('scripts/data/pdf_catalog_normalized.json',JSON.stringify(rows,null,2));
const base=process.env.EXPO_PUBLIC_SUPABASE_URL;
const key=process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if(!base||!key) throw new Error('Missing read-only Supabase configuration');
const get = async (table:string,query:string) => {
  const res=await fetch(`${base}/rest/v1/${table}?${query}`,{method:'GET',headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000)});
  if(!res.ok) throw new Error(`catalog_read_http_${res.status}`);
  return res.json();
};
const existing:any[]=[];
let catalogError='';
try {
  for(let offset=0;;offset+=500) {
    const page=await get('products',`select=id,provider,external_id,product_url,title,brand,price,image_url,category&order=id&limit=500&offset=${offset}`);
    existing.push(...page); if(page.length<500)break;
  }
  await get('product_attributes','select=product_id,gender,outfit_role&limit=0');

} catch(e:any) {catalogError=e.message;}
const existingIds=new Set(existing.flatMap(r=>[r.id,`${r.provider}-${r.external_id}`]));
const existingUrls=new Set(existing.flatMap(r=>{try{return [canonicalizeCatalogUrl(r.product_url)];}catch{return [];}}));
const identity=(r:any)=>JSON.stringify([String(r.brand??'').trim().toLocaleLowerCase('tr-TR'),String(r.title??'').trim().toLocaleLowerCase('tr-TR'),Number(r.price),r.image_url]);
const existingProducts=new Set(existing.map(identity));
const seenIds=new Set<string>(),seenUrls=new Set<string>(),seenProducts=new Set<string>();
const imageChecks: any[]=Array(150);
let cursor=0;
await Promise.all(Array.from({length:8},async()=>{
  for(;;){const i=cursor++;if(i>=rows.length)break;const r=rows[i];
    try {
      const u=new URL(r.image_url);if(!['http:','https:'].includes(u.protocol))throw new Error('invalid_image_url');
      const res=await fetch(u,{method:'GET',headers:{Accept:'image/*'},signal:AbortSignal.timeout(15000)});
      const type=res.headers.get('content-type')??'';
      const reader=res.body?.getReader();const chunk=await reader?.read();await reader?.cancel();
      imageChecks[i]={status:res.status,contentType:type,ok:res.ok&&type.startsWith('image/')&&!!chunk?.value?.length};
    }catch(e:any){imageChecks[i]={ok:false,error:e.cause?.code??e.message};}
  }
}));
const results=rows.map((r,i)=>{
  const reasons:string[]=[];let url=r.product_url,provider=detectCatalogProvider(url);let external_id=provider?extractCatalogExternalId(url,provider):null;
  try{url=canonicalizeCatalogUrl(url);}catch{reasons.push('invalid_product_url');}
  const id=provider&&external_id?`${provider}-${external_id}`:'';
  const dup=duplicateReason(id,url,seenIds,seenUrls,existingIds,existingUrls)??(seenProducts.has(identity(r))?'duplicate_product_in_input':existingProducts.has(identity(r))?'product_already_in_catalog':null);
  if(id)seenIds.add(id);seenUrls.add(url);seenProducts.add(identity(r));
  if(!isFeedProvider(r.provider)||!provider)reasons.push(`unsupported_provider:${r.provider}`);
  else if(provider!==r.provider)reasons.push('provider_domain_mismatch');
  if(provider&&!external_id)reasons.push('external_id_parse_failed');
  if(!r.title||isGenericTitle(r.title))reasons.push('missing_or_invalid_title');
  if(!r.brand)reasons.push('missing_brand');
  if(!Number.isFinite(r.price)||r.price<=0)reasons.push('missing_or_invalid_price');
  if(!isGarmentCategory(r.category))reasons.push('invalid_category');
  if(!isOutfitRole(r.outfit_role))reasons.push('invalid_outfit_role');
  if(!r.gender)reasons.push('invalid_gender');
  if(!r.image_url||/logo|placeholder|banner|\.svg(?:$|\?)/i.test(r.image_url))reasons.push('missing_or_invalid_image_url');
  const image=imageChecks[i];if(!image.ok)reasons.push(image.error?`image_check_error:${image.error}`:`image_unavailable:HTTP_${image.status}:${image.contentType}`);
  if(catalogError)reasons.push(`catalog_verification_failed:${catalogError}`);
  const status=dup?'duplicate':reasons.some(x=>x.startsWith('image_check_error')||x.startsWith('catalog_verification_failed'))?'failed':reasons.length?'skipped':'valid';
  return {row:i+1,status,reasons:dup?[dup,...reasons]:reasons,source:rawRows[i],normalized:r,imageCheck:image,product:{id,provider,external_id,title:r.title,brand:r.brand,price:r.price,currency:'TRY',image_url:r.image_url,images:[r.image_url],product_url:url,category:r.category,affiliate_url:null},attributes:{product_id:id,gender:r.gender,outfit_role:r.outfit_role}};
});
const counts={processed:results.length,valid:results.filter(r=>r.status==='valid').length,duplicate:results.filter(r=>r.status==='duplicate').length,skipped:results.filter(r=>r.status==='skipped').length,failed:results.filter(r=>r.status==='failed').length};
await writeFile('scripts/data/pdf_catalog_dry_run.json',JSON.stringify({mode:'dry-run',existingCount:existing.length,counts,results},null,2));
const valid=results.filter(r=>r.status==='valid');
const csvFields=['provider','external_id','title','brand','price','currency','image_url','product_url','category','affiliate_url','gender','outfit_role'];
const quote=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;
await writeFile('scripts/data/pdf_catalog_valid.csv',[csvFields.join(','),...valid.map(r=>csvFields.map(f=>quote(({...r.product,...r.attributes} as any)[f])).join(','))].join('\n')+'\n');
console.log(JSON.stringify(counts));
console.log(JSON.stringify(results.filter(r=>r.status!=='valid').map(r=>({row:r.row,title:r.normalized.title,status:r.status,reasons:r.reasons}))));

}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
