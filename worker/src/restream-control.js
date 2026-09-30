const { spawn } = require('node:child_process');
const { mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const START_LABELS = [
  /^go live$/i,
  /^start stream$/i,
  /^start streaming$/i,
];
const STOP_LABELS = [
  /^end stream$/i,
  /^stop stream$/i,
  /^stop streaming$/i,
  /^end live stream$/i,
];
const STOP_CONFIRM_LABELS = [
  /^end stream$/i,
  /^stop stream$/i,
  /^end live stream$/i,
  /^yes,? end stream$/i,
];
const START_CONFIRM_LABELS = [
  /^go live$/i,
  /^start stream$/i,
  /^start streaming$/i,
];

function normalizeLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function allowedRestreamHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'restream.io' || host.endsWith('.restream.io');
  } catch {
    return false;
  }
}

function createRestreamControl({ chromiumPath, puppeteer }) {
  const profileDir = process.env.RESTREAM_PROFILE_DIR || (process.env.FLY_APP_NAME ? '/data/restream-chromium' : join(tmpdir(), 'hmo-restream-chromium'));
  const controlUrl = process.env.RESTREAM_CONTROL_URL || 'https://app.restream.io/channel';
  let display;
  let browser;
  let page;
  let launchTask;
  let startTask;
  let resetTask;
  let lastError = '';

  async function stopProcess(proc) {
    if (!proc?.pid || proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => proc.kill('SIGKILL'), 1500);
      proc.once('close', () => { clearTimeout(timer); resolve(); });
      proc.kill('SIGTERM');
    });
  }

  async function ensureBrowser() {
    if (browser?.connected && page && !page.isClosed()) return page;
    if (launchTask) return launchTask;
    launchTask = (async () => {
      lastError = '';
      await browser?.close().catch(() => {});
      browser = undefined;
      page = undefined;
      await stopProcess(display);
      display = undefined;

      await mkdir(profileDir, { recursive: true });
      display = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-ac'], {
        stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
      });
      const displayNumber = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(Error('Restream display did not start')), 8000);
        display.once('error', () => { clearTimeout(timer); reject(Error('Restream display is unavailable')); });
        display.stdio[3].on('data', bytes => {
          output += bytes.toString();
          if (/^\d+\s*$/.test(output) && output.includes('\n')) {
            clearTimeout(timer);
            resolve(output.trim());
          }
        });
      });

      const env = { ...process.env, DISPLAY: ':' + displayNumber };
      browser = await puppeteer.launch({
        executablePath: chromiumPath,
        headless: false,
        defaultViewport: null,
        userDataDir: profileDir,
        env,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-infobars',
          '--window-size=1280,900',
          '--force-device-scale-factor=1',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
        ],
      });
      browser.on('disconnected', () => {
        lastError ||= 'Restream control browser disconnected';
        page = undefined;
      });
      page = (await browser.pages())[0] || await browser.newPage();
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      if (!allowedRestreamHost(page.url())) {
        await page.goto(controlUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      }
      if (!allowedRestreamHost(page.url())) throw Error('Restream control browser left the allowed Restream origin');
      return page;
    })().catch(error => {
      lastError = error?.message || String(error);
      throw error;
    }).finally(() => { launchTask = undefined; });
    return launchTask;
  }

  async function visibleButtons(targetPage) {
    const rows = [];
    for (let frameIndex = 0; frameIndex < targetPage.frames().length; frameIndex++) {
      const frame = targetPage.frames()[frameIndex];
      const labels = await frame.evaluate(() => Array.from(document.querySelectorAll('button')).map((button, index) => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0 && !button.disabled;
        return visible ? {
          index,
          label: String(button.textContent || button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        } : null;
      }).filter(Boolean)).catch(() => []);
      for (const row of labels) rows.push({ frameIndex, index: row.index, label: normalizeLabel(row.label) });
    }
    return rows;
  }

  function classifyButtons(buttons, url) {
    const labels = buttons.map(row => row.label).filter(Boolean);
    const login = /\/(?:login|signin|auth)(?:\/|$|\?)/i.test(new URL(url).pathname)
      || labels.some(label => /^(?:log in|sign in|continue with google)$/i.test(label));
    const start = buttons.filter(row => START_LABELS.some(re => re.test(row.label)));
    const stop = buttons.filter(row => STOP_LABELS.some(re => re.test(row.label)));
    if (login) return { state: 'login_required', start, stop };
    if (start.length === 1 && stop.length === 0) return { state: 'offline', start, stop };
    if (stop.length === 1 && start.length === 0) return { state: 'live', start, stop };
    if (!start.length && !stop.length) return { state: 'unknown', start, stop };
    return { state: 'ambiguous', start, stop };
  }

  async function status() {
    try {
      const targetPage = await ensureBrowser();
      const url = targetPage.url();
      if (!allowedRestreamHost(url)) throw Error('Restream control browser is not on an allowed Restream origin');
      const buttons = await visibleButtons(targetPage);
      const classified = classifyButtons(buttons, url);
      return {
        configured: true,
        automationEnabled: process.env.RESTREAM_AUTOMATION_ENABLED === 'true',
        profileDir,
        url,
        title: await targetPage.title().catch(() => ''),
        state: classified.state,
        recognized: {
          start: classified.start.map(row => row.label),
          stop: classified.stop.map(row => row.label),
        },
        error: lastError || null,
      };
    } catch (error) {
      lastError = error?.message || String(error);
      return {
        configured: true,
        automationEnabled: process.env.RESTREAM_AUTOMATION_ENABLED === 'true',
        profileDir,
        url: page?.url?.() || '',
        title: '',
        state: 'error',
        recognized: { start: [], stop: [] },
        error: lastError,
      };
    }
  }

  async function clickExactly(patterns) {
    const targetPage = await ensureBrowser();
    const buttons = await visibleButtons(targetPage);
    const matches = buttons.filter(row => patterns.some(re => re.test(row.label)));
    if (matches.length !== 1) throw Error('Expected exactly one recognized Restream control; found ' + matches.length);
    const match = matches[0];
    const frame = targetPage.frames()[match.frameIndex];
    const clicked = await frame.evaluate(({ index, allowed }) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons[index];
      if (!button) return false;
      const label = String(button.textContent || button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (!allowed.includes(label.toLowerCase())) return false;
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      if (button.disabled || style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return false;
      button.click();
      return true;
    }, { index: match.index, allowed: matches.map(row => row.label.toLowerCase()) }).catch(() => false);
    if (!clicked) throw Error('Recognized Restream control disappeared before it could be clicked');
    return match.label;
  }

  async function waitForState(expected, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let current = await status();
    while (Date.now() < deadline) {
      if (current.state === expected) return current;
      if (['login_required', 'ambiguous', 'error'].includes(current.state)) return current;
      await delay(1500);
      current = await status();
    }
    return current;
  }

  async function maybeConfirm(patterns) {
    await delay(800);
    const targetPage = await ensureBrowser();
    const buttons = await visibleButtons(targetPage);
    const matches = buttons.filter(row => patterns.some(re => re.test(row.label)));
    if (matches.length !== 1) return false;
    await clickExactly(patterns);
    return true;
  }

  async function controlledStart() {
    if (process.env.RESTREAM_AUTOMATION_ENABLED !== 'true') throw Error('Restream automation is disabled');
    if (resetTask) throw Error('Restream reset is already in progress');
    if (startTask) return startTask;
    startTask = (async () => {
      const before = await status();
      if (before.state !== 'offline') throw Error('Restream start requires a recognized offline state; current state is ' + before.state);

      const startLabel = await clickExactly(START_LABELS);
      let started = await waitForState('live', 15000);
      if (started.state !== 'live') {
        await maybeConfirm(START_CONFIRM_LABELS);
        started = await waitForState('live', 45000);
      }
      if (started.state !== 'live') throw Error('Restream did not reach a recognized live state after ' + startLabel);

      return {
        ok: true,
        action: 'controlled-start',
        startedWith: startLabel,
        before,
        after: started,
      };
    })().finally(() => { startTask = undefined; });
    return startTask;
  }

  async function controlledReset({ holdMs = 15000 } = {}) {
    if (process.env.RESTREAM_AUTOMATION_ENABLED !== 'true') throw Error('Restream automation is disabled');
    if (startTask) throw Error('Restream start is already in progress');
    if (resetTask) return resetTask;
    resetTask = (async () => {
      const before = await status();
      if (before.state !== 'live') throw Error('Restream reset requires a recognized live state; current state is ' + before.state);

      const stopLabel = await clickExactly(STOP_LABELS);
      let stopped = await waitForState('offline', 12000);
      if (stopped.state !== 'offline') {
        await maybeConfirm(STOP_CONFIRM_LABELS);
        stopped = await waitForState('offline', 30000);
      }
      if (stopped.state !== 'offline') throw Error('Restream did not reach a recognized offline state after ' + stopLabel);

      await delay(Math.max(5000, Math.min(Number(holdMs) || 15000, 30000)));

      const startLabel = await clickExactly(START_LABELS);
      let started = await waitForState('live', 15000);
      if (started.state !== 'live') {
        await maybeConfirm(START_CONFIRM_LABELS);
        started = await waitForState('live', 45000);
      }
      if (started.state !== 'live') throw Error('Restream did not return to a recognized live state after ' + startLabel);

      return {
        ok: true,
        action: 'controlled-reset',
        stoppedWith: stopLabel,
        startedWith: startLabel,
        holdMs: Math.max(5000, Math.min(Number(holdMs) || 15000, 30000)),
        before,
        after: started,
      };
    })().finally(() => { resetTask = undefined; });
    return resetTask;
  }

  async function close() {
    await browser?.close().catch(() => {});
    browser = undefined;
    page = undefined;
    await stopProcess(display);
    display = undefined;
  }

  return { status, controlledStart, controlledReset, close };
}

module.exports = { createRestreamControl, allowedRestreamHost };
