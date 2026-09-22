// Docker-free checks for the task isolation in src/isolated-tasks.js.
// Run: node test/isolated-tasks.test.mjs
import assert from "node:assert/strict";
import { runIsolated } from "../src/isolated-tasks.js";

const noSleep = () => Promise.resolve();

// The bug. A bare `rooms.forEach(async ...)` lets one task's rejection crash the whole process -
// simulated here as "the second task would have thrown, and the promise returned to the caller
// must still resolve, and the first/third tasks must still have run to completion".
{
  const ran = [];
  await runIsolated(
    [
      { label: "a", run: async () => ran.push("a") },
      {
        label: "b",
        run: async () => {
          throw new Error("boom");
        },
      },
      { label: "c", run: async () => ran.push("c") },
    ],
    { attempts: 1, sleep: noSleep }
  );
  assert.deepEqual(
    ran.sort(),
    ["a", "c"],
    "one task failing does not stop or crash the others"
  );
}

// Retries a failing task up to the configured attempt count, then gives up - it does not retry
// forever and does not throw out of runIsolated itself.
{
  let calls = 0;
  const giveUps = [];
  await runIsolated(
    [
      {
        label: "flaky",
        run: async () => {
          calls += 1;
          throw new Error(`fail ${calls}`);
        },
      },
    ],
    {
      attempts: 3,
      sleep: noSleep,
      onGiveUp: (label, error) => giveUps.push([label, error.message]),
    }
  );
  assert.equal(calls, 3, "tried exactly `attempts` times, no more and no fewer");
  assert.deepEqual(
    giveUps,
    [["flaky", "fail 3"]],
    "reports the label and the last error once retries are exhausted"
  );
}

// Succeeds on a later attempt: the earlier failures do not count against the task once it works.
{
  let calls = 0;
  const retries = [];
  await runIsolated(
    [
      {
        label: "eventually-fine",
        run: async () => {
          calls += 1;
          if (calls < 2) throw new Error("not yet");
        },
      },
    ],
    {
      attempts: 3,
      sleep: noSleep,
      onRetry: (label, error, attempt) => retries.push([label, attempt]),
    }
  );
  assert.equal(calls, 2, "stopped retrying as soon as the task succeeded");
  assert.deepEqual(
    retries,
    [["eventually-fine", 1]],
    "only the failed attempt before success was reported as a retry"
  );
}

// Every task gets its own attempt budget - one task retrying does not steal attempts from another.
{
  const calls = { x: 0, y: 0 };
  await runIsolated(
    [
      {
        label: "x",
        run: async () => {
          calls.x += 1;
          throw new Error("always fails");
        },
      },
      { label: "y", run: async () => { calls.y += 1; } },
    ],
    { attempts: 3, sleep: noSleep }
  );
  assert.equal(calls.x, 3, "the failing task used its full budget");
  assert.equal(calls.y, 1, "the succeeding task was not retried at all");
}

console.log("isolated-tasks.test.mjs: ok");
