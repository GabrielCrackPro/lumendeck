export interface AgentDefinition {
  id: string;
  displayName: string;
  model: string;
  toolNames: string[];
  spawnableAgents: string[];
  spawnerPrompt: string;
  systemPrompt: string;
  instructionsPrompt: string;
  includeMessageHistory: boolean;
  outputMode: "last_message";
}
