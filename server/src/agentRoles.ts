export type AgentRole = "Duelist" | "Initiator" | "Controller" | "Sentinel";

// Snapshot of valorant-api.com's /v1/agents roster (fetched 2026-07-07).
// Agents released after this snapshot fall back to "Unknown" rather than
// breaking the lookup or requiring a runtime fetch on every insights request.
const AGENT_ROLES: Record<string, AgentRole> = {
  Astra: "Controller",
  Brimstone: "Controller",
  Clove: "Controller",
  Harbor: "Controller",
  Miks: "Controller",
  Omen: "Controller",
  Viper: "Controller",

  Iso: "Duelist",
  Jett: "Duelist",
  Neon: "Duelist",
  Phoenix: "Duelist",
  Raze: "Duelist",
  Reyna: "Duelist",
  Waylay: "Duelist",
  Yoru: "Duelist",

  Breach: "Initiator",
  Fade: "Initiator",
  Gekko: "Initiator",
  "KAY/O": "Initiator",
  Skye: "Initiator",
  Sova: "Initiator",
  Tejo: "Initiator",

  Chamber: "Sentinel",
  Cypher: "Sentinel",
  Deadlock: "Sentinel",
  Killjoy: "Sentinel",
  Sage: "Sentinel",
  Veto: "Sentinel",
  Vyse: "Sentinel",
};

export function getAgentRole(agentName: string): AgentRole | "Unknown" {
  return AGENT_ROLES[agentName] ?? "Unknown";
}
