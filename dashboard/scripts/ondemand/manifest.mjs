#!/usr/bin/env node
// Derive the on-demand manifest from upstream; only apply to a staged build.
import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const overlayFiles = [
  'cc-launcher.js', 'cc-launcher-options.html',
  'cc-launcher-options.js', 'cc-launcher-options.css',
];
const here = dirname(fileURLToPath(import.meta.url));

export function transformManifest(original) {
  const manifest = structuredClone(original);
  if (manifest.manifest_version !== 3) throw new Error('Expected a Manifest V3 extension. Nothing was changed.');
  if (!manifest.permissions?.includes('storage')) throw new Error('Expected the dashboard storage permission.');
  if (!manifest.key) throw new Error('Expected the upstream public key, needed to preserve the extension ID.');
  if (manifest.background && manifest.background.service_worker !== 'cc-launcher.js') {
    throw new Error('This version already has a different background worker. Review and merge it; refusing to overwrite it.');
  }
  if (manifest.action?.default_popup) throw new Error('This version already has an action popup. Review it before patching.');
  if (manifest.options_page || (manifest.options_ui && manifest.options_ui.page !== 'cc-launcher-options.html')) {
    throw new Error('This version already has an options page. Refusing to overwrite it.');
  }
  const entry = manifest.chrome_url_overrides?.newtab;
  if (entry && entry !== 'newtab.html') throw new Error(`Unexpected dashboard entry point: ${entry}`);
  if (!entry && manifest.background?.service_worker !== 'cc-launcher.js') {
    throw new Error('Not the expected Command Center manifest: newtab.html override is absent.');
  }
  if (manifest.chrome_url_overrides) {
    delete manifest.chrome_url_overrides.newtab;
    if (Object.keys(manifest.chrome_url_overrides).length === 0) delete manifest.chrome_url_overrides;
  }
  if (manifest.commands?._execute_action && manifest.background?.service_worker !== 'cc-launcher.js') {
    throw new Error('Upstream now assigns the toolbar command. Review it before patching.');
  }
  manifest.name = 'Command Center - On Demand';
  manifest.description = 'Your Command Center dashboard, on demand. Open from the toolbar or a shortcut; keep your existing new-tab page.';
  manifest.version_name = `${manifest.version} (on-demand 1.0.0)`;
  if (!manifest.minimum_chrome_version || Number(manifest.minimum_chrome_version.split('.')[0]) < 116) {
    manifest.minimum_chrome_version = '116';
  }
  manifest.action = { ...manifest.action, default_title: 'Open Command Center' };
  if (manifest.icons) manifest.action.default_icon = manifest.icons;
  manifest.background = { service_worker: 'cc-launcher.js' };
  manifest.options_ui = { page: 'cc-launcher-options.html', open_in_tab: true };
  manifest.commands = {
    ...manifest.commands,
    _execute_action: { suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' } },
  };
  // Permissions, host permissions, CSP, public key, and OAuth configuration are
  // intentionally unchanged. The launcher needs no broader browsing access.
  return manifest;
}

export function applyOverlay(target) {
  const folder = resolve(target);
  const manifestPath = join(folder, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`No manifest.json in ${folder}`);
  const original = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const transformed = transformManifest(original);
  for (const name of overlayFiles) {
    const source = join(here, 'overlay', name);
    const destination = join(folder, name);
    if (existsSync(destination) && original.background?.service_worker !== 'cc-launcher.js' &&
        !readFileSync(source).equals(readFileSync(destination))) {
      throw new Error(`Refusing to replace an unrelated file: ${destination}`);
    }
  }
  for (const name of overlayFiles) copyFileSync(join(here, 'overlay', name), join(folder, name));
  const temporaryPath = `${manifestPath}.on-demand.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(transformed, null, 2)}\n`);
  renameSync(temporaryPath, manifestPath);
  return transformed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/ondemand/manifest.mjs /path/to/staged-extension');
    applyOverlay(process.argv[2]);
    console.log(`Applied on-demand launcher to ${resolve(process.argv[2])}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
