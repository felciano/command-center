import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const script = readFileSync(new URL('../overlay/cc-launcher.js', import.meta.url), 'utf8');
const base = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
const key = 'ccOnDemandLauncherSettingsV1';
function harness({ settings = {}, contexts = [], state = 'normal', normalWindows = [{ id: 7, focused: true }], failCreate = false, stale = false } = {}) {
  const calls = [], handlers = {};
  const chrome = {
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      getURL: name => base + name,
      getContexts: async () => contexts,
      onMessage: { addListener: callback => { handlers.message = callback; } },
    },
    storage: { local: { get: async () => ({ [key]: settings }) } },
    windows: {
      create: async data => { calls.push(['window.create', data]); if (failCreate) throw new Error('creation failed'); return { id: 55 }; },
      get: async id => { if (stale) throw new Error('closed'); return { id, state }; },
      getAll: async () => normalWindows,
      update: async (id, data) => { calls.push(['window.update', id, data]); return { id, ...data }; },
    },
    tabs: {
      create: async data => { calls.push(['tab.create', data]); return { id: 44, windowId: data.windowId }; },
      update: async (id, data) => { calls.push(['tab.update', id, data]); return { id }; },
    },
    action: {
      onClicked: { addListener: callback => { handlers.action = callback; } },
      setBadgeText: async data => { calls.push(['badge', data]); },
      setTitle: async data => { calls.push(['title', data]); },
    },
  };
  const context = vm.createContext({ chrome, URL, console: { error() {}, debug() {} } });
  vm.runInContext(script, context);
  return { context, calls, handlers, launch: () => context.ccLaunchDashboard() };
}
const existing = { frameId: 0, tabId: 44, windowId: 55, documentUrl: base + 'newtab.html' };

test('default is an app-like popup window', async () => {
  const h = harness(); await h.launch();
  const created = h.calls.find(row => row[0] === 'window.create');
  assert.equal(created[1].type, 'popup'); assert.equal(created[1].url, base + 'newtab.html');
});
test('existing dashboard is focused, not duplicated', async () => {
  const h = harness({ contexts: [existing] }); const result = await h.launch();
  assert.equal(result.reused, true);
  assert.equal(h.calls.filter(row => row[0].endsWith('.create')).length, 0);
  assert.ok(h.calls.some(row => row[0] === 'window.update' && row[2].focused));
});
test('minimized dashboard is restored before being focused', async () => {
  const h = harness({ contexts: [existing], state: 'minimized' }); await h.launch();
  assert.ok(h.calls.some(row => row[0] === 'window.update' && row[2].state === 'normal'));
});
test('maximized/fullscreen dashboard is not forcibly resized', async () => {
  const h = harness({ contexts: [existing], state: 'maximized' }); await h.launch();
  assert.equal(h.calls.some(row => row[0] === 'window.update' && row[2].state), false);
});
test('stale dashboard context falls back to opening a new window', async () => {
  const h = harness({ contexts: [existing], stale: true }); await h.launch();
  assert.ok(h.calls.some(row => row[0] === 'window.create'));
});
test('unrelated contexts and similarly named pages are not reused', async () => {
  const h = harness({ contexts: [{ ...existing, documentUrl: base + 'newtab.html.fake' }, { ...existing, documentUrl: 'https://example.com/newtab.html' }] });
  await h.launch(); assert.ok(h.calls.some(row => row[0] === 'window.create'));
});
test('dashboard query strings and fragments are recognized', async () => {
  const h = harness({ contexts: [{ ...existing, documentUrl: base + 'newtab.html?view=one#section' }] });
  assert.equal((await h.launch()).reused, true);
});
test('concurrent launches share one in-flight request', async () => {
  const h = harness(); await Promise.all([h.launch(), h.launch(), h.launch()]);
  assert.equal(h.calls.filter(row => row[0] === 'window.create').length, 1);
});
test('reuse can be disabled', async () => {
  const h = harness({ settings: { reuse: false }, contexts: [existing] }); await h.launch();
  assert.ok(h.calls.some(row => row[0] === 'window.create'));
});
test('tab mode uses a normal browser window', async () => {
  const h = harness({ settings: { mode: 'tab' } }); await h.launch();
  assert.equal(h.calls.find(row => row[0] === 'tab.create')[1].windowId, 7);
});
test('tab mode creates a normal window when none exists', async () => {
  const h = harness({ settings: { mode: 'tab' }, normalWindows: [] }); await h.launch();
  assert.equal(h.calls.find(row => row[0] === 'window.create')[1].type, 'normal');
});
test('invalid preference values use the safe defaults', async () => {
  const h = harness({ settings: { mode: 'bogus', reuse: null } }); await h.launch();
  assert.equal(h.calls.find(row => row[0] === 'window.create')[1].type, 'popup');
});
test('failure is reported and the launch lock is released', async () => {
  const h = harness({ failCreate: true });
  await assert.rejects(h.launch(), /creation failed/);
  await assert.rejects(h.launch(), /creation failed/);
  assert.equal(h.calls.filter(row => row[0] === 'window.create').length, 2);
  assert.ok(h.calls.some(row => row[0] === 'badge' && row[1].text === '!'));
});
test('registers a toolbar click handler without launching at worker startup', () => {
  const h = harness(); assert.equal(typeof h.handlers.action, 'function'); assert.equal(h.calls.length, 0);
});
test('launch messages require the actual extension options page', async () => {
  const h = harness();
  const message = { type: 'CC_ON_DEMAND_LAUNCH' };
  assert.equal(h.handlers.message(message, { id: 'other', url: base + 'cc-launcher-options.html' }, () => {}), false);
  assert.equal(h.handlers.message(message, { id: 'abcdefghijklmnopabcdefghijklmnop', url: 'https://example.com/' }, () => {}), false);
  const response = await new Promise(resolve => {
    const keepOpen = h.handlers.message(message, { id: 'abcdefghijklmnopabcdefghijklmnop', url: base + 'cc-launcher-options.html' }, resolve);
    assert.equal(keepOpen, true);
  });
  assert.equal(response.ok, true);
});
