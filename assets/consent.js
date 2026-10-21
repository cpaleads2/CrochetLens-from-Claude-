/* Баннер согласия на cookie + подключение аналитики Google Analytics 4.
   Включается ТОЛЬКО если в assets/config.js задан GA_ID (например 'G-XXXXXXXXXX'). Пока GA_ID пуст — баннера нет и ничего не загружается.
   Аналитика грузится после явного «Принять»; «Отклонить» ничего не загружает. Выбор хранится в localStorage (cl_consent). */
(function(){
  var id=(window.CL_CONFIG&&window.CL_CONFIG.GA_ID)||'';
  if(!/^G-[A-Z0-9]+$/.test(id)) return;
  var KEY='cl_consent';
  function get(){try{return localStorage.getItem(KEY);}catch(e){return null;}}
  function set(v){try{localStorage.setItem(KEY,v);}catch(e){}}
  function lang(){var l='en';try{l=localStorage.getItem('cl_lang')||document.documentElement.lang||'en';}catch(e){}return /^(ru|uk|es)$/.test(l)?l:'en';}
  var TX={
    ru:{t:'Мы используем cookie аналитики, чтобы понимать, как работает сайт. Без вашего согласия они не включаются.',a:'Принять',d:'Отклонить',m:'Подробнее'},
    uk:{t:'Ми використовуємо cookie аналітики, щоб розуміти, як працює сайт. Без вашої згоди вони не вмикаються.',a:'Прийняти',d:'Відхилити',m:'Докладніше'},
    es:{t:'Usamos cookies de analítica para entender cómo funciona el sitio. Sin su consentimiento no se activan.',a:'Aceptar',d:'Rechazar',m:'Más información'},
    en:{t:'We use analytics cookies to understand how the site is used. They stay off unless you agree.',a:'Accept',d:'Decline',m:'Learn more'}
  };
  function load(){
    if(window.__clGa) return; window.__clGa=1;
    var s=document.createElement('script'); s.async=true; s.src='https://www.googletagmanager.com/gtag/js?id='+id; document.head.appendChild(s);
    window.dataLayer=window.dataLayer||[]; window.gtag=function(){dataLayer.push(arguments);};
    gtag('js',new Date()); gtag('config',id,{anonymize_ip:true});
  }
  function banner(){
    var t=TX[lang()], b=document.createElement('div'); b.id='cl-consent';
    b.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:9998;max-width:560px;margin:0 auto;background:#fbf6ee;color:#3b2a1d;border:1px solid #d9c9b4;border-radius:16px;padding:14px 16px;box-shadow:0 10px 40px rgba(0,0,0,.2);font:14px/1.45 system-ui,sans-serif';
    b.innerHTML='<div>'+t.t+' <a href="privacy.html" style="color:#b9702f">'+t.m+'</a></div><div style="display:flex;gap:8px;margin-top:10px"><button id="cl-c-a" style="flex:1;padding:10px;border-radius:999px;border:0;background:#b9702f;color:#fff;font:700 14px system-ui;cursor:pointer">'+t.a+'</button><button id="cl-c-d" style="flex:1;padding:10px;border-radius:999px;border:1px solid #d9c9b4;background:transparent;color:#3b2a1d;font:700 14px system-ui;cursor:pointer">'+t.d+'</button></div>';
    document.body.appendChild(b);
    b.querySelector('#cl-c-a').onclick=function(){set('yes');b.remove();load();};
    b.querySelector('#cl-c-d').onclick=function(){set('no');b.remove();};
  }
  window.clCookieSettings=function(){try{localStorage.removeItem(KEY);}catch(e){} var o=document.getElementById('cl-consent'); if(!o) banner();};
  var c=get();
  if(c==='yes') load();
  else if(c!=='no'){ if(document.body) banner(); else document.addEventListener('DOMContentLoaded',banner); }
})();
