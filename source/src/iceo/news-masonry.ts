/** Pixel placement keeps DOM order and does not create an unbounded grid track list. */
export interface NewsPlacement {readonly column:number;readonly top:number;readonly height:number}
export function newsMasonryPositions(heights:readonly number[],columns:number,gap=16):readonly NewsPlacement[] {
  const count=Math.max(1,Math.min(4,Math.trunc(columns)||1)),space=Math.max(0,Number.isFinite(gap)?gap:0),bottoms=Array<number>(count).fill(0);
  return heights.map(value=>{
    const height=Math.max(1,Number.isFinite(value)?value:1),top=Math.min(...bottoms),column=bottoms.indexOf(top);
    bottoms[column]=top+height+space;return {column:column+1,top,height};
  });
}
/** The DOM stays ordered; one controller owns layout, anchoring and observer cleanup. */
export class NewsMasonry {
  private readonly cards=new Set<HTMLElement>();
  private observer:ResizeObserver|null=null;
  private frame:number|null=null;
  private disposed=false;
  private width=-1;
  private readonly win:Window;
  constructor(private readonly root:HTMLElement) {
    const win=root.ownerDocument.defaultView;if(win===null)throw new Error('NEWS_LAYOUT_WINDOW_MISSING');this.win=win;
    if(typeof ResizeObserver==='function'){
      this.observer=new ResizeObserver(entries=>{
        let changed=false;
        for(const entry of entries){
          if(entry.target===this.root){
            if(Math.abs(entry.contentRect.width-this.width)>.5){this.width=entry.contentRect.width;changed=true;}
          }else if(this.cards.has(entry.target as HTMLElement))changed=true;
        }
        if(changed)this.schedule();
      });
      this.observer.observe(root);
    }
    win.addEventListener('resize',this.schedule);
    root.addEventListener('load',this.schedule,true);root.addEventListener('error',this.schedule,true);root.addEventListener('toggle',this.schedule,true);
    void root.ownerDocument.fonts?.ready.then(()=>this.schedule());
  }
  private readonly schedule=():void=>{
    if(this.disposed||this.frame!==null)return;
    this.frame=this.win.requestAnimationFrame(()=>{this.frame=null;this.layout(true);});
  };
  /** Synchronous placement comes before installing the progressive-load sentinel. */
  update():void {
    if(this.disposed)return;
    const next=new Set(this.root.querySelectorAll<HTMLElement>(':scope > [data-news-stream-key]'));
    for(const card of this.cards)if(!next.has(card)){this.observer?.unobserve(card);this.cards.delete(card);}
    for(const card of next)if(!this.cards.has(card)){this.cards.add(card);this.observer?.observe(card);}
    this.layout(false);
  }
  private layout(preserveAnchor:boolean):void {
    if(this.disposed||!this.root.isConnected)return;
    if(this.frame!==null){this.win.cancelAnimationFrame(this.frame);this.frame=null;}
    const cards=[...this.root.querySelectorAll<HTMLElement>(':scope > [data-news-stream-key]')];
    if(!cards.length){delete this.root.dataset.newsMasonry;this.root.style.removeProperty('height');return;}
    const focused=this.root.ownerDocument.activeElement?.closest<HTMLElement>('[data-news-stream-key]');
    const visible=(card:HTMLElement):boolean=>{const rect=card.getBoundingClientRect();return rect.top<this.win.innerHeight&&rect.bottom>0;};
    const anchor=preserveAnchor?(focused&&this.cards.has(focused)&&visible(focused)?focused:cards.find(visible)):undefined;
    const before=anchor?.getBoundingClientRect().top;
    const columns=Math.max(1,Math.min(4,Math.trunc(Number(this.win.getComputedStyle(this.root).getPropertyValue('--news-columns')))||1));
    const available=this.root.getBoundingClientRect().width;if(available<=0)return;
    const cardWidth=Math.max(0,(available-(columns-1)*16)/columns);
    this.root.dataset.newsMasonry='true';
    for(const card of cards)card.style.width=cardWidth+'px';
    const positions=newsMasonryPositions(cards.map(card=>card.getBoundingClientRect().height),columns,16);
    let bottom=0;
    cards.forEach((card,index)=>{
      const position=positions[index];if(position===undefined)return;
      card.style.insetInlineStart=((position.column-1)*(cardWidth+16))+'px';card.style.top=position.top+'px';
      bottom=Math.max(bottom,position.top+position.height);
    });
    this.root.style.height=bottom+'px';
    if(anchor&&before!==undefined&&anchor.isConnected){
      const delta=anchor.getBoundingClientRect().top-before;if(Math.abs(delta)>.5)this.win.scrollBy(0,delta);
    }
  }
  disconnect():void {
    if(this.disposed)return;this.disposed=true;this.observer?.disconnect();this.observer=null;
    if(this.frame!==null)this.win.cancelAnimationFrame(this.frame);this.frame=null;
    this.win.removeEventListener('resize',this.schedule);
    this.root.removeEventListener('load',this.schedule,true);this.root.removeEventListener('error',this.schedule,true);this.root.removeEventListener('toggle',this.schedule,true);
    for(const card of this.cards){card.style.removeProperty('width');card.style.removeProperty('inset-inline-start');card.style.removeProperty('top');}
    this.cards.clear();delete this.root.dataset.newsMasonry;this.root.style.removeProperty('height');
  }
}
