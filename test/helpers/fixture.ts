/**
 * Programmatic synthetic fixtures shaped like real session JSONL records
 * (field shapes verified against v2.1.119–2.1.195 logs during the spike).
 * Static sanitized fixtures arrive with T3; matrix tests build sessions here.
 */

let nextId = 0;
const id = (prefix: string): string => `${prefix}_${(nextId++).toString(36).padStart(6, '0')}`;

export function humanInput(text: string): string {
  return JSON.stringify({
    type: 'user',
    isSidechain: false,
    isMeta: false,
    origin: { kind: 'human' },
    promptSource: 'typed',
    message: { role: 'user', content: text },
    uuid: id('u'),
    timestamp: new Date(0).toISOString(),
  });
}

export interface ToolUseSpec {
  tool: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
}

export function assistantToolUse(...specs: ToolUseSpec[]): string {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: {
      role: 'assistant',
      content: specs.map((s) => ({ type: 'tool_use', id: s.toolUseId ?? id('toolu'), name: s.tool, input: s.input ?? {} })),
    },
    uuid: id('a'),
  });
}

export interface ToolResultSpec {
  toolUseId: string;
  content?: string;
  isError?: boolean;
  /** record-level toolUseResult, e.g. { type: 'create' } for Write */
  toolUseResult?: Record<string, unknown>;
}

export function toolResult(spec: ToolResultSpec): string {
  return JSON.stringify({
    type: 'user',
    isSidechain: false,
    isMeta: false,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: spec.toolUseId, is_error: spec.isError ?? false, content: spec.content ?? 'ok' }],
    },
    toolUseResult: spec.toolUseResult,
    uuid: id('u'),
  });
}

/** tool_use + its result as consecutive lines (the common case). */
export function toolCall(tool: string, input: Record<string, unknown>, result: Omit<ToolResultSpec, 'toolUseId'> = {}): string[] {
  const toolUseId = id('toolu');
  return [assistantToolUse({ tool, input, toolUseId }), toolResult({ toolUseId, ...result })];
}

export function read(filePath: string): string[] {
  return toolCall('Read', { file_path: filePath }, { content: 'file contents' });
}

export function edit(filePath: string): string[] {
  return toolCall('Edit', { file_path: filePath }, { content: 'edited' });
}

export function editBlockedUnread(filePath: string): string[] {
  return toolCall('Edit', { file_path: filePath }, { isError: true, content: 'File has not been read yet. Read it first before writing to it.' });
}

export function write(filePath: string, kind: 'create' | 'update'): string[] {
  return toolCall('Write', { file_path: filePath }, { content: 'written', toolUseResult: { type: kind } });
}

export function bash(command: string, output = 'ok'): string[] {
  return toolCall('Bash', { command }, { content: output });
}

export function session(...parts: (string | string[])[]): string[] {
  return [humanInput('do the task'), ...parts.flat()];
}
