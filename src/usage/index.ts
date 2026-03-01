import * as storage from './storage.js';
import { estimateCost } from './pricing.js';
import type { UsageData, UsageRecord } from '../types/index.js';

let data: UsageData | null = null;

interface RecordUsageData {
  costUsd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
}

export function initialize(): void {
  data = storage.load();
  const agentCount = Object.keys(data.agents).length;
  if (agentCount > 0) {
    console.log(`  💰 Usage tracker: loaded ${agentCount} agent(s), $${data.totals.costUsd.toFixed(4)} total`);
  } else {
    console.log('  💰 Usage tracker: initialized (no data yet)');
  }
}

export function record(agentId: string, agentName: string, backend: string, usageData: RecordUsageData | null): void {
  if (!data) data = storage.load();
  if (!usageData) return;

  let costUsd = usageData.costUsd || 0;
  const inputTokens = usageData.usage?.input_tokens || 0;
  const outputTokens = usageData.usage?.output_tokens || 0;
  let estimated = false;

  // Estimate cost when backend doesn't report it directly
  if (!costUsd && usageData.usage) {
    const est = estimateCost(backend, usageData.usage);
    if (est) {
      costUsd = est.costUsd;
      estimated = true;
    }
  }
  const now = new Date().toISOString();

  if (!data.agents[agentId]) {
    data.agents[agentId] = {
      name: agentName,
      backend,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      turns: 0,
      firstSeen: now,
      lastSeen: now,
    };
  }

  const agent = data.agents[agentId];
  agent.totalCostUsd += costUsd;
  agent.totalInputTokens += inputTokens;
  agent.totalOutputTokens += outputTokens;
  agent.turns++;
  agent.lastSeen = now;
  if (estimated) agent.estimated = true;
  // Keep name/backend in sync
  agent.name = agentName;
  agent.backend = backend;

  data.totals.costUsd += costUsd;
  data.totals.inputTokens += inputTokens;
  data.totals.outputTokens += outputTokens;
  data.totals.turns++;

  storage.save(data);
}

export function getAll(): UsageData {
  if (!data) data = storage.load();
  return data;
}

export function getAgentUsage(agentId: string): UsageRecord | null {
  if (!data) data = storage.load();
  return data.agents[agentId] || null;
}

export function removeAgent(agentId: string): void {
  if (!data) data = storage.load();
  const agent = data.agents[agentId];
  if (!agent) return;

  // Subtract from totals
  data.totals.costUsd -= agent.totalCostUsd;
  data.totals.inputTokens -= agent.totalInputTokens;
  data.totals.outputTokens -= agent.totalOutputTokens;
  data.totals.turns -= agent.turns;

  delete data.agents[agentId];
  storage.save(data);
}
