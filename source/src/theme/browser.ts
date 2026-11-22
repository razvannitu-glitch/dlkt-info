/** Apply an explicit appearance choice before styles, independently of reader data. */
(():void=>{
  'use strict';
  type ReaderTheme='prism'|'night';
  const preferenceKey='dlkt-reader-theme-v1';
  const root=document.documentElement;
  let theme:ReaderTheme='prism';

  try{
    const saved=window.localStorage.getItem(preferenceKey);
    if(saved==='prism'||saved==='night')theme=saved;
  }catch{
    // Public reading and its default appearance do not depend on browser storage.
  }
  root.dataset.readerTheme=theme;

  const bindCardSurfaces=():void=>{
    const surfaces=['paper','ivory','coral','berry','wine','gold'] as const;
    type CardSurface=typeof surfaces[number];
    const readerRoots='#discovery-cards,#home-local-cards,#world-cards,#cards,#daily-cards,#local-cards,#edition-content';
    const cycle=(previous:CardSurface|undefined):CardSurface[]=>{
      const values:CardSurface[]=[...surfaces];
      const swap=(left:number,right:number):void=>{
        const a=values[left],b=values[right];
        if(a!==undefined&&b!==undefined){values[left]=b;values[right]=a;}
      };
      for(let index=values.length-1;index>0;index--)swap(index,Math.floor(Math.random()*(index+1)));
      if(values[0]===previous)swap(0,1+Math.floor(Math.random()*(values.length-1)));
      return values;
    };
    for(const host of document.querySelectorAll<HTMLElement>(readerRoots)){
      // Appearance belongs to a reading position, never to a story or its data.
      // Keep complete cycles only; an empty loading state retains one small prefix.
      const sequence:CardSurface[]=[];
      const paint=():void=>{
        const cards=host.querySelectorAll<HTMLElement>('.info-card');
        const needed=Math.ceil(cards.length/surfaces.length)*surfaces.length;
        while(sequence.length<needed)sequence.push(...cycle(sequence[sequence.length-1]));
        cards.forEach((card,index)=>{
          const surface=sequence[index];
          if(surface!==undefined&&card.dataset.readerSurface!==surface)card.dataset.readerSurface=surface;
        });
        sequence.length=Math.max(needed,Math.min(sequence.length,surfaces.length));
      };
      new MutationObserver(paint).observe(host,{childList:true,subtree:true});
      paint();
    }
  };

  const bind=():void=>{
    bindCardSurfaces();
    const button=document.getElementById('reader-theme-toggle');
    if(!(button instanceof HTMLButtonElement))return;

    const describe=():void=>{
      const night=theme==='night';
      const label=night?'Switch to light mode':'Switch to dark mode';
      button.dataset.i18nLabel=night?'switchToLightMode':'switchToDarkMode';
      button.title=label;
      button.setAttribute('aria-label',label);
    };
    const notify=():void=>{
      document.dispatchEvent(new CustomEvent('dlkt:theme-changed',{detail:Object.freeze({theme})}));
    };

    button.addEventListener('click',()=>{
      theme=theme==='prism'?'night':'prism';
      root.dataset.readerTheme=theme;
      describe();
      try{
        window.localStorage.setItem(preferenceKey,theme);
      }catch{
        // The current appearance remains usable when the browser refuses persistence.
      }
      notify();
    });

    describe();
    // Module-based translations may already be ready when DOMContentLoaded runs.
    notify();
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
