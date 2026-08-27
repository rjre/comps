// Generic page inspector: navigate, wait for load, dump form/newsletter/competition-related
// elements. Usage: node inspect.js <url> [waitMs]
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2];
  const waitMs = parseInt(process.argv[3] || '3000', 10);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    proxy: { server: 'http://127.0.0.1:32823' },
    args: ['--ignore-certificate-errors'],
  });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  } catch (e) {
    console.log('NAV ERROR:', e.message);
  }
  await page.waitForTimeout(waitMs);
  console.log('TITLE:', await page.title());
  console.log('URL:', page.url());

  // Dump all forms
  const forms = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('form')).map(f => ({
      id: f.id, action: f.action, method: f.method, className: f.className,
      inputs: Array.from(f.querySelectorAll('input,select,textarea,button')).map(i => ({
        tag: i.tagName, type: i.type, name: i.name, id: i.id, placeholder: i.placeholder,
        text: (i.textContent||'').trim().slice(0,40), required: i.required
      }))
    }));
  });
  console.log('FORMS:', JSON.stringify(forms, null, 1));

  // Search for keywords in body text near "newsletter"/"subscribe"/"sign up"/"competition"
  const bodyText = await page.evaluate(() => document.body.innerText);
  const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
  const keywords = ['newsletter', 'subscribe', 'sign up', 'sign-up', 'competition', 'giveaway', 'prize draw', 'win a'];
  const matches = lines.filter(l => keywords.some(k => l.toLowerCase().includes(k)));
  console.log('TEXT MATCHES:', JSON.stringify(matches.slice(0, 40), null, 1));

  await browser.close();
})();
