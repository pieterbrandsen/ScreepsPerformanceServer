/**
 * What a tracked room actually contains, from the room subscription's updates.
 *
 * The socket sends the whole room once and deltas after that: an object that changed carries only
 * the fields that changed, and an object that is gone arrives as `null`. Counting the objects in
 * each message therefore counts *sightings*, not contents - `status.creeps` grew every time a creep
 * was first seen and never fell when one died, so a room with nothing in it reported 2, then 4, as
 * other players' scouts walked through. Milestones are judged against these numbers
 * (`check: { creeps: N }`), so a milestone could be met by a passer-by.
 *
 * Keeping the ids is the only way a delta stream can answer "how many are there now", and only the
 * room owner's own objects are counted.
 */

/** Structure types the milestone checks are about: the ones a bot places, not the map's own. */
const COUNTED_STRUCTURES = new Set(["spawn", "extension"]);

/** Objects whose owner is the room's owner, used to learn who that is. */
const OWNER_TYPES = new Set(["controller", "spawn"]);

export function createRoomObjectState() {
  return { owner: null, creeps: new Map(), structures: new Map() };
}

/**
 * Counts what the room's owner has there.
 *
 * An unknown owner counts nothing rather than everything: the first update carries the whole room,
 * including the spawn the bot was placed with, so a room that is ours has an owner from the first
 * message - and a room that never gets one is not a room a milestone is about.
 *
 * @param {object} state - from createRoomObjectState
 * @return {{creeps: number, structures: number}} what the owner holds there now
 */
export function countRoomObjects(state) {
  if (!state.owner) return { creeps: 0, structures: 0 };
  const mine = (owner) => owner === state.owner;
  return {
    creeps: [...state.creeps.values()].filter(mine).length,
    structures: [...state.structures.values()].filter(mine).length,
  };
}

/**
 * Applies one room update. Returns the room's current counts.
 *
 * @param {object} state - from createRoomObjectState, carried across updates
 * @param {object} objects - `event.data.objects`
 * @return {{creeps: number, structures: number}} what the owner holds there now
 */
export function applyRoomObjects(state, objects) {
  Object.entries(objects || {}).forEach(([id, object]) => {
    // Gone: a dead creep, a destroyed structure. The whole point of tracking ids.
    if (object === null) {
      state.creeps.delete(id);
      state.structures.delete(id);
      return;
    }
    // A delta for something already known carries no type - only what moved or changed. It cannot
    // introduce an object, and the id already decides whether it is counted.
    if (!object.type) return;

    if (OWNER_TYPES.has(object.type) && object.user) {
      state.owner = object.user;
    }
    if (object.type === "creep") {
      state.creeps.set(id, object.user ?? null);
    } else if (COUNTED_STRUCTURES.has(object.type)) {
      state.structures.set(id, object.user ?? null);
    }
  });

  return countRoomObjects(state);
}
