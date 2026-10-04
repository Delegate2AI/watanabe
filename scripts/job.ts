import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database as DatabaseType } from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { runJob } from "@/lib/jobs/dispatch";
import { getJob } from "@/lib/jobs/registry";

type CliOptions = {
  db?: DatabaseType;
  output?: (message: string) => void;
  error?: (message: string) => void;
};

export async function runCli(args: string[], options: CliOptions = {}): Promise<number> {
  const output = options.output ?? console.log;
  const error = options.error ?? console.error;
  const jobName = args[0];
  if (!jobName) {
    error("usage: pnpm job <name>");
    return 1;
  }

  const job = getJob(jobName);
  if (!job) {
    error(`unknown job: ${jobName}`);
    return 1;
  }
  if (job.flag && process.env[job.flag] !== "1") {
    error(`job disabled by ${job.flag}: ${jobName}`);
    return 1;
  }

  const result = await runJob(jobName, options.db ?? getDb());
  output(JSON.stringify({ job: jobName, ...result }));
  return result.status === "succeeded" ? 0 : 1;
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === path.resolve(entry)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
