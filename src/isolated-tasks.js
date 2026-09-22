/**
 * Runs a set of labelled async tasks so that one task's failure cannot stop or crash the others,
 * and gives each its own bounded retry against a transient error.
 *
 * `Array.prototype.forEach(async ...)` runs its callbacks concurrently but does not await or
 * catch them - a rejection from any one of them becomes an unhandled rejection, which crashes the
 * whole Node process. That is exactly what `followLog` in helper.js hit with a 20-room world:
 * one of 20 concurrent room-auth attempts got "Not Authorized" (plausibly a race between that
 * room's just-written password committing and the auth attempt reading it back, more likely to
 * surface the more accounts are set up at once), and the crash took the other 19 - already
 * spawned and simulating - down with it, losing their live status/console feed even though
 * nothing was wrong with them.
 *
 * @param {Array<{ label: string, run: () => Promise<void> }>} tasks
 * @param {object} [options]
 * @param {number} [options.attempts=3] - total tries per task, including the first.
 * @param {number} [options.retryDelaySeconds=2]
 * @param {(label: string, error: Error, attempt: number) => void} [options.onRetry]
 * @param {(label: string, error: Error) => void} [options.onGiveUp] - called once, only if every
 *   attempt for that task failed. The task is skipped, not thrown - callers that need to know
 *   which labels failed can track that from here.
 * @param {(seconds: number) => Promise<void>} [options.sleep]
 * @return {Promise<void>} resolves once every task has either succeeded or exhausted its retries.
 *   Never rejects - a task that never succeeds is reported through `onGiveUp`, not thrown.
 */
export async function runIsolated(tasks, options = {}) {
  const {
    attempts = 3,
    retryDelaySeconds = 2,
    onRetry = () => {},
    onGiveUp = () => {},
    sleep = (seconds) =>
      // eslint-disable-next-line no-promise-executor-return
      new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
  } = options;

  await Promise.all(
    tasks.map(async ({ label, run }) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await run();
          return;
        } catch (error) {
          lastError = error;
          if (attempt < attempts) {
            onRetry(label, error, attempt);
            // eslint-disable-next-line no-await-in-loop
            await sleep(retryDelaySeconds);
          }
        }
      }
      onGiveUp(label, lastError);
    })
  );
}

export default { runIsolated };
