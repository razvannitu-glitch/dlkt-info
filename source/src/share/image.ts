import {createRequire} from 'node:module';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import type satoriType from 'satori';
import {createElement as h} from 'react';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {IMAGE_WIDTH,IMAGE_HEIGHT,previewPlan} from './preview.js';
import {BRAND_NAME,BRAND_DESCRIPTOR} from '../brand/identity.js';
import type {EvidenceCard} from '../iceo/contracts.js';
const satori=(createRequire(import.meta.url)('satori') as {default:typeof satoriType}).default;
let rendererReady:Promise<void>|undefined;
let font:Buffer|undefined;
function prepareRenderer():Promise<void>{
 if(!rendererReady)rendererReady=initWasm(readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));
 return rendererReady;
}
let kate:string|undefined;
function kateImage():string {
 if(kate)return kate;const b=readFileSync(resolve(process.cwd(),'public/kate-head.png'));
 if(b.length>200000||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PREVIEW_ASSET_INVALID');
 kate='data:image/png;base64,'+b.toString('base64');return kate;
}
/** No remote image, font or emoji URL is supplied. Every text value has passed previewPlan's ASCII boundary. */
export async function renderCardImage(card:EvidenceCard):Promise<Uint8Array> {
 const p=previewPlan(card),bg=p.tone===1?'#000000':p.tone===2?'#F66061':'#FFFFFF',ink=p.tone===1?'#FFFFFF':'#000000',accent=p.tone===2?'#000000':'#F66061';
 const row=(text:string,size:number,style:Record<string,string|number>={})=>h('div',{style:{display:'flex',fontSize:size,lineHeight:1.3,...style}},text);
 const element=h('div',{style:{width:IMAGE_WIDTH,height:IMAGE_HEIGHT,display:'flex',flexDirection:'column',background:bg,color:ink,padding:'38px 48px',borderLeft:`12px solid ${accent}`,justifyContent:'space-between'}},
  h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between'}},h('div',{style:{display:'flex',alignItems:'center',gap:16}},h('img',{src:kateImage(),width:64,height:64,alt:''}),row(BRAND_NAME,46,{fontWeight:700})),row(p.topic,22,{background:accent,color:p.tone===2?'#FFFFFF':'#000000',padding:'10px 16px',borderRadius:6})),
  h('div',{style:{display:'flex',flexDirection:'column',gap:7}},row(p.publisher,20),...(!p.generic?[row(p.original.replace(/(.{70})/gu,'$1\n'),15,{whiteSpace:'pre-wrap'}),...(p.byline?[row(p.byline,16)]:[])]:[])),
  h('div',{style:{display:'flex',flexDirection:'column',gap:12}},row(p.title,p.generic?42:p.title.length>145?40:48,{fontWeight:700,lineHeight:1.18}),...(p.excerpt?[row(p.excerpt,20)]:[])),
  h('div',{style:{display:'flex',flexDirection:'column',gap:6}},...(p.license?[row(p.license,13)]:[]),row(p.date+' | '+p.checked,17),row(BRAND_DESCRIPTOR,19,{fontWeight:700}),row(p.cardUrl,14)));
 await prepareRenderer();font??=readFileSync(resolve(process.cwd(),'src/share/assets/noto-sans.ttf'));
 const svg=await satori(element,{width:IMAGE_WIDTH,height:IMAGE_HEIGHT,fonts:[{name:'Noto Sans',data:font,weight:400,style:'normal'}]});
 const renderer=new Resvg(svg,{fitTo:{mode:'width',value:IMAGE_WIDTH}});
 try{const rendered=renderer.render();try{return Uint8Array.from(rendered.asPng());}finally{rendered.free();}}finally{renderer.free();}
}
export function validPreviewPng(bytes:Uint8Array):boolean {
 if(bytes.length<24||bytes.length>1048576||Buffer.from(bytes.subarray(0,8)).toString('hex')!=='89504e470d0a1a0a'||Buffer.from(bytes.subarray(12,16)).toString()!=='IHDR')return false;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return view.getUint32(16)===IMAGE_WIDTH&&view.getUint32(20)===IMAGE_HEIGHT;
}
/** At most two renders, sixteen cached PNGs and eight seconds waiting per request. Slots outlive timed-out callers. */
export class CardImageService {
 private readonly cache=new Map<string,{bytes:Uint8Array;until:number}>();
 private readonly pending=new Map<string,Promise<Uint8Array>>();
 constructor(private readonly render:(card:EvidenceCard)=>Promise<Uint8Array>=renderCardImage,private readonly clock:()=>number=Date.now){}
 async read(card:EvidenceCard,validUntil:number):Promise<Uint8Array>{
  if(!Number.isFinite(validUntil)||validUntil<=this.clock())throw Error('PREVIEW_EXPIRED');
  for(const[k,v]of this.cache)if(v.until<=this.clock())this.cache.delete(k);
  const key=createHash('sha256').update(JSON.stringify(previewPlan(card))).digest('hex'),cached=this.cache.get(key);
  if(cached)return Uint8Array.from(cached.bytes);
  let work=this.pending.get(key);
  if(!work){
   if(this.pending.size>=2)throw Error('PREVIEW_BUSY');
   work=Promise.resolve().then(()=>this.render(card)).then(bytes=>{if(!validPreviewPng(bytes))throw Error('PREVIEW_PNG_INVALID');if(this.clock()>=validUntil)throw Error('PREVIEW_EXPIRED');while(this.cache.size>=16){const oldest=this.cache.keys().next().value;if(oldest===undefined)break;this.cache.delete(oldest);}this.cache.set(key,{bytes:Uint8Array.from(bytes),until:validUntil});return bytes;}).finally(()=>{this.pending.delete(key);});
   this.pending.set(key,work);
  }
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return Uint8Array.from(await Promise.race([work,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('PREVIEW_TIMEOUT')),8000);})]));}finally{if(timer)clearTimeout(timer);}
 }
}
export const cardImageService=new CardImageService();
