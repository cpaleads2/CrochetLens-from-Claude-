/* CrochetLens shared header behaviour: language menu toggle + login button -> account page */
(function(){
  var base='';
  try{ base=document.currentScript.src.replace(/assets\/site\.js.*$/,''); }catch(e){}
  var btn=document.getElementById('lang-btn'), menu=document.getElementById('lang-menu');
  if(btn&&menu){
    btn.addEventListener('click',function(e){e.stopPropagation();menu.classList.toggle('show');});
    document.addEventListener('click',function(){menu.classList.remove('show');});
  }
  var lb=document.getElementById('login-btn');
  if(lb){
    try{
      for(var i=0;i<localStorage.length;i++){
        if(/^sb-.*-auth-token$/.test(localStorage.key(i))){ lb.textContent='Кабинет'; break; }
      }
    }catch(e){}
    lb.addEventListener('click',function(){ location.href=base+'account.html'; });
  }
})();
