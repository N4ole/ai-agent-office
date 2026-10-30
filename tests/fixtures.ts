// Transcript records shaped exactly like Claude Code 2.1.312 output (fields trimmed to what we read).

export const SID = '11111111-2222-3333-4444-555555555555';
let n = 0;
const uuid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
const iso = (t = Date.now()) => new Date(t).toISOString();

export function userPrompt(text: string, t?: number) {
  return { type: 'user', uuid: uuid(), timestamp: iso(t), sessionId: SID, cwd: 'C:\\proj\\demo', gitBranch: 'main', isSidechain: false, message: { role: 'user', content: text } };
}

export function assistantTool(name: string, input: Record<string, unknown>, toolId: string, msgId = `msg_${++n}`, t?: number) {
  return {
    type: 'assistant', uuid: uuid(), timestamp: iso(t), sessionId: SID,
    message: { id: msgId, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id: toolId, name, input }], usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } },
  };
}

export function assistantText(text: string, msgId = `msg_${++n}`, t?: number) {
  return {
    type: 'assistant', uuid: uuid(), timestamp: iso(t), sessionId: SID,
    message: { id: msgId, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  };
}

export function toolResult(toolId: string, content: string, isError = false, t?: number) {
  return {
    type: 'user', uuid: uuid(), timestamp: iso(t), sessionId: SID,
    message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content, is_error: isError }] },
    toolUseResult: { stdout: content, stderr: '', interrupted: false },
  };
}

export function turnDuration(ms = 5000, t?: number) {
  return { type: 'system', subtype: 'turn_duration', durationMs: ms, uuid: uuid(), timestamp: iso(t), sessionId: SID };
}

export function costState(usd: number) {
  return { type: 'cost-state', sessionId: SID, totalCostUSD: usd, hasUnknownModelCost: false, totalLinesAdded: 3, totalLinesRemoved: 1 };
}

export function aiTitle(title: string) {
  return { type: 'ai-title', aiTitle: title, sessionId: SID };
}

export const lines = (...recs: object[]) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
