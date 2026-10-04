import { KNOWLEDGE_FLAGS } from "./flags-knowledge";
import { WORKSPACE_FLAGS } from "./flags-workspace";
import { PLATFORM_FLAGS } from "./flags-platform";
import { OPERATOR_FLAGS } from "./flags-operator";

export type { FlagDescriptor } from "./flag-descriptor";

export const FLAG_REGISTRY = [...KNOWLEDGE_FLAGS, ...WORKSPACE_FLAGS, ...PLATFORM_FLAGS, ...OPERATOR_FLAGS] as const;

/** The closed set of known flag names, shared by every caller that validates a flag name. */
export const FLAG_NAMES: ReadonlySet<string> = new Set(FLAG_REGISTRY.map(({ envVar }) => envVar));
