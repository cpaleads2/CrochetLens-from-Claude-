/* Покупка: window.clBuy('pack10' | {product,licenses,draft_id,pattern_id}).
   Без входа отправляет в личный кабинет и после входа продолжает покупку. */
(function(){
  var SB='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  function loadSb(){
    return new Promise(function(ok,fail){
      if(window.supabase) return ok();
      var s=document.createElement('script'); s.src=SB; s.onload=ok; s.onerror=fail; document.head.appendChild(s);
    });
  }
  async function session(){
    await loadSb();
    var c=window.CL_CONFIG; if(!c||!c.SUPABASE_URL) throw new Error('config');
    window.__clSb=window.__clSb||window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{auth:{persistSession:true,detectSessionInUrl:true}});
    return (await window.__clSb.auth.getSession()).data.session;
  }
  window.clBuy=async function(req,btn){
    if(typeof req==='string') req={product:req};
    var old=btn&&btn.textContent;
    try{
      if(btn){ btn.disabled=true; btn.textContent='…'; }
      var ses=await session();
      if(!ses){
        try{ sessionStorage.setItem('cl_buy',JSON.stringify(req)); }catch(e){}
        location.href='account.html'; return;
      }
      try{ req=Object.assign({lang:localStorage.getItem('cl_lang')||document.documentElement.lang||'en'},req); }catch(e){}
      var r=await fetch('/api/tranzzo-create',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ses.access_token},body:JSON.stringify(req)});
      var j=await r.json().catch(function(){return {};});
      if(j.url){ location.href=j.url; return; }
      alert('Не удалось открыть оплату. Попробуйте ещё раз или напишите на support@crochetlens.com');
    }catch(e){
      alert('Не удалось открыть оплату. Попробуйте ещё раз.');
    }
    if(btn){ btn.disabled=false; btn.textContent=old; }
  };
  // Покупка, начатая до входа, продолжается в кабинете.
  window.clResumeBuy=function(){
    var raw=null; try{ raw=sessionStorage.getItem('cl_buy'); sessionStorage.removeItem('cl_buy'); }catch(e){}
    if(raw){ try{ window.clBuy(JSON.parse(raw)); }catch(e){} }
  };
})();
