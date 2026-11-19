export type LlmToolCall = {
  id: string;
  name: string;
  /** Raw JSON string as returned by the provider. */
  arguments: string;
};

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type LlmTurn = {
  text: string;
  toolCalls: LlmToolCall[];
};

export type JsonSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type LlmToolDefinition = {
  name: string;
  description: string;
  parameters: JsonSchema;
};
