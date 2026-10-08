// Run after build:extension. Never rewrite public/ or dist-extension/.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { applyOverlay } from './manifest.mjs';
import { validateExtension } from './validate.mjs';

const dashboard = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function nested(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

export function assembleExtension(source, output) {
  const sourceDir = resolve(source);
  const outputDir = resolve(output);
  if (nested(sourceDir, outputDir) || nested(outputDir, sourceDir)) {
    throw new Error('Source and output must be separate, non-nested directories.');
  }
  if (!existsSync(join(sourceDir, 'newtab.html'))) {
    throw new Error('Missing compiled dashboard. Run pnpm run build:extension first.');
  }
  if (existsSync(outputDir) && (!lstatSync(outputDir).isDirectory() || lstatSync(outputDir).isSymbolicLink())) {
    throw new Error('Refusing to replace an output that is not an ordinary directory.');
  }
  mkdirSync(dirname(outputDir), { recursive: true });
  const staging = mkdtempSync(join(dirname(outputDir), '.cc-ondemand-'));
  const next = join(staging, 'next');
  const previous = join(staging, 'previous');
  let movedPrevious = false;
  try {
    cpSync(sourceDir, next, { recursive: true, errorOnExist: true, force: false });
    applyOverlay(next);
    const result = validateExtension(next);
    // Check invariants against THIS upstream build, not a stale manifest fixture.
    const original = JSON.parse(readFileSync(join(sourceDir, 'manifest.json'), 'utf8'));
    const derived = JSON.parse(readFileSync(join(next, 'manifest.json'), 'utf8'));
    for (const field of ['key', 'version', 'permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_security_policy', 'oauth2']) {
      if (JSON.stringify(derived[field]) !== JSON.stringify(original[field])) {
        throw new Error(`On-demand build changed upstream ${field}.`);
      }
    }
    let revision = process.env.GITHUB_SHA || null;
    if (!revision) {
      try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
      catch { /* A downloaded source ZIP has no .git metadata. */ }
    }
    writeFileSync(join(next, 'BUILD-INFO.json'), JSON.stringify({ ...result, flavor: 'on-demand', revision, builtAt: new Date().toISOString() }, null, 2) + '\n');
    // Validate before replacing a previously installed build; restore on failure.
    if (existsSync(outputDir)) {
      renameSync(outputDir, previous);
      movedPrevious = true;
    }
    try { renameSync(next, outputDir); }
    catch (error) {
      if (movedPrevious) renameSync(previous, outputDir);
      throw error;
    }
    return result;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = assembleExtension(join(dashboard, 'dist-extension'), join(dashboard, 'dist-ondemand'));
    console.log('On-demand extension ready in dashboard/dist-ondemand/');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`On-demand build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
