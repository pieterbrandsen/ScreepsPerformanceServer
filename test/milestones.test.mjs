// Docker-free checks for the milestone judging in src/milestones.js.
// Run: node test/milestones.test.mjs
import assert from "node:assert/strict";
import { judgeMilestone } from "../src/milestones.js";

const ours = (structures = 0, level = 0, creeps = 0) => ({
  W7N3: { structures, level, creeps, progress: 0, controller: null },
});

// The bug this module was extracted to fix. A spawn exists from tick 1, the milestone wants one
// structure by tick 100, and the first status event to observe the room lands at tick 100 or
// later. Judging must not turn "we looked late" into "the bot was late" before the deadline, and
// must not report a failure while the condition is unobserved but the deadline is still ahead.
{
  const milestone = { tick: 100, check: { structures: 1 }, rooms: ["W7N3"] };
  assert.equal(
    judgeMilestone(milestone, ours(0), 1, 40).verdict,
    "pending",
    "before the deadline, an unmet check is undecided - not failed"
  );
  assert.equal(
    judgeMilestone(milestone, ours(1), 1, 95).verdict,
    "met",
    "met before the deadline"
  );
  assert.equal(
    judgeMilestone(milestone, ours(1), 1, 100).verdict,
    "met",
    "the deadline tick itself still counts as by that tick"
  );
  assert.equal(
    judgeMilestone(milestone, ours(1), 1, 103).verdict,
    "late",
    "first observed after the deadline is reported as late, not as a plain failure"
  );
}

// Status events skip ticks, so a deadline may never be observed exactly. The old code only
// reported a failure when a sample landed on `=== milestone.tick`, which made a missed deadline
// pass silently whenever the sampling stepped over it.
{
  const milestone = { tick: 100, check: { level: 2 }, rooms: ["W7N3"] };
  assert.equal(
    judgeMilestone(milestone, ours(5, 1), 1, 137).verdict,
    "failed",
    "a deadline stepped over is still judged"
  );
  assert.deepEqual(
    judgeMilestone(milestone, ours(5, 1), 1, 137).failedRooms,
    ["W7N3"],
    "the failing room is named"
  );
}

// A room named twice by two checks is one failing room, not two.
{
  const milestone = { tick: 10, check: { level: 2, structures: 9 }, rooms: ["W7N3"] };
  assert.deepEqual(judgeMilestone(milestone, ours(1, 1), 1, 10).failedRooms, ["W7N3"]);
}

// Scoping: an unscoped milestone judges every tracked room, and a room we hold no status for
// cannot pass on its absence.
{
  const unscoped = { tick: 50, check: { structures: 1 } };
  assert.equal(
    judgeMilestone(unscoped, ours(1), 2, 20).verdict,
    "pending",
    "one room of two known is not a pass"
  );
  assert.equal(
    judgeMilestone(unscoped, ours(1), 1, 20).verdict,
    "met",
    "the only tracked room passing is a pass"
  );
  const scoped = { tick: 50, check: { structures: 1 }, rooms: ["W7N3"] };
  assert.equal(
    judgeMilestone(scoped, { ...ours(1), W5N8: { structures: 0 } }, 2, 20).verdict,
    "met",
    "an opponent short of the check does not hold our milestone back"
  );
}

console.log("milestones.test.mjs: ok");
