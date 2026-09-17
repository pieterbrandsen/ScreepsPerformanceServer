import { execSync } from "child_process";
import * as dotenv from "dotenv";
import minimist from "minimist";

/* eslint-disable-next-line */
import CasePathImporter from "screeps-db-importer";
import Setup from "./setup.js";
import Helper from "./helper.js";
import Exporter from "./exporter.js";
import { judgeMilestone } from "./milestones.js";
import { inBase } from "./paths.js";

let Config;
const argv = minimist(process.argv.slice(2));

const controllerRooms = {};
const status = {};
const controllerStatus = {};
let lastTick = 0;

const startTime = Date.now();

process.once("SIGINT", () => {
  console.log("Stop received...");
  const endTime = Date.now();
  console.log("Executing docker compose stop");
  execSync("docker compose stop", { stdio: "ignore" });

  console.log(
    `${lastTick} ticks elapsed, ${Math.floor(
      (endTime - startTime) / 1000
    )} seconds`
  );
  console.log("Status:");
  console.log(JSON.stringify(status, null, 2));
  console.log("Milestones:");
  console.log(JSON.stringify(Config.milestones, null, 2));
  console.log("Exiting done...");
  process.exit();
});

class Tester {
  roomsSeen = {};

  maxTickCount;

  constructor() {
    try {
      this.maxTickCount =
        argv.maxTickCount !== "undefined"
          ? argv.maxTickCount || 50 * 1000
          : 50 * 1000;
      const maxBots = Math.max(argv.maxBots, 1) || 5;

      let rooms = Object.entries(Config.rooms);
      if (rooms.length > maxBots) {
        const sortedRooms = rooms.sort(
          (a, b) =>
            Config.trackedRooms.indexOf(b[0]) -
            Config.trackedRooms.indexOf(a[0])
        );
        Config.rooms = {};

        for (let i = 0; i < sortedRooms.length && i < maxBots; i += 1) {
          const [roomName, roomConfig] = sortedRooms[i];
          Config.rooms[roomName] = roomConfig;
        }

        const trackedRooms = [];
        rooms = Object.entries(Config.rooms);
        for (let i = 0; i < Config.trackedRooms.length; i += 1) {
          const room = Config.trackedRooms[i];
          if (rooms.find((r) => r[0] === room)) {
            trackedRooms.push(room);
          }
        }
        Config.trackedRooms = trackedRooms;
      }

      for (let i = 0; i < Config.trackedRooms.length; i += 1) {
        const room = Config.trackedRooms[i];
        status[room] = {
          controller: null,
          creeps: 0,
          progress: 0,
          level: 0,
          structures: 0,
        };
        controllerStatus[room] = {};
      }

      const minMaxRunTime = 60 * 60 * 1000;
      const currentRunMaxRunTime = (this.maxTickCount + 2500) * 5 * 1000;
      const actualMaxRunTime = argv.maxTimeDuration
        ? argv.maxTimeDuration * 60 * 1000
        : Math.max(minMaxRunTime, currentRunMaxRunTime);
      setTimeout(() => {
        console.log("Timeout reached!");
        process.exit(1);
      }, actualMaxRunTime);
    } catch (e) {
      console.log(`Cannot parse runtime argument ${process.argv} ${e}`);
    }
  }

  /**
   *
   * @param {object} resolve
   * @param reject
   * @return {undefined}
   */
  async checkForSuccess(resolve, reject) {
    let appendix = "";
    if (this.maxTickCount > 0) {
      appendix = ` with runtime ${this.maxTickCount} ticks`;
    }
    console.log(
      `> Start the simulation${appendix} on port ${Config.serverPort}`
    );
    if (this.maxTickCount > 0) {
      while (lastTick === undefined || lastTick < this.maxTickCount) {
        // eslint-disable-next-line no-await-in-loop
        await Helper.sleep(1);
      }
      console.log(`${lastTick} End of simulation`);
      console.log("Executing docker compose stop");
      execSync("docker compose stop", { stdio: "ignore" });

      console.log("Status:");
      console.log(JSON.stringify(status, null, 2));
      console.log("Milestones:");
      console.log(JSON.stringify(Config.milestones, null, 2));

      const fails = Config.milestones.filter(
        (milestone) =>
          milestone.required && milestone.tick < lastTick && !milestone.success
      );
      await Exporter.sendFinalResult(
        Config.milestones,
        fails,
        status,
        lastTick,
        startTime
      );

      fails.forEach((fail) => {
        console.log(`${lastTick} Milestone failed ${JSON.stringify(fail)}`);
      });
      if (fails.length > 0) {
        reject("Not all milestones are hit.");
      }

      console.log(`${lastTick} Status check: passed`);
      resolve();
    }
  }

  /**
   * Updates the status object
   *
   * @param {object} event
   */
  static statusUpdater = (event) => {
    // Not every status event carries a game time, and one that does not can date nothing: it can
    // neither extend the controller history nor decide a deadline. Judging on it compared
    // `undefined` against the deadline, which is false for every milestone, so a met one was
    // recorded as reached too late and stayed that way. The object updates below still run on
    // every event - that is how `status` is filled in the first place.
    if (
      Number.isFinite(event.data.gameTime) &&
      event.data.gameTime !== lastTick
    ) {
      lastTick = event.data.gameTime;

      Object.keys(status).forEach((room) => {
        const controllerLevel = status[room].level;
        if (
          controllerLevel >= 1 &&
          controllerStatus[room][controllerLevel] === undefined
        ) {
          controllerStatus[room][controllerLevel] = {
            level: controllerLevel,
            progress: status[room].progress,
            tick: lastTick,
          };
        }
      });

      Config.milestones.forEach((milestone) => {
        // Once decided a milestone stays decided; undefined/null means still open.
        if (
          typeof milestone.success !== "undefined" &&
          milestone.success !== null
        ) {
          return;
        }

        const { verdict, failedRooms } = judgeMilestone(
          milestone,
          status,
          Config.trackedRooms.length,
          event.data.gameTime
        );
        if (verdict === "pending") {
          return;
        }

        milestone.success = verdict === "met";
        if (verdict === "failed") {
          // Only the rooms actually short of the check, judged on this sample - not a list left
          // empty because an earlier sample happened to decide it.
          milestone.failedRooms = failedRooms;
        } else {
          milestone.tickReached = event.data.gameTime;
        }

        const headline = {
          met: "Success",
          late: "Reached too late",
          failed: "Failed",
        }[verdict];
        const detail =
          verdict === "failed" ? ` status: ${JSON.stringify(status)}` : "";
        console.log("===============================");
        console.log(
          `${event.data.gameTime} Milestone: ${headline} ${JSON.stringify(
            milestone
          )}${detail}`
        );
        Exporter.sendPeriodicResult(event.data.gameTime, milestone, startTime);
      });
    }

    Helper.initControllerID(event, status, controllerRooms);
    if (Object.keys(event.data.objects).length > 0) {
      Helper.updateCreeps(event, status);
      Helper.updateStructures(event, status);
      Helper.updateController(event, status, controllerRooms);
    }
  };

  /**
   * execute method
   *
   * Connects via cli
   * - Spawn to bot
   * - Sets the password for the user
   * - triggers `followLog`
   * - Starts the simulation
   * - Waits
   * - Reads the controller data and checks controller progress
   * @return {object}
   */
  async execute() {
    // eslint-disable-next-line no-async-promise-executor
    const execute = new Promise(async (resolve, reject) => {
      await Helper.executeCliCommand("system.resetAllData()", Config.cliPort);
      if (!(await Helper.restartServer())) process.emit("SIGINT");
      await Helper.sleep(10);

      await Helper.executeCliCommand(
        "system.pauseSimulation()",
        Config.cliPort
      );
      await Helper.executeCliCommand(
        `system.setTickDuration(${Config.tickDuration})`,
        Config.cliPort
      );
      await Helper.executeCliCommand("utils.removeBots()", Config.cliPort);
      await Helper.executeCliCommand(
        'utils.setShardName("performanceServer")',
        Config.cliPort
      );

      await Helper.executeCliCommand(
        "storage.db['rooms.objects'].insert({ type: 'terminal', room: 'W0N0', x: 0, y:0 })",
        Config.cliPort
      );
      await Helper.executeCliCommand(
        "storage.db['rooms.objects'].insert({ type: 'terminal', room: 'W10N10', x: 0, y:0 })",
        Config.cliPort
      );
      await Helper.executeCliCommand(
        "storage.db['rooms.objects'].insert({ type: 'terminal', room: 'W10N0', x: 0, y:0 })",
        Config.cliPort
      );
      await Helper.executeCliCommand(
        "storage.db['rooms.objects'].insert({ type: 'terminal', room: 'W0N10', x: 0, y:0 })",
        Config.cliPort
      );

      const spawnBots = [];
      const rooms = Object.entries(Config.rooms);
      for (let roomCount = 0; roomCount < rooms.length; roomCount += 1) {
        const roomData = rooms[roomCount];
        const roomName = roomData[1].room;
        const opts = roomData[1].opts ? roomData[1].opts : {};
        spawnBots.push(
          Helper.spawnBot(
            roomData[1].name,
            roomName,
            this.roomsSeen,
            Config.cliPort,
            opts
          )
        );
      }
      await Promise.all(spawnBots);

      if (
        Object.keys(Config.rooms).length === Object.keys(this.roomsSeen).length
      ) {
        Helper.followLog(Config.trackedRooms, Tester.statusUpdater);
        await Helper.sleep(10);
        // await CasePathImporter("default/performanceServer", {
        //   serverPort: Config.serverPort,
        //   cliPort: Config.cliPort,
        // });
        await Helper.executeCliCommand(
          "system.resumeSimulation()",
          Config.cliPort
        );

        await Helper.sleep(10);
        await Helper.executeCliCommand(
          `storage.db['users'].update({ },{ $set: { cpu: ${Config.userCpuLimit} }})`,
          Config.cliPort
        );
      }
      this.checkForSuccess(resolve, reject);
    });
    return execute;
  }

  async run() {
    if (!(await Helper.startServer())) process.emit("SIGINT");
    await Helper.sleep(10);

    console.log("Starting... done");
    let exitCode = 0;
    try {
      await this.execute();
      console.log(`${lastTick} Yeah`);
    } catch (e) {
      exitCode = 1;
      console.log(`${lastTick} ${e}`);
    }
    process.exit(exitCode);
  }
}

/**
 * Main method
 *
 * Start the server and connects via cli
 * @return {undefined}
 */
(async () => {
  const { ports, config } = await Setup();
  Config = config;
  Config.serverPort = ports.serverPort;
  Config.cliPort = ports.cliPort;
  dotenv.config({ path: inBase(".env") });

  Helper.setConfig(Config);
  const tester = new Tester();
  await tester.run();
  process.emit("SIGINT");
})();
