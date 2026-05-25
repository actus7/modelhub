/**
 * Duck.ai VQD Challenge Solver — 3-layer strategy:
 *
 * 1. **jsdom** with dynamic deobfuscation patches (fast, lightweight)
 * 2. **jsdom retry** up to 4 attempts (DuckDuckGo rotates challenge scripts)
 * 3. **Puppeteer** headless browser fallback (warm singleton when available)
 *
 * Layer 3 keeps a browser instance "warm" so subsequent fallbacks are fast.
 */

import type { Browser, Page } from 'puppeteer'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

export type VqdChallengeResult = {
  server_hashes: string[]
  client_hashes: string[]
  signals: Record<string, unknown>
  meta: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Layer 3 — Puppeteer warm browser singleton
// ---------------------------------------------------------------------------

let warmBrowser: Browser | null = null
let warmBrowserTimeout: ReturnType<typeof setTimeout> | null = null
let puppeteerModulePromise: Promise<typeof import('puppeteer')> | null = null
let warmBrowserIsRemote = false
const BROWSER_IDLE_MS = 5 * 60 * 1000 // close after 5 min idle

async function getPuppeteerModule(): Promise<typeof import('puppeteer')> {
  if (!puppeteerModulePromise) {
    puppeteerModulePromise = import('puppeteer')
  }

  return puppeteerModulePromise
}

function getBrowserLaunchArgs(): string[] {
  const args = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
  ]

  if (process.env.DUCKAI_PUPPETEER_NO_SANDBOX === 'true') {
    args.unshift('--no-sandbox', '--disable-setuid-sandbox')
  }

  return args
}

async function getWarmBrowser(): Promise<Browser> {
  // Reset idle timer every time the browser is used
  if (warmBrowserTimeout) clearTimeout(warmBrowserTimeout)
  warmBrowserTimeout = setTimeout(() => {
    const browser = warmBrowser
    if (warmBrowserIsRemote) {
      browser?.disconnect()
    } else {
      browser?.close().catch(() => {})
    }
    warmBrowser = null
    warmBrowserIsRemote = false
    warmBrowserTimeout = null
    console.log('[Duck.ai] Warm browser closed (idle timeout)')
  }, BROWSER_IDLE_MS)

  if (warmBrowser && warmBrowser.connected) return warmBrowser

  const puppeteer = await getPuppeteerModule()
  const browserWsEndpoint = process.env.DUCKAI_BROWSER_WS_ENDPOINT?.trim()
  if (browserWsEndpoint) {
    console.log('[Duck.ai] Connecting to remote browser for VQD challenge...')
    warmBrowser = await puppeteer.connect({ browserWSEndpoint: browserWsEndpoint })
    warmBrowserIsRemote = true
    return warmBrowser
  }

  console.log('[Duck.ai] Launching warm Puppeteer browser...')
  warmBrowser = await puppeteer.launch({
    headless: true,
    args: getBrowserLaunchArgs(),
  })
  warmBrowserIsRemote = false
  return warmBrowser
}

export async function solveVqdChallengeWithBrowser(
  challengeB64: string,
): Promise<VqdChallengeResult> {
  const decoded = Buffer.from(challengeB64, 'base64').toString('utf-8')
  const browser = await getWarmBrowser()
  let page: Page | null = null

  try {
    page = await browser.newPage()
    await page.setUserAgent(UA)
    await page.setJavaScriptEnabled(true)

    // Navigate to a blank page with duck.ai origin context
    await page.goto('about:blank', { waitUntil: 'domcontentloaded' })

    // Execute the challenge in the browser context
    const result = await page.evaluate(async (script: string) => {
      try {
        const fn = eval(`(${script})`)
        const res = typeof fn === 'function' ? await fn() : await fn
        return { ok: true as const, data: res }
      } catch (e) {
        return { ok: false as const, error: (e as Error).message }
      }
    }, decoded)

    if (!result.ok) {
      throw new Error(`Browser challenge failed: ${result.error}`)
    }

    const data = result.data as VqdChallengeResult
    if (!data?.server_hashes) {
      throw new Error('Browser challenge returned invalid data')
    }

    return data
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Layer 1 — Dynamic deobfuscation (pre-process challenge source)
// ---------------------------------------------------------------------------

/**
 * Inject safety wrappers around known problematic patterns in the challenge
 * script before executing in jsdom.  This is a best-effort heuristic that
 * catches null-access patterns the obfuscated code uses.
 */
export function deobfuscateChallenge(script: string): string {
  const helpers = `
    ;(function(){
      const createSafeDocument = function() {
        return document.implementation.createHTMLDocument('');
      };

      if(!window.__safeCD){
        window.__safeCD=function(target){
          try {
            if(target && target.contentDocument) return target.contentDocument;
          } catch {}
          return createSafeDocument();
        };
      }

      if(!window.__safeCW){
        window.__safeCW=function(target){
          try {
            if(target && target.contentWindow) return target.contentWindow;
          } catch {}
          return window;
        };
      }

      const defineAliasGetter = function(name, resolver) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, name);
        if (descriptor && typeof descriptor.get === 'function') return;

        Object.defineProperty(Object.prototype, name, {
          configurable: true,
          enumerable: false,
          get: function() {
            return resolver(this);
          }
        });
      };

      defineAliasGetter('__duckContentDocument', function(target) {
        return window.__safeCD(target);
      });

      defineAliasGetter('__duckContentWindow', function(target) {
        return window.__safeCW(target);
      });
    })();
  `

  if (!script.trim()) {
    return `(async function(){${helpers}})()`
  }

  const rewriteNullableAccess = (
    source: string,
    property: 'contentDocument' | 'contentWindow',
    helperName: '__safeCD' | '__safeCW',
  ) => {
    const dotAccessPattern = new RegExp(
      `([_$a-zA-Z0-9\\]\\)\\.\\\"\\']+)\\.${property}\\b`,
      'g',
    )
    const bracketAccessPattern = new RegExp(
      `([_$a-zA-Z0-9\\]\\)\\.\\\"\\']+)\\[(?:'|\")${property}(?:'|\")\\]`,
      'g',
    )

    return source
      .replace(dotAccessPattern, `window.${helperName}($1)`)
      .replace(bracketAccessPattern, `window.${helperName}($1)`)
  }

  const patched = rewriteNullableAccess(
    rewriteNullableAccess(script, 'contentDocument', '__safeCD'),
    'contentWindow',
    '__safeCW',
  )
    .replace(/(['"])contentDocument\1/g, '$1__duckContentDocument$1')
    .replace(/(['"])contentWindow\1/g, '$1__duckContentWindow$1')

  return `(async function(){${helpers}\nreturn await (${patched});})()`
}
