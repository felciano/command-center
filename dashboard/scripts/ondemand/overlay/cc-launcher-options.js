'use strict';
const SETTINGS_KEY = 'ccOnDemandLauncherSettingsV1';
const form = document.querySelector('#settings-form');
const status = document.querySelector('#status');
const launchButton = document.querySelector('#launch');
const reuse = document.querySelector('#reuse');

function showError(error) {
  status.textContent = `Unable to complete that action: ${error.message || error}`;
}

async function save() {
  const mode = new FormData(form).get('mode') === 'tab' ? 'tab' : 'window';
  await chrome.storage.local.set({ [SETTINGS_KEY]: { mode, reuse: reuse.checked } });
}

async function load() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = data[SETTINGS_KEY] || {};
  const mode = settings.mode === 'tab' ? 'tab' : 'window';
  form.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  reuse.checked = settings.reuse !== false;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  try { await save(); status.textContent = 'Preferences saved.'; }
  catch (error) { showError(error); }
});

launchButton.addEventListener('click', async () => {
  launchButton.disabled = true;
  try {
    await save();
    const result = await chrome.runtime.sendMessage({ type: 'CC_ON_DEMAND_LAUNCH' });
    if (!result || !result.ok) throw new Error(result?.error || 'No response from the launcher. Reload the extension and try again.');
    status.textContent = result.reused ? 'Existing dashboard focused.' : 'Dashboard opened.';
  } catch (error) { showError(error); }
  finally { launchButton.disabled = false; }
});

document.querySelector('#shortcuts').addEventListener('click', async () => {
  try { await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); }
  catch (error) { showError(error); }
});

void load().catch(showError);
