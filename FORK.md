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
| `fix/milestone-tick-latch` | change 6, cut from `master` - it rewrites what change 4 touches |
| `fix/server-ready-probe` | change 7, same base |
| `fix/room-object-counts` | change 8, cut from the upstream commit - it only touches code upstream still has |
| `feat/keep-server-running` | change 9, same base |
| `fix/abort-exit-code` | change 10, same base |
| `fix/followlog-unhandled-rejection` | change 11, cut from `master` - it touches `helper.js`, which changes 1, 2 and 5 already do |

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
    "github:pieterbrandsen/ScreepsPerformanceServer#v1.15.0"
}
```

`npm ci` installs it and its dependencies like any other package, `npx screeps-performance-server`
resolves through `node_modules/.bin`, and the tag pins the version — no publish step, no registry
credential. The scoped name is kept because npm requires the dependency key to match the
package's own name for git deps, and it leaves publishing available later at no cost.

Cutting a version: bump `version` on `master`, commit, `git tag vX.Y.Z`, `git push --tags`, bump
the consumer's ref.

Versioning is the fork's own line, not upstream's plus a suffix: upstream 1.14.7 plus these
changes is **1.15.0** here. Nothing resolves these numbers against a registry — the scope is
unpublished and consumers pin a tag — so an upstream 1.15.0 would not collide, though it would
read confusingly. If that happens, jump this line rather than trying to track theirs.

`files` **is** honoured for git installs — a consumer gets `src`, `bots`, `bin` and the
`.example` templates, but not `test/`, `.github/` or this file. Verified against a throwaway
consumer on 2026-09-16: `npm i github:pieterbrandsen/ScreepsPerformanceServer#v1.15.0`
links `screeps-performance-server` (plus `.cmd`/`.ps1` shims) and resolves `baseDir` to the
consumer's directory rather than `node_modules`.

Change 1 is what makes any of this possible: upstream reads its config from inside its own
folder, so as a dependency it would need consumers to edit `node_modules`.

## The changes

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

### 5. Teardown leaves images alone — on `master` (b5d7192)

`helper.js`. Upstream tears a run down with `docker compose down --volumes --remove-orphans
--rmi all`. Removing the volume is what guarantees a clean world; removing the *images* only
costs a re-pull — except on a shared host, where the launcher image is tagged
`screepers/screeps-launcher:latest` and a locally built server may be living under that same
tag. A benchmark then silently downgrades a server that had nothing to do with it. Now
`--rmi all` is dropped.

**Upstream PR candidate.**

### 6. Milestones are judged against sampled ticks — `fix/milestone-tick-latch`

`index.js`, extracted into `src/milestones.js`. Status events are *samples*: they arrive on
socket updates, not once per tick, so `event.data.gameTime` says when we looked, not when the
world changed. Upstream judged deadlines against that sample directly:

```js
milestone.success = event.data.gameTime < milestone.tick;      // latched on first pass
if (!milestone.success && milestone.tick === event.data.gameTime) { /* report failure */ }
```

Three consequences, all seen on real runs:

- A condition that held long before its deadline was recorded **failed** if the first sample to
  observe it landed on or after that deadline. `structures >= 1` at tick 100, in a room that had
  a spawn from tick 1, reported `Failed`.
- That report carried an **empty `failedRooms`** — the list is only filled when the evaluation
  block runs, and a milestone already decided skips it. Nothing had failed; the comparison had.
- A deadline the sampling **stepped over** was never reported at all, because the failure branch
  required `=== milestone.tick`. The end-of-run gate still caught required ones, so this cost
  visibility rather than correctness.

Now `judgeMilestone()` returns `pending` / `met` / `late` / `failed`: met at or before the
deadline is `met`, met only after it is `late`, and nothing is called `failed` until a sample at
or past the deadline still falls short — with the rooms that actually fell short. What sampling
cannot tell us it does not claim: a condition first *observed* after its deadline is reported as
late, not silently passed.

`test/milestones.test.mjs` covers all four verdicts Docker-free, including the two cases above;
`npm test` runs it in CI.

**Upstream PR candidate** — but it rewrites the block change 4 introduced, so it is cut from
`master` rather than from the upstream base, and would need rebasing to go up alone.

### 7. Server readiness is asked, not overheard — `fix/server-ready-probe`

`helper.js`. `waitForServerStart()` subscribed to the container's log stream and waited for one
line, `[main] exec: screeps-engine-main`. That only works if the subscription is attached to the
container that prints it and survives until it does — and the server bounces early in a run.
Measured on a run that hung: the stream attached at 16:14:51 and the container that printed the
line started at 16:14:57, six seconds later, so it was listening to an incarnation that was already
gone. The handler was `data` only, so the stream's death was silent; the run then sat through the
full 30-minute race doing nothing at all, with the world ticking at the server default of 1000 ms
and no line anywhere saying why. A benchmark that hangs looks exactly like a benchmark that is
still running.

It now polls the CLI for `system.getTickDuration()` until it answers. That is a positive signal for
precisely what every caller does next — issue CLI commands — and unlike a log line it can be asked
again, so attaching late or to the wrong container costs one more poll rather than the run. It also
cannot report ready before the CLI can actually take commands, which the log line could. The wait
is bounded and says so when it gives up.

This removes the only use of `dockerode`, so the dependency goes with it, along with its Windows
named-pipe special case.

**Upstream PR candidate.**

### 8. A room's contents are counted, not its sightings - `fix/room-object-counts`

`helper.js`, `index.js`, new `src/room-objects.js`. `updateCreeps` and `updateStructures` added the
size of every room update to a running total. A room subscription sends the whole room once and
deltas after that, so the total counted sightings rather than contents: it never fell when a creep
died, and every creep counted, including other players'.

Measured on a private server while a run was going: the tracked room held no creeps at all - the
server's own object list was two sources, a controller, a mineral and a spawn - while the status
line printed `"creeps": 2` at tick 8952 and `"creeps": 4` at tick 15050, as an opponent's scouts
crossed it. `structures` had the same shape, counting only spawns and extensions but never
releasing one that was destroyed.

Milestones are judged against exactly these numbers (`index.js`, `status[room][key] < check[key]`),
so `check: { creeps: N }` could be met by passers-by while the bot had nothing of its own, and once
enough had wandered through it could never fail again.

The new module keeps object ids: an update adds what it introduces, `null` removes it, and a delta
without a `type` - a creep that merely moved - changes nothing. Only the room owner's objects are
counted, the owner being learned from the spawn or controller in the first update, which carries
the whole room. `test/room-objects.test.mjs` covers each of those, including the two-scouts case
that produced the wrong numbers above.

**Upstream PR candidate.**

### 9. The server can outlive the run - `feat/keep-server-running`

`index.js`. The runner ran `docker compose stop` the moment the simulation ended. `screepsmod-history`
writes a file only when its 100-tick window completes, so stopping mid-window loses that window for
good: measured after a 25 000-tick run, the server answered 200 for every history file up to 24 800
and 500 for 24 900, and still does. A hundred ticks of the run that nothing can recover, on every
run, silently.

The stop is also usually undone at once - a caller that wants the world, to read history out of it
or to pause and look at it, starts the containers straight back up, which ours does two seconds
later. `--keepServerRunning` leaves them up and the default is unchanged, so this is additive for
anyone upstream who relies on the stop.

**Upstream PR candidate.**

### 10. An aborted run says so - `fix/abort-exit-code`

`index.js`. The SIGINT handler ends with `process.exit()`, which is exit code 0, and the runner
emits SIGINT on itself when the server will not start. So a run that never began reported success.

Measured: a host busy enough that the server's install ran past the 30-minute startup budget printed
"Timeout starting server!", aborted, exited 0, and the calling script announced "all required
milestones hit" for a world still on tick 0. Nothing downstream could tell that from a real run
except by looking at the data afterwards.

It exits 130 now - what a shell reports for SIGINT - which covers both a human pressing Ctrl-C and
the runner giving up, since in both cases the run did not happen.

**Upstream PR candidate.**

### 11. One room's auth failure cannot crash every room's - `fix/followlog-unhandled-rejection`

`helper.js`, new `src/isolated-tasks.js`. `followLog`'s `rooms.forEach(async (room) => {...})` ran
every room's `ScreepsAPI` auth concurrently, but `forEach` neither awaits nor catches its async
callbacks - a rejection from any one of them is an unhandled rejection in the whole Node process,
which crashes it.

Measured on a 20-room world (`screeps-bot`'s M1 corpus runs, each room its own account spun up in
the same pass): all 20 accounts spawned, were whitelisted and got their CLI-minted perf tokens
successfully - the crash came afterward, in `followLog`, where one room's auth got `Not
Authorized`. The likely cause is a race between `setPassword`'s CLI write committing and
`followLog`'s auth reading it back moments later, which is exactly the kind of timing that gets
more likely, not less, the more accounts are being set up in the same pass - a 2-room world (the
only prior multi-room use of this package) apparently never hit it. Whichever room's auth happened
to finish first kept running standalone; the other 19 - already spawned and simulating, with
nothing wrong with any of them - lost their history and live status entirely, because the crash
took the process running all of them down with it, not just the one that failed.

`followLog` only feeds live status/console updates over a socket; a room's own benchmark and
`screepsmod-history` output do not depend on it at all. So the fix is isolation, not correctness:
`runIsolated` (`src/isolated-tasks.js`) runs each room's auth as its own task, retried up to 3
times with a short delay, and unaffected by every other task's outcome. A room still failing after
retries is skipped with a `console.log` naming it, not thrown - its benchmark and history are
unaffected, it only loses this one live feed. `test/isolated-tasks.test.mjs` covers isolation,
per-task retry budgets, and giving up after they're exhausted, without touching the network.

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

## Verification status

Run end to end from the `screeps-bot` repo since 2026-09-17, on Windows with Docker Desktop and
on Linux over ssh: both bots spawn, the world runs, and a 20 000-tick run has exited 0. The gate
has also been watched to fail on purpose, which is the half that matters. Still unproven: the
`--record` profile and any run under the corrected milestone judging of change 6.

## Consumers

`screeps-bot/perf/` holds `config.json`, `config.yml` and a `run.ps1` that builds the bot, stages
the bundle and invokes this package.
