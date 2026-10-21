// Письмо покупателю после оплаты. Работает через Resend (HTTPS API, без библиотек).
// Переменные Vercel: RESEND_API_KEY (обязательно, иначе письма просто не отправляются), MAIL_FROM (необязательно).
// Отправка не должна ломать выдачу заказа: любая ошибка только пишется в лог.
const SITE = (process.env.SITE_URL || 'https://www.crochetlens.com').replace(/\/$/, '');

const TX = {
  ru: {
    subj: 'Ваш заказ CrochetLens готов',
    hi: 'Спасибо за покупку!',
    single: 'Ваша PDF-схема добавлена в раздел «Мои схемы».',
    pack10: 'На ваш счёт добавлено 10 схем. Ими можно оплачивать новые схемы в личном кабинете и в конструкторе.',
    license: 'Лицензия добавлена к вашей схеме в личном кабинете.',
    btn: 'Открыть личный кабинет',
    foot: 'Вопросы? Просто ответьте на это письмо или напишите на support@crochetlens.com.'
  },
  en: {
    subj: 'Your CrochetLens order is ready',
    hi: 'Thank you for your purchase!',
    single: 'Your PDF pattern is now in My patterns.',
    pack10: '10 patterns were added to your account. Use them for new patterns in your account or in the generator.',
    license: 'The license was added to your pattern in your account.',
    btn: 'Open my account',
    foot: 'Questions? Just reply to this email or write to support@crochetlens.com.'
  },
  uk: {
    subj: 'Ваше замовлення CrochetLens готове',
    hi: 'Дякуємо за покупку!',
    single: 'Вашу PDF-схему додано до розділу «Мої схеми».',
    pack10: 'На ваш рахунок додано 10 схем. Ними можна оплачувати нові схеми в особистому кабінеті та в конструкторі.',
    license: 'Ліцензію додано до вашої схеми в особистому кабінеті.',
    btn: 'Відкрити особистий кабінет',
    foot: 'Питання? Просто дайте відповідь на цей лист або напишіть на support@crochetlens.com.'
  }
};

async function sendOrderEmail({ to, product, lang }) {
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key || !to) return false;
    const t = TX[lang] || TX.en;
    const body = t[product] || t.single;
    const url = SITE + '/account.html';
    const html = '<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#3b2a1d">' +
      '<h2 style="margin:0 0 12px">' + t.hi + '</h2><p style="font-size:16px;line-height:1.5">' + body + '</p>' +
      '<p style="margin:24px 0"><a href="' + url + '" style="background:#b9702f;color:#fff;text-decoration:none;padding:13px 24px;border-radius:999px;font-weight:700;display:inline-block">' + t.btn + '</a></p>' +
      '<p style="color:#7a6552;font-size:14px">' + t.foot + '</p></div>';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'CrochetLens <support@crochetlens.com>', to: [to], reply_to: 'support@crochetlens.com', subject: t.subj, html })
    });
    if (!r.ok) console.log('order email failed', r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) {
    console.log('order email error', e && e.message);
    return false;
  }
}

module.exports = { sendOrderEmail };
