// Sandbox laboratory only. No production route, no caller-supplied redirect or price.
import {StripeReadClient, STRIPE_BILLING_API_VERSION} from '../../source/src/billing/stripe-reader.js';
import {premiumPlanForPrice,PREMIUM_PLANS,type PremiumCatalog} from '../../source/src/billing/catalog.js';
import {record,field,stripeId,unixSeconds} from '../../source/src/billing/records.js';
import {isUuid} from '../../source/src/data/guards.js';

const origin='https://api.stripe.com';
const limit=256*1024;
const reject=():never=>{throw Error('BILLING_HOSTED_SESSION_REJECTED');};
const get=(v:unknown,k:string):unknown=>field(record(v),k);
const same=(v:unknown,expected:Readonly<Record<string,unknown>>):boolean=>Object.entries(expected).every(([k,x])=>get(v,k)===x);
const id=(v:unknown,prefix:string):v is string=>typeof v==='string'&&v.length<=255&&v.startsWith(prefix)&&/^[A-Za-z0-9]+$/u.test(v.slice(prefix.length));
const exactCard=(v:unknown):boolean=>Array.isArray(v)&&v.length===1&&v[0]==='card';
function fullList(v:unknown,max:number):unknown[]{
  const data=get(v,'data');
  if(get(v,'object')!=='list'||get(v,'has_more')!==false||!Array.isArray(data)||data.length>max)return reject();
  return data;
}
function httpsOrigin(v:unknown):string{
  if(typeof v!=='string'||v.length>253||/[\s\\]/u.test(v))return reject();
  const u=new URL(v);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.origin!==v||!u.hostname.includes('.'))return reject();
  return u.origin;
}
function hostedUrl(v:unknown,host:string,path:string,exact=false):string{
  if(typeof v!=='string'||v.length>4096||/[\s\\]/u.test(v))return reject();
  const u=new URL(v);
  if(u.protocol!=='https:'||u.hostname!==host||u.port||u.username||u.password||(exact?u.pathname!==path:!u.pathname.startsWith(path)))return reject();
  return v;
}
type Binding=Readonly<{ownerId:string;accountId:string;customerId:string;liveMode:false}>;
type Intent=Readonly<Binding&{intentId:string;priceId:string;createdAt:number;expiresAt:number}>;
export type Checkout=Readonly<{kind:'checkout';sessionId:string;url:string;expiresAt:number}>;
type Portal=Readonly<{kind:'portal';url:string}>;
export type Failed=Readonly<{kind:'unavailable'}>;
export type CheckoutTerminal=Readonly<{kind:'terminal';status:'expired';paymentStatus:'unpaid';sessionId:string;expiresAt:number;subscriptionId:null;itemId:null}>
  | Readonly<{kind:'terminal';status:'complete';paymentStatus:'paid';sessionId:string;expiresAt:number;subscriptionId:string;itemId:string}>;
const FAILED:Failed=Object.freeze({kind:'unavailable'});

/**
 * Private server adapter contract. The caller must load the binding and reserved
 * intent from authenticated server-owned persistence, NEVER request JSON.
 * This laboratory has no runtime route. Checkout is disabled unless the explicit
 * sandbox-only no-tax fixture gate is set. It does not grant Premium.
 */
export class SandboxHostedSessions {
  readonly #reader:StripeReadClient;
  readonly #readKey:string;
  readonly #writeKey:string;
  readonly #fetch:typeof fetch;
  readonly #account:string;
  readonly #returnOrigin:string;
  readonly #portalConfiguration:string;
  readonly #checkoutEnabled:boolean;

  constructor(catalog:unknown,readKey:unknown,writeKey:unknown,config:unknown,fetchImpl:typeof fetch=fetch){
    const account=get(catalog,'accountId'),portal=get(config,'portalConfiguration');
    if(!stripeId(account,'acct')||get(catalog,'liveMode')!==false
      ||get(config,'sandboxOnly')!==true||!id(portal,'bpc_')
      ||typeof readKey!=='string'||!/^rk_test_[A-Za-z0-9]{1,500}$/u.test(readKey)
      ||typeof writeKey!=='string'||!/^rk_test_[A-Za-z0-9]{1,500}$/u.test(writeKey)||writeKey===readKey)throw Error('BILLING_HOSTED_SESSION_REJECTED');
    this.#returnOrigin=httpsOrigin(get(config,'returnOrigin'));
    if(this.#returnOrigin===httpsOrigin(get(config,'productionOrigin')))throw Error('BILLING_HOSTED_SESSION_REJECTED');
    this.#reader=new StripeReadClient(catalog,readKey,fetchImpl);
    this.#readKey=readKey;this.#writeKey=writeKey;this.#fetch=fetchImpl;
    this.#account=account;this.#portalConfiguration=portal;
    this.#checkoutEnabled=get(config,'checkoutEnabled')===true&&get(config,'taxPolicy')==='sandbox_no_tax_fixture'
      &&get(catalog,'taxBehavior')==='inclusive';
  }

  #binding(owner:unknown,b:unknown):Binding{
    const customerId=get(b,'customerId');
    if(!isUuid(owner)||!stripeId(customerId,'cus')||!same(b,{ownerId:owner,accountId:this.#account,liveMode:false}))return reject();
    return Object.freeze({ownerId:owner,customerId,accountId:this.#account,liveMode:false});
  }

  #intent(b:Binding,i:unknown,now:unknown,recovery=false):Intent{
    const intentId=get(i,'intentId'),priceId=get(i,'priceId'),createdAt=get(i,'createdAt');
    if(!isUuid(intentId)||!stripeId(priceId,'price')||!unixSeconds(createdAt)||!unixSeconds(now)
      ||createdAt>now||(!recovery&&now-createdAt>600)||!same(i,{...b,closedAt:null}))return reject();
    const expiry=get(i,'expiresAt'),session=get(i,'sessionId');
    if((expiry!==undefined&&expiry!==createdAt+3600)||(session!==undefined&&session!==null&&!id(session,'cs_test_')))return reject();
    return Object.freeze({...b,intentId,priceId,createdAt,expiresAt:createdAt+3600});
  }

  async #call(method:'GET'|'POST',path:string,options:{query?:URLSearchParams;body?:URLSearchParams;key?:string;idempotency?:string}={}):Promise<unknown>{
    const getPath=/^\/v1\/(?:account|customers\/cus_[A-Za-z0-9]+|subscriptions|invoices|checkout\/sessions(?:\/cs_test_[A-Za-z0-9]+(?:\/line_items)?)?|billing_portal\/configurations\/bpc_[A-Za-z0-9]+)$/u;
    const postPath=/^\/v1\/(?:checkout\/sessions|billing_portal\/sessions)$/u;
    if(!(method==='GET'?getPath:postPath).test(path)|| (method==='POST'&&(!options.body||!options.idempotency)))return reject();
    const url=origin+path+(options.query?'?'+options.query.toString():'');
    const headers:Record<string,string>={Authorization:'Bearer '+(options.key??this.#readKey),'Stripe-Version':STRIPE_BILLING_API_VERSION,Accept:'application/json'};
    if(method==='POST'){
      headers['Content-Type']='application/x-www-form-urlencoded';
      headers['Idempotency-Key']=options.idempotency as string;
    }
    const init:RequestInit={method,headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)};
    if(method==='POST'){
      if(!options.body)return reject();
      init.body=options.body;
    }
    const response=await this.#fetch(url,init);
    const length=response.headers.get('content-length');
    if(response.status!==200||response.redirected||(response.url!==''&&response.url!==url)
      ||!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??'')
      ||(length!==null&&(!/^\d{1,10}$/u.test(length)||Number(length)>limit))||!response.body){
      await response.body?.cancel().catch(()=>{});return reject();
    }
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
      if(size>limit){await reader.cancel().catch(()=>{});return reject();}chunks.push(next.value);}}
    finally{reader.releaseLock();}
    if(size===0)return reject();
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size))) as unknown;
    return record(result)?result:reject();
  }

  async #context(b:Binding):Promise<PremiumCatalog>{
    const catalog=await this.#reader.loadCatalog();
    const account=await this.#call('GET','/v1/account',{key:this.#writeKey});
    if(catalog.accountId!==b.accountId||!same(account,{object:'account',id:b.accountId}))return reject();
    const customer=await this.#call('GET','/v1/customers/'+b.customerId);
    // Metadata is a defense-in-depth app marker, not evidence of ownership.
    if(!same(customer,{object:'customer',id:b.customerId,livemode:false})||get(customer,'deleted')===true
      ||!same(get(customer,'metadata'),{application:'dlkt_info',environment:'sandbox'}))return reject();
    return catalog;
  }

  async #subscriptions(b:Binding,c:PremiumCatalog):Promise<Set<string>>{
    const rows=fullList(await this.#call('GET','/v1/subscriptions',{query:new URLSearchParams({customer:b.customerId,status:'all',limit:'100'})}),100);
    const ids=new Set<string>();
    for(const s of rows){
      const subId=get(s,'id');
      if(!stripeId(subId,'sub')||ids.has(subId)||!same(s,{object:'subscription',livemode:false,customer:b.customerId}))return reject();
      const items=fullList(get(s,'items'),1);const item=items[0];const price=get(item,'price');
      if(items.length!==1||!same(item,{object:'subscription_item',subscription:subId,quantity:1})
        ||!same(price,{object:'price',livemode:false,product:c.productId,currency:'eur'})
        ||!premiumPlanForPrice(c,get(price,'id')))return reject();
      ids.add(subId);
    }
    return ids;
  }

  async #checkoutIdentity(s:unknown,i:Intent,c:PremiumCatalog):Promise<string>{
    const sessionId=get(s,'id'),plan=premiumPlanForPrice(c,i.priceId);
    if(!id(sessionId,'cs_test_')||!plan)return reject();
    const amount=PREMIUM_PLANS[plan].unitAmount;
    const success=this.#returnOrigin+'/billing/return';
    const cancel=this.#returnOrigin+'/billing/cancel';
    if(!same(s,{object:'checkout.session',livemode:false,mode:'subscription',ui_mode:'hosted_page',
      customer:i.customerId,client_reference_id:i.intentId,
      currency:'eur',amount_total:amount,amount_subtotal:amount,expires_at:i.expiresAt,success_url:success,cancel_url:cancel,
      allow_promotion_codes:false})||!exactCard(get(s,'payment_method_types'))
      ||get(get(s,'automatic_tax'),'enabled')!==false)return reject();
    const lines=fullList(await this.#call('GET','/v1/checkout/sessions/'+sessionId+'/line_items',{query:new URLSearchParams({limit:'2'})}),1);
    const line=lines[0],price=get(line,'price');
    if(lines.length!==1||!same(line,{object:'item',quantity:1,currency:'eur',amount_total:amount,amount_subtotal:amount})
      ||!same(price,{id:i.priceId,product:c.productId,livemode:false,currency:'eur',unit_amount:amount}))return reject();
    return sessionId;
  }

  async #checkoutResult(s:unknown,i:Intent,c:PremiumCatalog,now:number):Promise<Checkout>{
    const sessionId=await this.#checkoutIdentity(s,i,c);
    if(!same(s,{status:'open',payment_status:'unpaid',subscription:null})||i.expiresAt<=now)return reject();
    const url=hostedUrl(get(s,'url'),'checkout.stripe.com','/c/pay/'+sessionId,true);
    return Object.freeze({kind:'checkout',sessionId,url,expiresAt:i.expiresAt});
  }

  async createCheckout(owner:unknown,binding:unknown,intent:unknown,now:unknown):Promise<Checkout|Failed>{
    try{
      if(!this.#checkoutEnabled)return FAILED;
      if(!unixSeconds(now))return FAILED;
      const b=this.#binding(owner,binding),i=this.#intent(b,intent,now);
      const catalog=await this.#context(b);
      if(!premiumPlanForPrice(catalog,i.priceId))return FAILED;
      // First-purchase pilot. A prior subscription (even canceled) requires a
      // separate verified renewal/restart workflow, not another automatic sale.
      if((await this.#subscriptions(b,catalog)).size!==0)return FAILED;
      const sessions=fullList(await this.#call('GET','/v1/checkout/sessions',{query:new URLSearchParams({customer:b.customerId,limit:'100'})}),100);
      const persisted=get(intent,'sessionId');
      if(sessions.length!==0){
        if(sessions.length!==1||get(sessions[0],'client_reference_id')!==i.intentId
          ||(persisted!=null&&get(sessions[0],'id')!==persisted))return FAILED;
        return await this.#checkoutResult(sessions[0],i,catalog,now);
      }
      if(persisted!=null)return FAILED; // Never recreate an already attached session.
      // Stable reserved intent -> stable idempotency key and request fields.
      // Stripe permits expiry 30 min–24 h after creation. The reservation window
      // is deliberately only 10 min, so the fixed 1h expiry remains valid.
      const body=new URLSearchParams({mode:'subscription',ui_mode:'hosted_page',customer:b.customerId,
        client_reference_id:i.intentId,'line_items[0][price]':i.priceId,'line_items[0][quantity]':'1',
        'allowed_payment_method_types[0]':'card',payment_method_collection:'always',allow_promotion_codes:'false',
        'adaptive_pricing[enabled]':'false','automatic_tax[enabled]':'false',
        'after_expiration[recovery][enabled]':'false','subscription_data[billing_mode][type]':'flexible',
        success_url:this.#returnOrigin+'/billing/return',cancel_url:this.#returnOrigin+'/billing/cancel',
        expires_at:String(i.expiresAt)});
      const session=await this.#call('POST','/v1/checkout/sessions',{body,key:this.#writeKey,idempotency:'dlkt-sandbox-checkout-v1-'+i.intentId});
      return await this.#checkoutResult(session,i,catalog,now);
    }catch{return FAILED;}
  }

  /** Read-only crash recovery. No create, cancel, or expire operation; no
   * assumption that a missing response means Stripe did not create an object.
   * A terminal result is not entitlement evidence. */
  async observeCheckout(owner:unknown,binding:unknown,intent:unknown,now:unknown):Promise<Checkout|CheckoutTerminal|Failed>{
    try{
      if(!unixSeconds(now))return FAILED;
      const b=this.#binding(owner,binding),i=this.#intent(b,intent,now,true),c=await this.#context(b);
      if(!premiumPlanForPrice(c,i.priceId))return FAILED;
      const known=get(intent,'sessionId');
      const sessions=fullList(await this.#call('GET','/v1/checkout/sessions',{query:new URLSearchParams({customer:b.customerId,limit:'100'})}),100);
      if(sessions.length!==1)return FAILED;
      const candidate=get(sessions[0],'id');
      if(!id(candidate,'cs_test_')||(known!=null&&known!==candidate)||get(sessions[0],'client_reference_id')!==i.intentId)return FAILED;
      // Explicit GET by exact ID, not list metadata or a browser return URL.
      const s=await this.#call('GET','/v1/checkout/sessions/'+candidate);
      if(get(s,'id')!==candidate)return FAILED;
      const status=get(s,'status');
      if(status==='open'){
        if((await this.#subscriptions(b,c)).size!==0)return FAILED;
        return await this.#checkoutResult(s,i,c,now);
      }
      const sessionId=await this.#checkoutIdentity(s,i,c);
      if(same(s,{status:'expired',payment_status:'unpaid',subscription:null})){
        if((await this.#subscriptions(b,c)).size!==0)return FAILED;
        return Object.freeze({kind:'terminal',status:'expired',paymentStatus:'unpaid',sessionId,expiresAt:i.expiresAt,subscriptionId:null,itemId:null});
      }
      const subscriptionId=get(s,'subscription');
      if(status!=='complete'||get(s,'payment_status')!=='paid'||!stripeId(subscriptionId,'sub'))return FAILED;
      const subscriptions=await this.#subscriptions(b,c);
      if(subscriptions.size!==1||!subscriptions.has(subscriptionId))return FAILED;
      const o=await this.#reader.observeSubscription(owner,{...b,subscriptionId});
      if(o.accountId!==b.accountId||o.customerId!==b.customerId||o.subscriptionId!==subscriptionId
        ||o.priceId!==i.priceId||o.productId!==c.productId||!id(o.itemId,'si_'))return FAILED;
      return Object.freeze({kind:'terminal',status:'complete',paymentStatus:'paid',sessionId,expiresAt:i.expiresAt,subscriptionId,itemId:o.itemId});
    }catch{return FAILED;}
  }

  async createPortal(owner:unknown,binding:unknown,requestId:unknown):Promise<Portal|Failed>{
    try{
      if(!isUuid(requestId))return FAILED;
      const b=this.#binding(owner,binding),c=await this.#context(b);
      const subscriptions=await this.#subscriptions(b,c);
      // Dedicated customer must not have unrelated invoices. Portal itself
      // shows customer-level records; a product filter is not access isolation.
      const invoices=fullList(await this.#call('GET','/v1/invoices',{query:new URLSearchParams({customer:b.customerId,limit:'100'})}),100);
      for(const invoice of invoices){
        const parent=get(invoice,'parent'),sub=get(get(parent,'subscription_details'),'subscription');
        if(!same(invoice,{object:'invoice',customer:b.customerId,livemode:false})||get(parent,'type')!=='subscription_details'
          ||typeof sub!=='string'||!subscriptions.has(sub))return FAILED;
      }
      const config=await this.#call('GET','/v1/billing_portal/configurations/'+this.#portalConfiguration);
      const features=record(get(config,'features'));
      if(!same(config,{object:'billing_portal.configuration',id:this.#portalConfiguration,active:true,livemode:false})
        ||!same(get(config,'metadata'),{application:'dlkt_info',environment:'sandbox',configuration_version:'1'})
        ||get(get(config,'login_page'),'enabled')!==false||!features
        ||get(get(features,'invoice_history'),'enabled')!==true||get(get(features,'payment_method_update'),'enabled')!==true
        ||!same(get(features,'subscription_cancel'),{enabled:true,mode:'at_period_end',proration_behavior:'none'}))return FAILED;
      for(const [feature,v] of Object.entries(features)){
        if(!['invoice_history','payment_method_update','subscription_cancel'].includes(feature)&&get(v,'enabled')!==false)return FAILED;
      }
      const returnUrl=this.#returnOrigin+'/billing';
      const session=await this.#call('POST','/v1/billing_portal/sessions',{key:this.#writeKey,
        idempotency:'dlkt-sandbox-portal-v1-'+requestId,body:new URLSearchParams({customer:b.customerId,configuration:this.#portalConfiguration,return_url:returnUrl})});
      if(!id(get(session,'id'),'bps_')||!same(session,{object:'billing_portal.session',livemode:false,customer:b.customerId,configuration:this.#portalConfiguration,return_url:returnUrl}))return FAILED;
      return Object.freeze({kind:'portal',url:hostedUrl(get(session,'url'),'billing.stripe.com','/p/session/')});
    }catch{return FAILED;}
  }
}
