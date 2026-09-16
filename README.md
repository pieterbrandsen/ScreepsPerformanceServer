# @pieterbrandsen/screeps-performance-server

A disposable Screeps world for benchmarking a bot. Spins up a private server in Docker, spawns
your bot and any opponents from a clean start, runs N ticks at a fixed tick rate, checks
milestones every tick and **exits non-zero** if a required one is missed.

Fork of [screepers/ScreepsPerformanceServer](https://github.com/screepers/ScreepsPerformanceServer)
v1.14.7 — see [FORK.md](FORK.md). The differences that matter to you:

- **Installable.** Config is read from your working directory, not from inside `node_modules`.
- **Runs on Windows.** Docker Desktop's named pipe and portable path handling.
- **Per-milestone room scoping.** `milestone.rooms` judges only the rooms you name, so opponents
  in the same world do not hold your criteria back.

## Use from another repo

```bash
npm i -D @pieterbrandsen/screeps-performance-server
```

Put `config.json` and `config.yml` in the directory you run from, then:

```bash
npx screeps-performance-server --maxTickCount=20000 --maxBots=2 --deleteLogs
```

Config is resolved as: `--configDir <path>` → the cwd if it holds a `config.json`/`config.yml`
→ this package (so a plain clone still works). Missing files are generated from the bundled
`.example` templates on first run.

## Milestones

```json
{
  "userCpuLimit": 20,
  "rooms": [
    { "room": "W1N1", "name": "mybot",    "opts": { "x": 25, "y": 25 } },
    { "room": "W5N5", "name": "hivemind", "opts": { "auto": true } }
  ],
  "trackedRooms": ["W1N1", "W5N5"],
  "milestones": [
    { "tick": 1000,  "check": { "level": 2 }, "rooms": ["W1N1"], "required": true },
    { "tick": 14100, "check": { "level": 3 }, "rooms": ["W1N1"], "required": true }
  ]
}
```

`check` supports `level` (RCL), `creeps` and `structures`. `rooms` is optional; without it every
tracked room must pass, which is upstream's behaviour. `required: true` makes a miss fail the
run.

## Flags

Config: `--configDir` (new), `--debug`, `--force`, `--botFilePath`, `--steamKey`, `--deleteLogs`.
Network: `--serverPort`, `--cliPort`, `--relayPort`, `--disableMongo`.
Server: `--maxBots`, `--tickDuration` (ms, default 100), `--maxTickCount`, `--maxTimeDuration` (min).
Export: `--discordWebHookUrl`, `--discordUsername`, `--githubOwner`, `--githubRepo`, `--githubAuth`,
`--pasteBinUrlDevKey`, `--logFilter`.

## Requirements

Node 16+, Docker with Compose. The admin dashboard is on `localhost:21025`; the pre-spawned
user's password is `password`. Every run calls `system.resetAllData()` — the world is disposable.
