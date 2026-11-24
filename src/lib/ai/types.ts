export type LlmToolCall = {
  id: string;
  name: string;
  /** Raw JSON string as returned by the provider. */
  arguments: string;
};

/** Runtime-only attachment payload. Secrets and OAuth tokens are never included here. */
export type LlmAttachment = {
  name: string;
  kind: 'image' | 'document';
  mimeType: string;
  /** Base64 for images, plain UTF-8 text for text documents. */
  data: string;
};

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; attachments?: LlmAttachment[] }
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
