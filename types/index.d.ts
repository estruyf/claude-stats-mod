export type ClaudeStatsLimit = { kind: string; percentUsed: number; resetsAt?: string };

export type ClaudeStatsUsage = { rateLimits: ClaudeStatsLimit[]; sessionUsd?: number };

export type ClaudeStatsCosts = { today?: number; month?: number; at: number; error?: string };

declare module "claude-code" {
  interface PluginState {
    "claude-stats": {
      usage: ClaudeStatsUsage;
      costs: ClaudeStatsCosts;
      tick: number;
    };
  }
}
