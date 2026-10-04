export interface FlagDescriptor {
  envVar: string;
  label: string;
  description: string;
  dependsOn?: string;
  effect: "live" | "restart";
}
