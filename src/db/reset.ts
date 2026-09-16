import { execFileSync } from "node:child_process";

/** `npm run db:reset` — migrate then seed, in one deterministic command (Phase 4
 * brief §7/§28). Shells out to the same two scripts `db:migrate`/`db:seed` run
 * individually, so there is exactly one implementation of each step. */
function run(scriptPath: string) {
  execFileSync(process.execPath, ["--import", "tsx", scriptPath], { stdio: "inherit" });
}

run("src/db/migrate.ts");
run("src/db/seed.ts");
