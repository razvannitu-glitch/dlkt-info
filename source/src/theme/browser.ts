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

  const bind=():void=>{
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
