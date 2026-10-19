/* Окно покупки схемы для обоих генераторов.
   clCheckout.start({kind:'amigurumi'|'mosaic', title, payload})
   Требует assets/config.js и assets/buy.js. Лицензии и цены сверяются на сервере. */
(function(){
  var SB='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  var P={single:6.99,pack10:34.99,commercial:9.99,resale:19.99};
  var TX={
    ru:{name:'Название схемы',nameph:'Например: Дракончик',title:'Получить PDF-схему',signin:'Чтобы купить или сохранить схему, войдите по email — пароль не нужен.',email:'Ваш email',send:'Получить ссылку для входа',sent:'Ссылка отправлена. Откройте письмо и перейдите по ссылке — покупка продолжится сама.',
      lic:'Лицензии (по желанию)',com:'Коммерческая — продавать изделия, связанные по схеме',res:'Перепродажа схемы — PDF без логотипа и адреса сайта',
      buy1:'Купить эту схему',pack:'Купить пакет — 10 схем',use:'Списать из пакета',left:'осталось',saving:'Сохраняем схему…',err:'Не удалось. Попробуйте ещё раз или напишите на support@crochetlens.com',close:'Закрыть',done:'Схема добавлена в «Мои схемы».',open:'Открыть «Мои схемы»',nocredit:'В пакете нет схем',noteLic:'Лицензию на готовую схему можно докупить позже в личном кабинете.'},
    en:{name:'Pattern name',nameph:'For example: Little Dragon',title:'Get the PDF pattern',signin:'Sign in with your email to buy or save the pattern — no password needed.',email:'Your email',send:'Email me a sign-in link',sent:'Link sent. Open the email and follow the link — your purchase will continue automatically.',
      lic:'Licenses (optional)',com:'Commercial — sell items made from the pattern',res:'Resale — PDF without logo and site address',
      buy1:'Buy this pattern',pack:'Buy a pack — 10 patterns',use:'Use one from my pack',left:'left',saving:'Saving your pattern…',err:'Something went wrong. Try again or write to support@crochetlens.com',close:'Close',done:'The pattern was added to My patterns.',open:'Open My patterns',nocredit:'No patterns left in your pack',noteLic:'You can add a license to a finished pattern later in your account.'},
    uk:{name:'Назва схеми',nameph:'Наприклад: Дракончик',title:'Отримати PDF-схему',signin:'Щоб купити або зберегти схему, увійдіть за email — пароль не потрібен.',email:'Ваш email',send:'Отримати посилання для входу',sent:'Посилання надіслано. Відкрийте лист і перейдіть за посиланням — покупка продовжиться сама.',
      lic:'Ліцензії (за бажанням)',com:'Комерційна — продавати вироби, зв’язані за схемою',res:'Перепродаж схеми — PDF без логотипа й адреси сайту',
      buy1:'Купити цю схему',pack:'Купити пакет — 10 схем',use:'Списати з пакета',left:'залишилось',saving:'Зберігаємо схему…',err:'Не вдалося. Спробуйте ще раз або напишіть на support@crochetlens.com',close:'Закрити',done:'Схему додано до «Мої схеми».',open:'Відкрити «Мої схеми»',nocredit:'У пакеті немає схем',noteLic:'Ліцензію на готову схему можна докупити пізніше в особистому кабінеті.'}
  };
  function L(){var l='ru';try{l=localStorage.getItem('cl_lang')||document.documentElement.lang||'ru';}catch(e){}return TX[l]?l:(l==='en'?'en':'ru');}
  function t(k){return TX[L()][k];}
  var KEY='cl_pending_checkout';

  function loadSb(){return new Promise(function(ok,fail){if(window.supabase)return ok();var s=document.createElement('script');s.src=SB;s.onload=ok;s.onerror=fail;document.head.appendChild(s);});}
  async function client(){
    await loadSb();
    var c=window.CL_CONFIG;
    window.__clSb=window.__clSb||window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{auth:{persistSession:true,detectSessionInUrl:true}});
    return window.__clSb;
  }
  function strip(p){var q=Object.assign({},p);if('photoBase64' in q){q.photoBase64=null;q.photoMediaType=null;}if('images' in q)q.images=[];return q;}
  // Лимит тела запроса на Vercel ~4,5 МБ. Режем по шагам и не выбрасываем фото без нужды:
  // 1) обложка дублируется в images — убираем дубль (сервер берёт images первыми); 2) отбрасываем лишние ракурсы с конца; 3) только потом всё.
  var LIM=3800000;
  function size(o){return JSON.stringify(o).length;}
  function fit(p){
    if(size(p)<=LIM) return p;
    var q=Object.assign({},p);
    if(q.images&&q.images.length&&q.photoBase64){q.photoBase64=null;q.photoMediaType=null;}
    if(size(q)<=LIM) return q;
    if(q.images&&q.images.length){
      q.images=q.images.slice();
      while(q.images.length>1&&size(q)>LIM) q.images.pop();
      if(size(q)<=LIM) return q;
    }
    return strip(p);
  }

  var css='.clco-bg{position:fixed;inset:0;background:rgba(40,28,20,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px}'+
  '.clco{background:#fbf6ee;color:#3b2a1d;border-radius:18px;max-width:440px;width:100%;padding:24px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto}'+
  '.clco h3{margin:0 0 12px;font-size:20px}.clco p{margin:8px 0}.clco label{display:flex;gap:8px;align-items:flex-start;margin:8px 0;cursor:pointer}'+
  '.clco input[type=email],.clco input[type=text]{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #d9c9b4;border-radius:10px;font:inherit;margin:8px 0}'+
  '.clco button{display:block;width:100%;padding:13px 16px;margin:8px 0;border-radius:999px;border:1px solid #d9c9b4;background:transparent;font:700 15px system-ui;color:#3b2a1d;cursor:pointer}'+
  '.clco button.pri{background:#b9702f;border-color:#b9702f;color:#fff}.clco button:disabled{opacity:.55;cursor:default}'+
  '.clco small{color:#7a6552}.clco .msg{margin-top:10px;font-size:14px}.clco .x{background:none;border:none;width:auto;display:inline;color:#7a6552;font-weight:400;text-decoration:underline;margin:4px 0 0;padding:4px 0}';
  function ui(html){
    if(!document.getElementById('clco-css')){var s=document.createElement('style');s.id='clco-css';s.textContent=css;document.head.appendChild(s);}
    var o=document.getElementById('clco-bg');
    if(!o){o=document.createElement('div');o.id='clco-bg';o.className='clco-bg';document.body.appendChild(o);}
    o.innerHTML='<div class="clco" role="dialog" aria-modal="true">'+html+'</div>';
    return o;
  }
  function close(){var o=document.getElementById('clco-bg');if(o)o.remove();}
  function $(sel){return document.querySelector('#clco-bg '+sel);}

  async function saveDraft(ses,job){
    var r=await fetch('/api/draft',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ses.access_token},body:JSON.stringify({kind:job.kind,title:job.title||'',payload:fit(job.payload)})});
    var j=await r.json().catch(function(){return {};});
    if(!j.draft_id)throw new Error('draft');
    return j.draft_id;
  }
  async function credits(sb){
    try{var r=await sb.from('credit_ledger').select('delta');return (r.data||[]).reduce(function(a,x){return a+x.delta;},0);}catch(e){return 0;}
  }

  function loginForm(sb,job){
    try{localStorage.setItem(KEY,JSON.stringify(job));}catch(e){try{localStorage.setItem(KEY,JSON.stringify({kind:job.kind,title:job.title,payload:strip(job.payload)}));}catch(e2){}}
    ui('<h3>'+t('title')+'</h3><p>'+t('signin')+'</p><input type="email" id="clco-em" placeholder="'+t('email')+'" autocomplete="email"><button class="pri" id="clco-go">'+t('send')+'</button><div class="msg" id="clco-m"></div><button class="x" id="clco-x">'+t('close')+'</button>');
    $('#clco-x').onclick=close;
    $('#clco-go').onclick=async function(){
      var em=$('#clco-em').value.trim();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))return;
      this.disabled=true;
      var r=await sb.auth.signInWithOtp({email:em,options:{emailRedirectTo:location.origin+location.pathname+'?resume=1'}});
      $('#clco-m').textContent=r.error?t('err'):t('sent');
      if(r.error)this.disabled=false;
    };
  }

  async function menu(sb,ses,job){
    var bal=await credits(sb);
    var licNote='<p><small>'+t('noteLic')+'</small></p>';
    ui('<h3>'+t('title')+'</h3>'+
      '<p><b>'+t('name')+'</b></p>'+
      '<input type="text" id="clco-name" maxlength="60" placeholder="'+t('nameph')+'" autocomplete="off">'+
      '<p><b>'+t('lic')+'</b></p>'+
      '<label><input type="checkbox" id="clco-c"> <span>'+t('com')+' <small>(+$'+P.commercial+')</small></span></label>'+
      '<label><input type="checkbox" id="clco-r"> <span>'+t('res')+' <small>(+$'+P.resale+')</small></span></label>'+
      '<button class="pri" id="clco-buy">'+t('buy1')+' — $<span id="clco-pr">'+P.single+'</span></button>'+
      (bal>0?'<button id="clco-use">'+t('use')+' ('+t('left')+' '+bal+')</button>'+licNote:'')+
      '<button id="clco-pack">'+t('pack')+' — $'+P.pack10+'</button>'+
      '<div class="msg" id="clco-m"></div><button class="x" id="clco-x">'+t('close')+'</button>');
    $('#clco-x').onclick=close;
    function sum(){var s=P.single+($('#clco-c').checked?P.commercial:0)+($('#clco-r').checked?P.resale:0);$('#clco-pr').textContent=s.toFixed(2);}
    $('#clco-c').onchange=sum;$('#clco-r').onchange=sum;
    var draftId=null;
    var draftName=null;
    async function ensureDraft(){
      var nm=($('#clco-name').value||'').replace(/\s+/g,' ').trim().slice(0,60);
      if(draftId&&nm!==draftName)draftId=null;   // название поменяли — сохраняем черновик заново
      if(!draftId){
        $('#clco-m').textContent=t('saving');
        var j2=Object.assign({},job);
        if(nm){j2.title=nm;j2.payload=Object.assign({},job.payload,{title:nm});}   // имя попадёт и в заголовок PDF
        draftId=await saveDraft(ses,j2);draftName=nm;$('#clco-m').textContent='';
      }
      return draftId;
    }
    function busy(v){var b=document.querySelectorAll('#clco-bg .clco button');for(var i=0;i<b.length;i++)b[i].disabled=v;}
    $('#clco-buy').onclick=async function(){
      try{busy(true);var id=await ensureDraft();var lic=[];if($('#clco-c').checked)lic.push('commercial');if($('#clco-r').checked)lic.push('resale');
        try{localStorage.removeItem(KEY);}catch(e){}
        await window.clBuy({product:'single',licenses:lic,draft_id:id});}
      catch(e){$('#clco-m').textContent=t('err');}busy(false);
    };
    if($('#clco-use'))$('#clco-use').onclick=async function(){
      try{busy(true);var id=await ensureDraft();
        var r=await fetch('/api/redeem',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ses.access_token},body:JSON.stringify({draft_id:id})});
        if(r.status===402){$('#clco-m').textContent=t('nocredit');busy(false);return;}
        if(!r.ok)throw new Error('redeem');
        try{localStorage.removeItem(KEY);}catch(e){}
        ui('<h3>'+t('done')+'</h3><button class="pri" id="clco-open">'+t('open')+'</button><button class="x" id="clco-x">'+t('close')+'</button>');
        $('#clco-open').onclick=function(){location.href='account.html';};$('#clco-x').onclick=close;
      }catch(e){$('#clco-m').textContent=t('err');busy(false);}
    };
    $('#clco-pack').onclick=function(){try{localStorage.removeItem(KEY);}catch(e){}window.clBuy('pack10');};
  }

  async function run(job){
    var sb=await client();
    var ses=(await sb.auth.getSession()).data.session;
    if(!ses)return loginForm(sb,job);
    return menu(sb,ses,job);
  }

  window.clCheckout={
    start:function(job){return run(job).catch(function(){ui('<h3>'+t('title')+'</h3><p>'+t('err')+'</p><button class="x" id="clco-x">'+t('close')+'</button>');$('#clco-x').onclick=close;});},
    // После входа по ссылке из письма возвращаемся на страницу генератора с ?resume=1 и продолжаем покупку.
    resume:function(){
      if(location.search.indexOf('resume=1')<0)return;
      var raw=null;try{raw=localStorage.getItem(KEY);}catch(e){}
      try{history.replaceState(null,'',location.pathname+location.hash);}catch(e){}   // хэш с токеном входа не трогаем
      if(!raw)return;
      try{window.clCheckout.start(JSON.parse(raw));}catch(e){}
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){window.clCheckout.resume();});else window.clCheckout.resume();
})();
