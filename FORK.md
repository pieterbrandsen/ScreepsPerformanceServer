# Fork notes

Fork of **[screepers/ScreepsPerformanceServer](https://github.com/screepers/ScreepsPerformanceServer)**,
which is TooAngel's `utils/test.js` grown up — the same milestone idea with Docker Compose, the
stats mod, multi-bot worlds and result export. MIT; `LICENSE.md` retained.

## Branch layout

| Branch | Purpose |
|---|---|
| `master` | the fork's own line: all four changes merged, plus its packaging. **This is what consumers install.** |
| `feat/config-from-cwd` | change 1, cut from upstream `02eab41` |
| `feat/windows-support` | change 2, same base |
| `fix/node-rmdir-deprecation` | change 3, same base |
| `feat/milestone-room-scoping` | change 4, same base |

Each change branch is cut from the upstream commit and touches nothing else, so any of them can
go upstream as a standalone PR without dragging the others along — a PR's base is
`screepers/ScreepsPerformanceServer:master`, not this fork's, so they stay valid however `master`
here moves. `master` merges all four; the only conflict was the `logs` mkdir block in
`src/helper.js`, where changes 1 and 2 touch the same lines.

Because `master` now carries our own commits it no longer fast-forwards from upstream:

```bash
git fetch upstream && git merge upstream/master     # not --ff-only
# then bump version and re-tag
```

## Distribution — git dependency, not npm

**Not published to a registry.** Consumers install from git, pinned to a tag:

```json
"devDependencies": {
  "@pieterbrandsen/screeps-performance-server":
    "github:pieterbrandsen/ScreepsPerformanceServer#v1.14.7-ucs.1"
}
```

`npm ci` installs it and its dependencies like any other package, `npx screeps-performance-server`
resolves through `node_modules/.bin`, and the tag pins the version — no publish step, no registry
credential. The scoped name is kept because npm requires the dependency key to match the
package's own name for git deps, and it leaves publishing available later at no cost.

Cutting a version: bump `version` on `ucs`, commit, `git tag vX.Y.Z-ucs.N`, `git push --tags`,
bump the consumer's ref. `files` is ignored for git installs, so the whole repo is installed —
which is why `bots/dist` is git-ignored.

Change 1 is what makes any of this possible: upstream reads its config from inside its own
folder, so as a dependency it would need consumers to edit `node_modules`.

## The four changes

### 1. Config resolves against the working directory — `feat/config-from-cwd`

`src/paths.js` (new), `setup.js`, `helper.js`, `index.js`.

Upstream resolves `config.json`, `config.yml`, `docker-compose.yml`, `.env`, `logs/` and `bots/`
with `join(__dirname, "../…")` — relative to the *package*. A base directory is resolved instead:
`--configDir` when given, else the cwd when it holds a `config.json`/`config.yml`, else the
package folder so an in-place clone is unchanged. The `.example` templates still come from the
package. `docker compose` gets `-f` and `--project-directory` rather than trusting the cwd.

**Upstream PR candidate** — nothing about it is specific to any one bot.

### 2. Windows support — `feat/windows-support`

`helper.js`, `package.json`. Upstream's README opens with "Windows not supported". Two lines:

- `execSync("mkdir -p <logs> && chmod 777 <logs>")` — POSIX shell. Now `fs.mkdirSync(…, {recursive:true})`, with the `chmod` kept for non-Windows (it exists so the container's uid can write the bind mount).
- `new Docker({ socketPath: "/var/run/docker.sock" })` — Docker Desktop exposes `//./pipe/docker_engine`. Now chosen by `process.platform`.

Also drops `node-powershell`, a declared dependency that nothing imports.

**Upstream PR candidate**, and it would let the README drop its first line.

### 3. Modern Node — `fix/node-rmdir-deprecation`

`fs.rmdirSync(path, { recursive: true })` is DEP0147 and warns on every Node since 16; now
`fs.rmSync(…, { recursive: true, force: true })`. `engines` stays `>=16`; the Node we test on is 24.

**Upstream PR candidate.**

### 4. Per-milestone room scoping — `feat/milestone-room-scoping`

`index.js`. Upstream requires **every** tracked room to satisfy a milestone's `check`, and
`status` is keyed by `trackedRooms`. With several bots in one world that couples them: "reach
RCL 3 by tick 14 100" only passes once every tracked bot has.

```json
{ "tick": 14100, "check": { "level": 3 }, "rooms": ["W1N1"], "required": true }
```

Omitting `rooms` keeps the previous behaviour. This is what makes head-to-head runs work — our
milestones gate on our room while opponents stay tracked, so both curves land in the same history.

**Upstream PR candidate.**

## Checked, deliberately unchanged

- `src/exporter.js:15-16` defaults `githubOwner`/`githubRepo` to The International's repo, but
  `sendGithubComment` returns early unless `--githubAuth`, `--githubOwner` and `--githubRepo` are
  all passed. Dead unless opted in.
- `system.resetAllData()` at the start of every run, shard renamed `performanceServer`, terminals
  inserted at W0N0/W10N10/W10N0 for market code. All wanted.
- The milestone `check` vocabulary (`level`, `creeps`, `structures`). Anything richer is read from
  the same world by [ScreepsUserTracker](https://github.com/pieterbrandsen/ScreepsUserTracker-V2)
  rather than added here.
- `upstream/rework` exists and has not been reviewed — check it before opening the PRs, in case
  it already moves any of this.

## Not yet verified

None of it has been run. First green run is M0 in the `screeps-bot` repo; until then treat the
Windows and git-install paths as designed, not proven. The four changes are independent, so a
failure in one does not implicate the others.

## Consumers

`screeps-bot/perf/` holds `config.json`, `config.yml` and a `run.ps1` that builds the bot, stages
the bundle and invokes this package.
