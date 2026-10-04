import { BookOpen, Coins, Layers, GitBranch, Gauge, Scale, Map, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Starter-card icons a `portal.yaml` may name (spec 16).
 *
 * YAML can only hold a string, but `AgentStarter.icon` is a React component, so
 * the name is resolved through this explicit allowlist. Bundling every lucide
 * icon to permit arbitrary names would cost far more than it is worth, and a
 * dynamic import cannot be statically analysed by the bundler.
 *
 * An unknown name is a boot error, never a silent fallback: a starter card
 * rendering with no icon is a visual bug that ships unnoticed.
 *
 * Extend by adding to this map. The keys are exactly the lucide export names,
 * so `icon: BookOpen` in YAML reads the same as the import above.
 */
export const STARTER_ICONS = {
  BookOpen,
  Coins,
  Layers,
  GitBranch,
  Gauge,
  Scale,
  Map,
  Shield,
} satisfies Record<string, LucideIcon>;

export type StarterIconName = keyof typeof STARTER_ICONS;

export const STARTER_ICON_NAMES = Object.keys(STARTER_ICONS) as [StarterIconName, ...StarterIconName[]];

export function resolveStarterIcon(name: StarterIconName): LucideIcon {
  return STARTER_ICONS[name];
}
