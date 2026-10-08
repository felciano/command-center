import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { transformManifest, applyOverlay, overlayFiles } from '../manifest.mjs';
import { assembleExtension } from '../build.mjs';
import { validateExtension } from '../validate.mjs';

// Always test against the current upstream manifest, including after a merge.
const source = JSON.parse(readFileSync(new URL('../../../public/manifest.json', import.meta.url), 'utf8'));

function fixture(t, manifest = source) {
  const root = mkdtempSync(join(tmpdir(), 'cc-ondemand-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = join(root, 'dist-extension');
  const output = join(root, 'dist-ondemand');
  mkdirSync(input);
  writeFileSync(join(input, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(input, 'newtab.html'), '<!doctype html><script type="module" src="./index.js"></script>');
  writeFileSync(join(input, 'index.js'), '// simulated compiled dashboard for filesystem tests only\n');
  for (const name of Object.values(manifest.icons || {})) {
    mkdirSync(dirname(join(input, name)), { recursive: true });
    writeFileSync(join(input, name), 'ICON_FIXTURE');
  }
  return { root, input, output };
}

function snapshot(root, prefix = '') {
  return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = join(prefix, entry.name);
    return entry.isDirectory() ? Object.entries(snapshot(root, name)) : [[name, readFileSync(join(root, name)).toString('base64')]];
  }));
}

test('removes new-tab override without mutating the source or its permissions', () => {
  const before = structuredClone(source);
  const output = transformManifest(source);
  assert.equal(output.chrome_url_overrides?.newtab, undefined);
  for (const key of ['key', 'version', 'permissions', 'host_permissions', 'content_security_policy']) assert.deepEqual(output[key], source[key]);
  assert.deepEqual(source, before);
});
test('declares a toolbar action, shortcut, and options page', () => {
  const output = transformManifest(source);
  assert.equal(output.background.service_worker, 'cc-launcher.js');
  assert.equal(output.action.default_popup, undefined);
  assert.equal(output.commands._execute_action.suggested_key.mac, 'Command+Shift+Y');
  assert.equal(output.options_ui.open_in_tab, true);
});
test('preserves OAuth, optional permissions, unrelated commands and future fields', () => {
  const input = { ...source, oauth2: { client_id: 'local-client', scopes: ['calendar.readonly'] }, optional_permissions: ['bookmarks'], commands: { other: { description: 'Other command' } }, future_field: { keep: true } };
  const output = transformManifest(input);
  for (const key of ['oauth2', 'optional_permissions', 'future_field']) assert.deepEqual(output[key], input[key]);
  assert.deepEqual(output.commands.other, input.commands.other);
});
test('manifest transformation is idempotent', () => {
  const output = transformManifest(source);
  assert.deepEqual(transformManifest(output), output);
});
test('refuses to overwrite a new upstream worker, action popup, options page or action command', () => {
  assert.throws(() => transformManifest({ ...source, background: { service_worker: 'another.js' } }), /different background/);
  assert.throws(() => transformManifest({ ...source, action: { default_popup: 'popup.html' } }), /action popup/);
  assert.throws(() => transformManifest({ ...source, options_page: 'settings.html' }), /options page/);
  assert.throws(() => transformManifest({ ...source, options_ui: { page: 'settings.html' } }), /options page/);
  assert.throws(() => transformManifest({ ...source, commands: { _execute_action: {} } }), /toolbar command/);
});
test('refuses an incompatible manifest, missing key, storage permission or changed entry point', () => {
  assert.throws(() => transformManifest({ ...source, manifest_version: 2 }), /Manifest V3/);
  assert.throws(() => transformManifest({ ...source, key: undefined }), /public key/);
  assert.throws(() => transformManifest({ ...source, permissions: [] }), /storage permission/);
  assert.throws(() => transformManifest({ ...source, chrome_url_overrides: { newtab: 'other.html' } }), /Unexpected/);
  assert.throws(() => transformManifest({ ...source, chrome_url_overrides: undefined }), /override is absent/);
});
test('preserves a higher minimum Chrome version', () => {
  assert.equal(transformManifest({ ...source, minimum_chrome_version: '140' }).minimum_chrome_version, '140');
});
test('copies overlay files without changing dashboard resources', t => {
  const { input } = fixture(t);
  const before = readFileSync(join(input, 'newtab.html'));
  applyOverlay(input);
  for (const name of overlayFiles) assert.ok(existsSync(join(input, name)));
  assert.deepEqual(readFileSync(join(input, 'newtab.html')), before);
  applyOverlay(input);
});
test('refuses to overwrite colliding upstream assets', t => {
  const { input } = fixture(t);
  writeFileSync(join(input, 'cc-launcher.js'), 'UNRELATED_UPSTREAM_FILE');
  assert.throws(() => applyOverlay(input), /unrelated file/);
  assert.equal(readFileSync(join(input, 'cc-launcher.js'), 'utf8'), 'UNRELATED_UPSTREAM_FILE');
});
test('build assembles a separate output and leaves upstream bytes unchanged', t => {
  const { input, output } = fixture(t);
  const before = snapshot(input);
  const result = assembleExtension(input, output);
  assert.deepEqual(snapshot(input), before);
  assert.match(result.entry, /^chrome-extension:\/\/[a-p]{32}\/newtab\.html$/);
  assert.equal(validateExtension(output).name, 'Command Center - On Demand');
  assert.ok(existsSync(join(output, 'BUILD-INFO.json')));
});
test('rebuild replaces stale output rather than accumulating files', t => {
  const { input, output } = fixture(t);
  assembleExtension(input, output);
  writeFileSync(join(output, 'stale.js'), 'old');
  assembleExtension(input, output);
  assert.equal(existsSync(join(output, 'stale.js')), false);
});
test('failed build preserves the previously installed output', t => {
  const { input, output } = fixture(t);
  assembleExtension(input, output);
  const before = snapshot(output);
  rmSync(join(input, 'index.js'));
  assert.throws(() => assembleExtension(input, output), /Missing dashboard script/);
  assert.deepEqual(snapshot(output), before);
});
test('rejects missing compiled dashboard and overlapping paths', t => {
  const { input, output } = fixture(t);
  assert.throws(() => assembleExtension(input, input), /separate/);
  assert.throws(() => assembleExtension(input, join(input, 'nested')), /separate/);
  assert.throws(() => assembleExtension(input, dirname(input)), /separate/);
  rmSync(join(input, 'newtab.html'));
  assert.throws(() => assembleExtension(input, output), /Missing compiled dashboard/);
});
test('validation rejects a reintroduced new-tab override', t => {
  const { input, output } = fixture(t);
  assembleExtension(input, output);
  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  manifest.chrome_url_overrides = { newtab: 'newtab.html' };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => validateExtension(output), /new-tab override/);
});
test('validation rejects remote or missing dashboard scripts', t => {
  const { input, output } = fixture(t);
  assembleExtension(input, output);
  writeFileSync(join(output, 'newtab.html'), '<script src="https://example.com/remote.js"></script>');
  assert.throws(() => validateExtension(output), /Remote dashboard script/);
  writeFileSync(join(output, 'newtab.html'), '<script src="./missing.js"></script>');
  assert.throws(() => validateExtension(output), /Missing dashboard script/);
});
