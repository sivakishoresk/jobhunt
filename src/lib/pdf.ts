// Makes the PDF on the server by opening the app's own print view in headless Chromium. The print view
// already fits the document to whole pages (lib/pagefit), so the file is the same on every device, with
// no print dialog and no browser settings in the way.
import fs from 'node:fs';
import { HttpError } from './util';

const LOCAL_CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

async function launch() {
  const puppeteer = (await import('puppeteer-core')).default;
  // On Vercel (AWS Lambda underneath) there is no installed browser: use the Chromium build made for it.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import('@sparticuz/chromium')).default;
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    });
  }
  const path = [process.env.CHROME_PATH, ...LOCAL_CHROME].find((p) => p && fs.existsSync(p));
  if (!path) throw new HttpError(501, 'No Chrome found on this machine for server-side PDF. Set CHROME_PATH, or use Print or save as PDF in the browser.');
  return puppeteer.launch({ executablePath: path, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

export interface PdfResult {
  pdf: Uint8Array;
  /** What the page check said: ok, short or over. */
  fit: string;
  pages: number;
  message: string;
}

/**
 * Prints `${origin}${path}` (a /print/... page) as the signed-in person.
 * `storage` seeds the choices the print view keeps in the browser: paper, length, bullets left out.
 */
export async function renderPdf(opts: { origin: string; path: string; cookie: { name: string; value: string }; storage: Record<string, string> }): Promise<PdfResult> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await browser.setCookie({ name: opts.cookie.name, value: opts.cookie.value, domain: new URL(opts.origin).hostname, path: '/', httpOnly: true, secure: opts.origin.startsWith('https:') });
    await page.evaluateOnNewDocument((entries: [string, string][]) => {
      try {
        for (const [k, v] of entries) localStorage.setItem(k, v);
      } catch {
        /* storage unavailable: the defaults apply */
      }
    }, Object.entries(opts.storage));
    const res = await page.goto(opts.origin + opts.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!res || !res.ok()) throw new HttpError(502, `The print view did not load (${res?.status() ?? 'no response'}).`);
    await page.waitForSelector('.paged[data-fit]:not([data-fit="pending"])', { timeout: 30000 });
    // Let any font that was still arriving settle, then give the fitter a frame to re-measure.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    });
    await page.waitForSelector('.paged[data-fit]:not([data-fit="pending"])', { timeout: 10000 });
    const state = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.paged')!;
      return { fit: el.dataset.fit ?? '', pages: Number(el.dataset.pages ?? 0), message: document.querySelector('.fitmsg')?.textContent?.trim() ?? '' };
    });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 30000 });
    return { pdf, ...state };
  } finally {
    await browser.close().catch(() => {});
  }
}
