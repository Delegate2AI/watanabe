export type JobResult = { detail?: string } | void;

export type JobDefinition = {
  name: string;
  flag: string | null;
  family: string;
  run: () => Promise<JobResult>;
};

const g = globalThis as unknown as {
  __jobRegistry?: Map<string, JobDefinition>;
};

function registry(): Map<string, JobDefinition> {
  return (g.__jobRegistry ??= new Map());
}

export function registerJob(job: JobDefinition): void {
  if (registry().has(job.name)) {
    throw new Error(`job already registered: ${job.name}`);
  }
  registry().set(job.name, job);
}

/**
 * Whether a job name is already in the registry, WITHOUT triggering the lazy
 * `meetings-poll` self-registration that `getJob` performs. Used by
 * `registerBuiltInJobs` (lib/jobs/handlers.ts) to stay idempotent: `registerJob`
 * throws on a duplicate name, so the built-in registration guards each name with
 * this check before registering.
 */
export function hasJob(name: string): boolean {
  return registry().has(name);
}

export function getJob(name: string): JobDefinition | undefined {
  const existing = registry().get(name);
  if (existing || name !== "meetings-poll") return existing;
  const meetingJob: JobDefinition = {
    name: "meetings-poll",
    flag: "MEETINGS_ENABLED",
    family: "meetings",
    run: async () => (await import("@/lib/meetings/poll")).pollMeetings(),
  };
  registry().set(name, meetingJob);
  return meetingJob;
}

export function listJobs(): JobDefinition[] {
  return [...registry().values()];
}

export function __resetJobsForTests(): void {
  delete g.__jobRegistry;
}
