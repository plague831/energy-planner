// Знімки екрана сайту для рисунків розділу 3 (рис. 3.1–3.3, 3.6, 3.7).
//
// Потрібен запущений сайт (npm run dev:server і npm run dev:client, адреса http://localhost:5173)
// і Playwright з браузером Chromium. Запуск з кореня репозиторію:
//   node docs/thesis/figures/screens.cjs
// Знімки зберігаються в docs/thesis/figures/screens, а рисунки з них складає make.py.
//
// Використовується приклад сайту («Пропустити й подивитися приклад») з графіком, введеним вручну,
// і зафіксований час 07:00, тож знімки не залежать від того, коли і де їх роблять.
const { chromium } = require('playwright');
const { join } = require('node:path');

const URL = process.env.SITE_URL ?? 'http://localhost:5173/';
const NOW = new Date('2026-11-24T07:00:00+02:00');
const OUT = join(__dirname, 'screens');

async function open(browser, mobile) {
  const common = { locale: 'uk-UA', timezoneId: 'Europe/Kyiv', colorScheme: 'light', deviceScaleFactor: 2 };
  const context = await browser.newContext(mobile
    ? { ...common, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { ...common, viewport: { width: 820, height: 900 } });
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(URL);
  await page.getByText('Пропустити й подивитися приклад').click();
  await page.getByText('Увесь план на сьогодні').waitFor({ timeout: 90000 });
  await page.waitForTimeout(1500);
  return page;
}

// Шапка й нижнє меню закріплені на екрані й на знімках окремих блоків перекривали б їх.
const unstick = (page) => page.evaluate(() => {
  document.querySelectorAll('header').forEach((h) => { h.style.position = 'static'; });
  document.querySelectorAll('nav.nav-bottom, .toasts').forEach((n) => { n.style.display = 'none'; });
});

// Знімок від верху блоку top до низу блоку bottom.
async function span(page, top, bottom, file, extra = 0) {
  const a = await top.boundingBox();
  const z = await bottom.boundingBox();
  const y = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: join(OUT, file), fullPage: true, clip: { x: a.x, y: a.y + y, width: a.width, height: z.y + z.height + extra - a.y } });
}

const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

(async () => {
  const browser = await chromium.launch();

  // Смартфон: «Сьогодні» і «Мій дім», потім зміна графіка.
  let page = await open(browser, true);
  await unstick(page);
  await span(page, page.locator('section.station-card').first(), page.locator('section.schedule-card'), 'today-a.png');
  await page.locator('section.card', { hasText: 'Що можна вмикати зараз' }).screenshot({ path: join(OUT, 'today-b.png') });

  await go(page, '#/home');
  await page.waitForTimeout(1000);
  await unstick(page);
  const cards = page.locator('main section.card');
  await cards.nth(1).screenshot({ path: join(OUT, 'home-sources.png') });
  const loads = cards.nth(2);
  await span(page, loads, loads.getByText('Чайник (сніданок)'), 'home-loads.png', 22);

  // Вечірнє відключення 18:00–22:00 переноситься на 15:00–19:00.
  await page.getByText(/ввести вручну/).click();
  const times = page.locator('.list-editor input[type=time]');
  await times.nth(2).fill('15:00');
  await times.nth(3).fill('19:00');
  await page.getByRole('button', { name: 'Зберегти зміни' }).click();
  await page.getByText(/план на найближчі години змінився/).first().waitFor({ timeout: 90000 });
  await go(page, '#/today');
  await page.waitForTimeout(2000);
  await unstick(page);
  await page.locator('section.notice.replan').screenshot({ path: join(OUT, 'replan.png') });
  await page.context().close();

  // Комп'ютер: діаграма доби і порівняння методів.
  page = await open(browser, false);
  await unstick(page);
  await go(page, '#/details');
  await page.waitForTimeout(1500);
  await page.locator('section.card', { hasText: 'Діаграма доби' }).screenshot({ path: join(OUT, 'diagram.png') });
  await page.getByText('Порівняти всі методи').click();
  await page.getByText('Порівняння методів').waitFor({ timeout: 90000 });
  await page.waitForTimeout(500);
  await unstick(page);
  await page.locator('section.card', { hasText: 'Для фахівців' }).screenshot({ path: join(OUT, 'compare.png') });

  await browser.close();
  console.log(`Знімки збережено в ${OUT}`);
})();
