import { chromium, type Browser, type BrowserContext } from 'playwright';
import { htmlToText } from './crawl';
import { isAntibotChallenge } from './antibot';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const NAV_TIMEOUT_MS = 30_000;
// Антибот держит экран «Проверка пользователя…» несколько секунд, затем сам
// перезагружается на реальный сайт. На rustehnika.ru переход занял ~19с.
const CHALLENGE_WAIT_MS = 30_000;
const POLL_STEP_MS = 1_000;

export type LoadResult = {
  url: string;
  status: number;
  html: string;
  text: string;
  /** Страница осталась заглушкой антибота — не настоящий контент сайта. */
  blocked: boolean;
} | null;

export class BrowserSession {
  private constructor(
    private browser: Browser,
    private context: BrowserContext,
  ) {}

  static async open(): Promise<BrowserSession> {
    // headed (headless:false): headless Chromium KillBot не пропускает —
    // проверено, застревает на «Проверка пользователя…» >26с. На сервере без
    // экрана процесс запускается под xvfb (см. Task 6).
    const browser = await chromium.launch({ headless: false });
    try {
      const context = await browser.newContext({ userAgent: UA, locale: 'ru-RU' });
      return new BrowserSession(browser, context);
    } catch (e) {
      // newContext упал после успешного launch — иначе Chromium повис бы процессом.
      await browser.close().catch(() => {});
      throw e;
    }
  }

  /**
   * `opts.extraWaitMs` — дополнительное ожидание перед финальным чтением DOM,
   * ПОСЛЕ того как антибот-челлендж (если был) уже отпустил страницу. Нужен
   * для сайтов, которые дорисовывают подвал (и вместе с ним — навигацию)
   * скриптом через несколько секунд после загрузки: без паузы `page.content()`
   * возвращает разметку без единой внутренней ссылки. Обычные вызовы `load()`
   * этот параметр не передают и, соответственно, не платят за него временем —
   * см. `loadWithFooterRetry` в crawl.ts, которая включает его точечно.
   */
  async load(url: string, opts?: { extraWaitMs?: number }): Promise<LoadResult> {
    let page;
    try {
      page = await this.context.newPage();
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const status = resp?.status() ?? 0;

      // Ждём, пока антибот сам уйдёт на реальный сайт.
      const deadline = Date.now() + CHALLENGE_WAIT_MS;
      let blocked = true;
      while (Date.now() < deadline) {
        const title = await page.title().catch(() => '');
        const html = await page.content().catch(() => '');
        if (!isAntibotChallenge({ html, title })) {
          blocked = false;
          break;
        }
        await page.waitForTimeout(POLL_STEP_MS);
      }

      if (!blocked && opts?.extraWaitMs) {
        await page.waitForTimeout(opts.extraWaitMs);
      }

      const html = await page.content().catch(() => '');
      return {
        url: page.url() || url,
        status,
        html,
        text: htmlToText(html),
        blocked,
      };
    } catch {
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }
}
