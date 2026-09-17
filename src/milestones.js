/**
 * Milestone judging, separated from the socket plumbing so it can be tested without Docker.
 *
 * The subtlety this module exists for: status events do not arrive once per tick. They are
 * samples, and `event.data.gameTime` says when we *looked*, not when the world changed. Judging a
 * deadline by the sample's tick therefore has to be conservative in one direction only - a
 * condition seen to hold at or before the deadline is met, and nothing is called failed until a
 * sample past the deadline still does not meet it. Deciding from a single sample, as this code
 * used to, turns "the sample that first observed it landed late" into "the bot was late".
 */

/**
 * Judge one milestone against the current room status at an observed tick.
 *
 * @param {object} milestone `{ tick, check, rooms? }` - `rooms` scopes which rooms are judged.
 * @param {object} status room name -> `{ level, creeps, structures, ... }` counters.
 * @param {number} trackedRoomCount how many rooms an unscoped milestone must cover.
 * @param {number} tick the game tick this sample reports.
 * @return {{verdict: string, failedRooms: string[]}} verdict is `pending`, `met`, `late` or
 *   `failed`; `failedRooms` lists the rooms short of the check, and is empty unless it failed.
 */
export function judgeMilestone(milestone, status, trackedRoomCount, tick) {
  // A sample with no game time decides nothing. Without this, `undefined` compares false against
  // every deadline, so a met milestone is recorded as reached too late - and, being decided, is
  // never looked at again.
  if (!Number.isFinite(tick)) {
    return { verdict: "pending", failedRooms: [] };
  }

  // A milestone may name the rooms it judges, so bots sharing a world do not hold each other's
  // milestones back. Without `rooms`, every tracked room must pass.
  const judgedRooms = Object.keys(status).filter(
    (room) => !milestone.rooms || milestone.rooms.includes(room)
  );
  const expected = milestone.rooms ? milestone.rooms.length : trackedRoomCount;

  const failedRooms = [];
  // Rooms we have no status for at all cannot be said to pass; a short list is a failure, not a
  // smaller set of judges.
  let met = judgedRooms.length === expected;
  judgedRooms.forEach((room) => {
    Object.keys(milestone.check).forEach((key) => {
      if (status[room][key] < milestone.check[key]) {
        met = false;
        if (!failedRooms.includes(room)) {
          failedRooms.push(room);
        }
      }
    });
  });

  if (met) {
    // Inclusive: a milestone reached *at* its deadline tick was reached by that tick.
    return {
      verdict: tick <= milestone.tick ? "met" : "late",
      failedRooms: [],
    };
  }
  // Deadlines are compared with >=, not ===, because the sample that lands exactly on the
  // deadline tick may never arrive - and a deadline nobody observed is not a pass.
  return tick >= milestone.tick
    ? { verdict: "failed", failedRooms }
    : { verdict: "pending", failedRooms: [] };
}

export default { judgeMilestone };
