#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { overlayFiles } from './manifest.mjs';

export function validateExtension(target) {
  const folder = resolve(target);
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(!manifest.chrome_url_overrides?.newtab, 'The new-tab override must be absent.');
  assert.equal(manifest.background?.service_worker, 'cc-launcher.js');
  assert.ok(manifest.action && !manifest.action.default_popup, 'Toolbar action must not have a popup.');
  assert.equal(manifest.options_ui?.page, 'cc-launcher-options.html');
  assert.ok(manifest.commands?._execute_action?.suggested_key?.mac);
  assert.ok(manifest.key, 'Public key must be preserved.');
  for (const name of ['newtab.html', ...overlayFiles, ...Object.values(manifest.icons || {})]) {
    assert.ok(existsSync(join(folder, name)) && statSync(join(folder, name)).isFile(), `Missing file: ${name}`);
  }
  const html = readFileSync(join(folder, 'newtab.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]);
  assert.ok(scripts.length > 0, 'The dashboard must contain its real compiled script entry.');
  for (const source of scripts) {
    assert.ok(!/^(?:[a-z]+:|\/\/)/i.test(source), `Remote dashboard script is not allowed: ${source}`);
    assert.ok(!source.startsWith('/'), `Absolute dashboard script path is not allowed: ${source}`);
    const file = resolve(folder, source.split(/[?#]/)[0]);
    assert.ok(file.startsWith(`${folder}${sep}`) && existsSync(file), `Missing dashboard script: ${source}`);
  }
  const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
    .slice(0, 32).replace(/[0-9a-f]/g, ch => String.fromCharCode(97 + parseInt(ch, 16)));
  return { name: manifest.name, version: manifest.version, extensionId: id, entry: `chrome-extension://${id}/newtab.html` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/ondemand/validate.mjs /path/to/compiled-extension');
    console.log(JSON.stringify(validateExtension(process.argv[2]), null, 2));
  } catch (error) { console.error(`Extension validation failed: ${error.message}`); process.exitCode = 1; }
}
