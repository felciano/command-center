# Command Center - On Demand

Personal customization of `CoolAssPuppy/command-center`, maintained on the
`on-demand` branch of `felciano/command-center`. `main` stays an unmodified
upstream-tracking branch. Start here for the on-demand version; the original
README describes the upstream new-tab version.

The dashboard opens only when explicitly launched, rather than replacing your
new-tab page. Momentum can remain your new-tab extension. This is a Chrome
extension window, not an independent macOS application.

## Install a GitHub Actions build (no local compilation)

1. Open this repository's **Actions** tab and select a successful **On-demand
   extension** run for the `on-demand` branch.
2. Download its `command-center-on-demand-<commit>` artifact and extract the ZIP
   into a permanent folder, such as `~/Applications/command-center-on-demand`.
3. Open `chrome://extensions`, enable **Developer mode**, and **Load unpacked**
   from the extracted folder containing `manifest.json`.
4. Pin **Command Center - On Demand**. Click its toolbar button to launch it.

The workflow runs on pushes and pull requests to `on-demand`, not `main`.
Artifacts are retained for 30 days. If GitHub has disabled workflows for the
new fork, enable them in **Actions**, then push a commit to `on-demand` to
trigger the first build. A retrigger without source changes is:

```bash
git switch on-demand
git commit --allow-empty -m "Run on-demand build"
git push origin on-demand
```

There is deliberately no default-branch workflow or scheduled auto-merge.
Adding a workflow only on `on-demand` keeps `main` identical to upstream.

## Build locally

Use Node.js 22.12+ (Node 24 recommended; CI uses Node 24) and pnpm 10.
Install pnpm first if it is not available:

```bash
npm install --global pnpm@10.15.1
```

Clone the correct branch and build:

```bash
git clone --branch on-demand https://github.com/felciano/command-center.git
cd command-center/dashboard
pnpm install --frozen-lockfile
pnpm run test:ondemand
pnpm run build:ondemand
pnpm run validate:ondemand
```

Load **`dashboard/dist-ondemand`**, NOT `dashboard/dist-extension`, in Chrome.
The latter is the upstream version and still replaces new tabs.

| Command (from `dashboard/`) | Purpose |
| --- | --- |
| `pnpm run build:extension` | Unchanged original new-tab build in `dist-extension/` |
| `pnpm run build:ondemand` | Builds the original, then creates a separate on-demand copy in `dist-ondemand/` |
| `pnpm run test:ondemand` | Dependency-free Node launcher and build-safety tests |
| `pnpm run validate:ondemand` | Checks the compiled on-demand manifest and required files |
| `pnpm test` | Original upstream test suite |
| `pnpm run lint` | Original lint and TypeScript checks |

No additional runtime dependencies or Chrome permissions are introduced.
The existing lockfile, dashboard source, `public/manifest.json`, extension
build configuration, and Safari target are left unchanged.

## Behavior and preferences

The default is a separate 1280 x 900 app-like Chrome window. Launching again
focuses an already loaded dashboard, restoring it if minimized. Simultaneous
launch requests are coalesced. No install/startup event launches the dashboard.
Reuse discovers this extension's live contexts rather than browsing history;
an unloaded or discarded dashboard may not be discovered and a new one may open.

Right-click the toolbar icon and choose **Options** to switch between window
and tab mode, disable reuse, or open the dashboard. Mode changes affect the
next newly opened dashboard; close an existing one first when reuse is enabled.
Preferences use `chrome.storage.local` under `ccOnDemandLauncherSettingsV1`,
separate from the dashboard's settings.

The suggested shortcut is **Command+Shift+Y** on Mac, **Ctrl+Shift+Y** elsewhere.
Set or change it at `chrome://extensions/shortcuts`. Chrome may leave a
conflicting shortcut unassigned. It is not a system-wide macOS hotkey.
The launcher needs Chrome 116+ for `chrome.runtime.getContexts`.

## Updating an installed copy, including the earlier build kit

Keep the **same installed folder and extension identity**. For a source install,
rebuild `dist-ondemand`, then click **Reload** on the extension card. For an
Actions download, replace the files in the previously installed folder, then
reload. Reopen the dashboard after the extension reload.

If the earlier standalone build kit is already installed, copy the contents of
`dist-ondemand/` into that kit's previously loaded `extension/` folder and reload
its existing extension card. The public key and launcher preference key are
preserved. Do not uninstall just to update; back up dashboard settings first.

Both Command Center flavors deliberately retain the upstream public key and
therefore the same extension ID. Do not try to run both variants side by side
in one Chrome profile. This does not affect Momentum, which has a different ID.

Google OAuth and service API keys still require the upstream configuration;
this fork does not supply credentials or automatically connect accounts. See
[the upstream packaging guide](docs/packaging.md). Never commit credentials,
private keys, or exported dashboard settings to this public fork. The manifest
public key is not a private signing key.

## Pulling in upstream improvements

Set up the upstream remote once:

```bash
git remote add upstream https://github.com/CoolAssPuppy/command-center.git
```

With a clean working tree, update the mirror and merge into the custom branch:

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch on-demand
git merge main
cd dashboard
pnpm install --frozen-lockfile
pnpm run lint
pnpm test
pnpm run test:ondemand
pnpm run build:ondemand
pnpm run validate:ondemand
cd ..
git push origin on-demand
```

Resolve conflicts deliberately. Review manifest permissions and dependency
changes before installing. Do not use a force sync or reset on `on-demand`:
that would discard the customization. Do not merge `on-demand` back into `main`
while using this upstream-mirror arrangement.

GitHub Actions produces a new artifact only when all checks pass. Repository
updates do not update Chrome automatically; install the rebuilt files and reload.

## How the customization is isolated

All launcher assets, manifest transformation, build assembly, validation and
Node tests live under `dashboard/scripts/ondemand/`. The scripts directory is
already outside the upstream TypeScript lint scope. Node tests use `.check.mjs`
names so upstream Vitest does not try to run Node's separate test runner.

The build copies `dist-extension/` into a temporary staging directory, derives
the on-demand manifest, adds the launcher, validates everything, and only then
replaces `dist-ondemand/`. It preserves the previous output when validation
fails. Original build resources are not rewritten. Build provenance is recorded
in `BUILD-INFO.json`; build output is ignored by Git.

The manifest transform preserves upstream permissions, CSP, OAuth configuration,
public key and version. It rejects unexpected upstream background workers,
action popups, options pages, action shortcuts or entry points rather than
silently overwriting them. After an upstream change, review any such conflict
and adapt this small layer. The original manifest is the source of truth;
there is no second frozen copy to maintain.

The Actions workflow has read-only repository permissions, pins the referenced
Actions to commit SHAs, installs locked dependencies, and uploads only the
compiled on-demand extension. It does not publish a release or Web Store listing.

## Verification and limitations

The Node suite covers manifest invariants, file-copy isolation, collision
handling, failed-build rollback, window/tab launch, reuse, stale contexts,
minimized-window restoration, concurrent requests and options-message validation.
These tests use a mocked Chrome API and a simulated compiled dashboard for
filesystem checks. They do not replace live Chrome testing.

After installation, check: a normal new tab still opens Momentum; the toolbar
and shortcut open Command Center; a second launch focuses it; minimizing and
relaunching restores it; Options switches modes; preferences survive reload.
Also verify any authenticated integrations you configure.

The upstream repository had no detected license when this customization was
prepared on 2026-10-08. No license or ownership claim is added to upstream code.
Clarify redistribution permission with its author before broader distribution.
