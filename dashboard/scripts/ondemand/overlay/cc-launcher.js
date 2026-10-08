/* Command Center On Demand 1.0.0. No network calls or additional permissions.
 * This worker does not register onInstalled or onStartup launch handlers.
 * Settings use a separate key; the dashboard's settings are not modified.
 */
'use strict';

const CC_SETTINGS_KEY = 'ccOnDemandLauncherSettingsV1';
const CC_TITLE = 'Open Command Center';
let ccLaunchInFlight = null;

function ccIsDashboardUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const actual = new URL(value);
    const expected = new URL(chrome.runtime.getURL('newtab.html'));
    return actual.protocol === expected.protocol &&
      actual.host === expected.host && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}

async function ccReadSettings() {
  const stored = await chrome.storage.local.get(CC_SETTINGS_KEY);
  const value = stored[CC_SETTINGS_KEY] || {};
  return {
    mode: value.mode === 'tab' ? 'tab' : 'window',
    reuse: value.reuse !== false,
  };
}

async function ccFocusExisting() {
  // getContexts sees only this extension's contexts, not browsing history.
  // It also works after this MV3 worker is suspended and restarted.
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB', 'POPUP'] });
  const candidates = contexts.filter(context =>
    context.frameId === 0 && context.tabId >= 0 && context.windowId >= 0 &&
    ccIsDashboardUrl(context.documentUrl)
  );
  for (const context of candidates) {
    try {
      const window = await chrome.windows.get(context.windowId);
      if (window.state === 'minimized') {
        await chrome.windows.update(context.windowId, { state: 'normal' });
      }
      await chrome.tabs.update(context.tabId, { active: true });
      await chrome.windows.update(context.windowId, { focused: true });
      return { reused: true, tabId: context.tabId, windowId: context.windowId };
    } catch (error) {
      // The user may have closed the tab between discovery and activation.
      console.debug('Command Center: existing window unavailable.', error);
    }
  }
  return null;
}

async function ccOpenDashboard() {
  const settings = await ccReadSettings();
  if (settings.reuse) {
    const existing = await ccFocusExisting();
    if (existing) return existing;
  }
  const url = chrome.runtime.getURL('newtab.html');
  if (settings.mode === 'tab') {
    // Prefer an ordinary browser window. A popup window cannot host a tab strip.
    const normalWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const target = normalWindows.find(window => window.focused) || normalWindows[0];
    if (target && typeof target.id === 'number') {
      const tab = await chrome.tabs.create({ windowId: target.id, url, active: true });
      if (target.state === 'minimized') {
        await chrome.windows.update(target.id, { state: 'normal' });
      }
      await chrome.windows.update(target.id, { focused: true });
      return { reused: false, tabId: tab.id, windowId: target.id };
    }
    const window = await chrome.windows.create({ url, type: 'normal', focused: true });
    return { reused: false, windowId: window && window.id };
  }
  const window = await chrome.windows.create({
    url, type: 'popup', width: 1280, height: 900, focused: true,
  });
  return { reused: false, windowId: window && window.id };
}

async function ccSetStatus(error) {
  // Reporting must never turn a successful launch into a failed one.
  try {
    await chrome.action.setBadgeText({ text: error ? '!' : '' });
    await chrome.action.setTitle({
      title: error ? 'Command Center could not open. See Extension options for help.' : CC_TITLE,
    });
  } catch (statusError) {
    console.debug('Command Center: could not update toolbar status.', statusError);
  }
}

function ccLaunchDashboard() {
  // Coalesce simultaneous clicks/shortcut presses while a launch is pending.
  if (ccLaunchInFlight) return ccLaunchInFlight;
  ccLaunchInFlight = ccOpenDashboard()
    .then(async result => {
      await ccSetStatus(null);
      return result;
    })
    .catch(async error => {
      console.error('Command Center launch failed:', error);
      await ccSetStatus(error);
      throw error;
    })
    .finally(() => { ccLaunchInFlight = null; });
  return ccLaunchInFlight;
}

chrome.action.onClicked.addListener(() => {
  void ccLaunchDashboard().catch(() => { /* Reported by ccSetStatus. */ });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'CC_ON_DEMAND_LAUNCH' ||
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('cc-launcher-options.html')) return false;
  ccLaunchDashboard().then(
    result => sendResponse({ ok: true, ...result }),
    error => sendResponse({ ok: false, error: String(error.message || error) }),
  );
  return true; // Keep the reply channel open for the asynchronous launch.
});
