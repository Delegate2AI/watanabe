/**
 * Copy-paste setup for each supported harness (spec: pages, "Connect your
 * harness"). Content only: adding a harness is adding an entry here.
 * `publicUrl` is the gate's public origin, without `/v1`.
 */
export interface HarnessSnippet {
  id: string;
  label: string;
  where: string;
  code: string;
}

export const KEY_PLACEHOLDER = "<your key>";

export function harnessSnippets(publicUrl: string, model: string): HarnessSnippet[] {
  const origin = publicUrl.replace(/\/+$/, "");
  const v1 = `${origin}/v1`;
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      where: "Add to your shell profile, or to the `env` block of ~/.claude/settings.json.",
      code: [
        `export ANTHROPIC_BASE_URL="${origin}"`,
        `export ANTHROPIC_AUTH_TOKEN="${KEY_PLACEHOLDER}"`,
        `export ANTHROPIC_MODEL="${model}"`,
        `export ANTHROPIC_DEFAULT_HAIKU_MODEL="${model}"`,
      ].join("\n"),
    },
    {
      id: "cursor",
      label: "Cursor",
      where: "Settings > Models > API Keys: turn on OpenAI API Key and Override OpenAI Base URL, then add the model by name.",
      code: [`OpenAI API Key:         ${KEY_PLACEHOLDER}`, `Override OpenAI Base URL: ${v1}`, `Model:                  ${model}`].join("\n"),
    },
    {
      id: "cline",
      label: "Cline / Roo",
      where: "API Provider: OpenAI Compatible.",
      code: [`Base URL: ${v1}`, `API Key:  ${KEY_PLACEHOLDER}`, `Model ID: ${model}`].join("\n"),
    },
    {
      id: "codex",
      label: "Codex",
      where: "In ~/.codex/config.toml, then `export WATANABE_LLM_KEY=\"<your key>\"`.",
      code: [
        `model = "${model}"`,
        `model_provider = "watanabe"`,
        ``,
        `[model_providers.watanabe]`,
        `name = "Watanabe"`,
        `base_url = "${v1}"`,
        `env_key = "WATANABE_LLM_KEY"`,
        `wire_api = "chat"`,
      ].join("\n"),
    },
    {
      id: "continue",
      label: "Continue",
      where: "In ~/.continue/config.yaml, under `models`.",
      code: [
        `models:`,
        `  - name: Watanabe ${model}`,
        `    provider: openai`,
        `    model: ${model}`,
        `    apiBase: ${v1}`,
        `    apiKey: ${KEY_PLACEHOLDER}`,
      ].join("\n"),
    },
  ];
}

/** A concrete model id to put in the snippets: the first pattern without a wildcard, if any. */
export function exampleModel(patterns: string[]): string {
  return patterns.find((p) => p.trim() && !p.includes("*"))?.trim() ?? "<model id>";
}
