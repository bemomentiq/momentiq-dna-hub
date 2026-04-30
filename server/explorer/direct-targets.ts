// Central registry of SSH targets for the Autonomy Hub direct-dispatch path.
// Authoritative source for mini IDs, providers, and the 4-way cascade order.
//
// Mini SSH connectivity (via ngrok tunnels registered in CC fleet):
//   mini-4: 0.tcp.us-cal-1.ngrok.io:10868  user=alex  (primary)
//   mini-5: 1.tcp.us-cal-1.ngrok.io:24919  user=alex  (fallback)
//
// Both minis share the same sshPath; the tunnel endpoints come from CC's
// agent registry (/api/agents). See direct-ssh.ts for how these are used.

export type Provider = "codex" | "claude";
export type MiniId = "mini-4" | "mini-5";

// SSH connection config for each mini — mirrors CC's agent registry exactly.
// Source: bemomentiq/momentiq-command-center (GET /api/agents).
// Keep in sync if tunnels change.
export interface MiniSSHConfig {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshPath: string;
  repoPath: string; // per-run workdir base, not the code repo
}

export const MINI_SSH_CONFIGS: Record<MiniId, MiniSSHConfig> = {
  "mini-4": {
    sshHost: "0.tcp.us-cal-1.ngrok.io",
    sshPort: 10868,
    sshUser: "alex",
    sshPath: "/opt/homebrew/bin:/Users/alex/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    repoPath: "/Users/alex/hub-runs",
  },
  "mini-5": {
    sshHost: "1.tcp.us-cal-1.ngrok.io",
    sshPort: 24919,
    sshUser: "alex",
    sshPath: "/opt/homebrew/bin:/Users/alex/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    repoPath: "/Users/alex/hub-runs",
  },
};

// Model pin for each provider — used in the runner script and stored as
// model_pin on fleet/explorer run rows for observability.
export const PROVIDER_MODELS: Record<Provider, string> = {
  codex: "gpt_5_5",
  claude: "claude_opus_4_7",
};

// Full target matrix: mini × provider
export const DIRECT_TARGETS: Record<MiniId, Record<Provider, string>> = {
  "mini-4": { codex: "gpt_5_5", claude: "claude_opus_4_7" },
  "mini-5": { codex: "gpt_5_5", claude: "claude_opus_4_7" },
};

// ---------------------------------------------------------------------------
// Cascade helpers
// ---------------------------------------------------------------------------

/**
 * Return the 4-way ordered fallback list for a given primary target.
 *
 * Cascade order:
 *   0. primary              (requested mini + provider)
 *   1. other mini           (same provider, other mini)
 *   2. other provider       (same mini, other provider)
 *   3. other mini + other provider
 *
 * This matches the AH-DIRECT-CASCADE spec precisely.
 */
export function cascadeFor(
  primary: { mini: MiniId; provider: Provider },
): Array<{ mini: MiniId; provider: Provider }> {
  const otherMini = (m: MiniId): MiniId => (m === "mini-4" ? "mini-5" : "mini-4");
  const otherProvider = (p: Provider): Provider => (p === "codex" ? "claude" : "codex");
  return [
    { mini: primary.mini, provider: primary.provider },
    { mini: otherMini(primary.mini), provider: primary.provider },
    { mini: primary.mini, provider: otherProvider(primary.provider) },
    { mini: otherMini(primary.mini), provider: otherProvider(primary.provider) },
  ];
}

/** The default primary target: mini-4 + codex. */
export function defaultTarget(): { mini: MiniId; provider: Provider } {
  return { mini: "mini-4", provider: "codex" };
}

// ---------------------------------------------------------------------------
// Legacy back-compat: the old DIRECT_TARGETS map keyed by executor string.
// Kept so existing ad-hoc code that imports from direct-dispatch.ts still
// compiles after direct-dispatch.ts is refactored.
// ---------------------------------------------------------------------------
export const LEGACY_DIRECT_TARGETS = {
  "pin-codex-direct":  { agentId: "mini-5", agent: "codex",  model: "gpt_5_5" },
  "pin-claude-direct": { agentId: "mini-5", agent: "claude", model: "claude_opus_4_7" },
} as const;

export type DirectExecutor = keyof typeof LEGACY_DIRECT_TARGETS;

export function isDirectExecutor(executor: string): executor is DirectExecutor {
  return executor === "pin-codex-direct" || executor === "pin-claude-direct";
}
