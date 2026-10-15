/* Публичные настройки Supabase. anon-ключ предназначен для браузера, его не нужно прятать
   (доступ защищён правилами RLS из supabase/schema.sql). Service-ключ сюда НЕЛЬЗЯ. */
window.CL_CONFIG = {
  SUPABASE_URL: 'https://uzdrkjhltjkaakrsyydz.supabase.co',// например https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: ''   // длинный ключ "anon public"
};
