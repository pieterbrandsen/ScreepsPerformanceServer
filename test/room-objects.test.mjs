// Docker-free checks for the room object counting in src/room-objects.js.
// Run: node test/room-objects.test.mjs
import assert from "node:assert/strict";
import {
  applyRoomObjects,
  countRoomObjects,
  createRoomObjectState,
} from "../src/room-objects.js";

const US = "user-ours";
const THEM = "user-theirs";

// The first update carries the whole room. Everything after it is a delta: changed fields only,
// and `null` for an object that is gone.
const firstUpdate = {
  spawn1: { type: "spawn", user: US },
  controller1: { type: "controller", user: US, level: 1 },
  source1: { type: "source" },
  source2: { type: "source" },
  mineral1: { type: "mineral" },
};

{
  const state = createRoomObjectState();
  const counts = applyRoomObjects(state, firstUpdate);
  assert.deepEqual(
    counts,
    { creeps: 0, structures: 1 },
    "a freshly placed room has its spawn and no creeps"
  );
  assert.equal(state.owner, US, "the owner is learned from the spawn");
}

// The bug. Two of the opponent's scouts crossed W7N3 over a run and `status.creeps` went 2, then 4,
// for a room the server said was empty - because every update's size was added to a total.
{
  const state = createRoomObjectState();
  applyRoomObjects(state, firstUpdate);

  let counts = applyRoomObjects(state, {
    scout1: { type: "creep", user: THEM },
  });
  assert.equal(counts.creeps, 0, "an opponent's creep in our room is not ours");

  counts = applyRoomObjects(state, { scout1: null });
  counts = applyRoomObjects(state, { scout2: { type: "creep", user: THEM } });
  counts = applyRoomObjects(state, { scout2: null });
  assert.equal(
    counts.creeps,
    0,
    "and two of them passing through still is not two creeps"
  );
}

{
  const state = createRoomObjectState();
  applyRoomObjects(state, firstUpdate);

  let counts = applyRoomObjects(state, { creep1: { type: "creep", user: US } });
  assert.equal(counts.creeps, 1, "our creep counts");

  // A delta for something already known carries no type - it moved, or its store changed.
  counts = applyRoomObjects(state, { creep1: { x: 12, y: 30 } });
  assert.equal(
    counts.creeps,
    1,
    "seeing the same creep again does not make it two"
  );

  counts = applyRoomObjects(state, { creep2: { type: "creep", user: US } });
  assert.equal(counts.creeps, 2, "a second creep does");

  counts = applyRoomObjects(state, { creep1: null });
  assert.equal(
    counts.creeps,
    1,
    "and a dead creep stops counting, which the old tally never did"
  );
}

{
  const state = createRoomObjectState();
  applyRoomObjects(state, firstUpdate);

  let counts = applyRoomObjects(state, {
    ext1: { type: "extension", user: US },
  });
  assert.equal(counts.structures, 2, "extensions are counted with the spawn");

  counts = applyRoomObjects(state, { ext1: null });
  assert.equal(
    counts.structures,
    1,
    "a destroyed extension is not still there"
  );

  counts = applyRoomObjects(state, { road1: { type: "road", user: US } });
  assert.equal(
    counts.structures,
    1,
    "roads are not what the milestone checks count"
  );
}

// An unowned room counts nothing rather than everything: the alternative is milestones about a
// room we do not hold being met by whoever walks through it.
{
  const state = createRoomObjectState();
  const counts = applyRoomObjects(state, {
    creep1: { type: "creep", user: THEM },
    source1: { type: "source" },
  });
  assert.deepEqual(
    counts,
    { creeps: 0, structures: 0 },
    "no owner, nothing ours"
  );

  applyRoomObjects(state, { spawn1: { type: "spawn", user: THEM } });
  assert.deepEqual(
    countRoomObjects(state),
    { creeps: 1, structures: 1 },
    "and once the owner is known, what was already seen is counted for them"
  );
}

{
  const state = createRoomObjectState();
  assert.deepEqual(
    applyRoomObjects(state, undefined),
    { creeps: 0, structures: 0 },
    "an update with no objects is not an error"
  );
}

console.log("room-objects: all checks passed");
