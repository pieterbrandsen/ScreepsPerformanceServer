import { baseDir } from "../src/paths.js";
import fs from "node:fs";
process.stdout.write(fs.realpathSync(baseDir));
