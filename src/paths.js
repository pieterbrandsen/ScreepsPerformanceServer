// Resolve runtime files against the *working* directory rather than the package folder.
//
// config.json, config.yml, docker-compose.yml, .env, logs/ and bots/ belong to whoever is
// running a benchmark, not to this package. Resolving them from `__dirname` means anyone
// installing this as a dependency has to edit files inside node_modules, which is why it is
// currently a clone-and-run project rather than something you can depend on.
//
//   --configDir <path>   explicit base directory
//   cwd                  used when it already holds a config.json or config.yml
//   package folder       fallback, so `npm run server` inside a clone is unchanged
//
// The .example templates always ship with the package, so they resolve with inPackage().
import fs from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import minimist from "minimist";

const argv = minimist(process.argv.slice(2));

export const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function resolveBaseDir() {
  if (argv.configDir) return resolve(argv.configDir);

  const cwd = process.cwd();
  if (
    cwd !== packageDir &&
    (fs.existsSync(join(cwd, "config.json")) ||
      fs.existsSync(join(cwd, "config.yml")))
  ) {
    return cwd;
  }

  return packageDir;
}

export const baseDir = resolveBaseDir();

/** Path inside the caller's working directory. */
export const inBase = (...parts) => join(baseDir, ...parts);

/** Path inside this package — the .example templates only. */
export const inPackage = (...parts) => join(packageDir, ...parts);
