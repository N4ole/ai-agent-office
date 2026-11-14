// Converts raw Claude Code transcript records (JSONL lines) into normalized events.
// The record format was verified against Claude Code 2.1.x transcripts stored in
// ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl (and .../subagents/agent-<id>.jsonl).
// Unknown record types are ignored, never guessed.

import type { AgentEvent } from '../../../shared/types';
import { clean, firstLine, truncate } from '../../core/redact';
import { isTestCommand } from '../../core/activity';

type Rec = Record<string, any>;

export interface ParseContext {
  agentId: string;
  /** Timestamp of the last timestamped record, used for records that carry none (title, cost). */
  lastTs?: number;
  /** Called for every Agent/Task tool_use so subagents can be linked to their parent. */
  onSpawn?: (toolUseId: string, info: { description: string; subagentType: string }) => void;
}

function ts(rec: Rec, ctx?: ParseContext): number {
  const t = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
  if (Number.isFinite(t)) {
    if (ctx) ctx.lastTs = t;
    return t;
  }
  return ctx?.lastTs ?? 0;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.type === 'text' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function rel(p: unknown): string {
  return typeof p === 'string' ? p : '';
}

/** Short human summary of a tool call. */
export function summarizeTool(name: string, input: Rec = {}): string {
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return `$ ${firstLine(clean(input.command, 400), 200)}`;
    case 'Read':
      return `Lit ${rel(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Modifie ${rel(input.file_path)}`;
    case 'Write':
      return `Écrit ${rel(input.file_path)}`;
    case 'NotebookEdit':
      return `Modifie ${rel(input.notebook_path)}`;
    case 'Grep':
      return `Cherche "${truncate(String(input.pattern ?? ''), 80)}"`;
    case 'Glob':
      return `Liste ${truncate(String(input.pattern ?? ''), 80)}`;
    case 'Agent':
    case 'Task':
      return `Délègue à ${input.subagent_type ?? 'un sous-agent'} : ${truncate(String(input.description ?? ''), 100)}`;
    case 'WebSearch':
      return `Recherche web "${truncate(String(input.query ?? ''), 100)}"`;
    case 'WebFetch':
      return `Consulte ${truncate(String(input.url ?? ''), 120)}`;
    case 'TodoWrite':
      return `Met à jour sa liste de tâches`;
    default: {
      const s = clean(input, 120);
      return `${name} ${s === '{}' ? '' : s}`.trim();
    }
  }
}

/** Data extracted from tool input that the reducer needs (paths, commands, todos). */
function toolData(name: string, input: Rec): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  const fp = input.file_path ?? input.notebook_path;
  if (typeof fp === 'string') d.file = fp;
  if ((name === 'Bash' || name === 'PowerShell') && typeof input.command === 'string') {
    d.command = clean(input.command, 1000);
    d.isTest = isTestCommand(input.command);
  }
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    d.todos = input.todos.map((t: any) => ({ content: clean(t.content ?? '', 200), status: String(t.status ?? '') }));
  }
  if (name === 'Agent' || name === 'Task') {
    d.subagentType = input.subagent_type;
    d.description = clean(input.description ?? '', 200);
  }
  return d;
}

function isNoisePrompt(text: string): boolean {
  const t = text.trimStart();
  return t.length === 0 || t.startsWith('<system-reminder>') || t.startsWith('<local-command') || t.startsWith('<command-name>') || t.startsWith('Caveat:');
}

export function parseRecord(rec: Rec, ctx: ParseContext): AgentEvent[] {
  const out: AgentEvent[] = [];
  const agentId = ctx.agentId;
  const base = rec.uuid ?? '';
  const t = ts(rec, ctx);

  switch (rec.type) {
    case 'user': {
      const msg = rec.message ?? {};
      const content = msg.content;
      if (Array.isArray(content) && content.some((c: any) => c?.type === 'tool_result')) {
        content.forEach((c: any, i: number) => {
          if (c?.type !== 'tool_result') return;
          const text = textOf(c.content);
          const tur = rec.toolUseResult;
          let detail = text;
          if (tur && typeof tur === 'object' && (tur.stdout || tur.stderr)) {
            detail = [tur.stdout, tur.stderr].filter(Boolean).join('\n');
          }
          const isError = c.is_error === true;
          out.push({
            id: `${base}:r${i}`,
            agentId,
            ts: t,
            kind: isError ? 'tool_error' : 'tool_result',
            summary: isError ? `Erreur : ${firstLine(clean(text, 600))}` : firstLine(clean(text, 600)) || 'Résultat reçu',
            detail: clean(detail, 6000),
            toolUseId: c.tool_use_id,
            isError,
            source: 'transcript',
            data: tur && typeof tur === 'object' && 'interrupted' in tur ? { interrupted: !!tur.interrupted } : undefined,
          });
        });
        return out;
      }
      if (rec.isMeta) return out;
      // Strip wrapper tags (e.g. <pasted_content id="…">) so the summary shows the actual request.
      const text = textOf(content)
        .replace(/<\/?[a-z][\w-]*(?:\s[^>]*)?>/gi, '')
        .trim();
      if (isNoisePrompt(textOf(content)) || !text) return out;
      out.push({
        id: `${base}:u`,
        agentId,
        ts: t,
        kind: 'user_prompt',
        summary: firstLine(clean(text, 2000), 200),
        detail: clean(text, 6000),
        source: 'transcript',
      });
      return out;
    }

    case 'assistant': {
      const msg = rec.message ?? {};
      const blocks: any[] = Array.isArray(msg.content) ? msg.content : [];
      blocks.forEach((b, i) => {
        const id = `${base}:a${i}`;
        if (b?.type === 'thinking' || b?.type === 'redacted_thinking') {
          out.push({ id, agentId, ts: t, kind: 'thinking', summary: 'Réfléchit…', source: 'transcript' });
        } else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          out.push({
            id,
            agentId,
            ts: t,
            kind: 'assistant_text',
            summary: firstLine(clean(b.text, 1000), 200),
            detail: clean(b.text, 6000),
            source: 'transcript',
          });
        } else if (b?.type === 'tool_use') {
          const name = String(b.name ?? 'outil');
          const input: Rec = b.input && typeof b.input === 'object' ? b.input : {};
          const isSpawn = name === 'Agent' || name === 'Task';
          if (isSpawn && ctx.onSpawn && b.id) {
            ctx.onSpawn(b.id, { description: String(input.description ?? ''), subagentType: String(input.subagent_type ?? '') });
          }
          out.push({
            id,
            agentId,
            ts: t,
            kind: isSpawn ? 'subagent_spawn' : 'tool_use',
            summary: summarizeTool(name, input),
            detail: clean(input, 3000),
            tool: name,
            toolUseId: b.id,
            source: 'transcript',
            data: toolData(name, input),
          });
        }
      });
      // Usage is repeated on every block of the same API message: dedupe on message id.
      if (msg.usage && msg.id) {
        const u = msg.usage;
        out.push({
          id: `usage:${msg.id}`,
          agentId,
          ts: t,
          kind: 'usage',
          summary: `${u.output_tokens ?? 0} tokens générés`,
          source: 'transcript',
          data: {
            model: msg.model,
            input: Number(u.input_tokens ?? 0),
            output: Number(u.output_tokens ?? 0),
            cacheRead: Number(u.cache_read_input_tokens ?? 0),
            cacheCreation: Number(u.cache_creation_input_tokens ?? 0),
            // Split of cache writes by TTL (priced differently); older records only have the total.
            cacheWrite1h: Number(u.cache_creation?.ephemeral_1h_input_tokens ?? 0),
            cacheWrite5m:
              u.cache_creation && typeof u.cache_creation === 'object'
                ? Number(u.cache_creation.ephemeral_5m_input_tokens ?? 0)
                : Number(u.cache_creation_input_tokens ?? 0),
          },
        });
      }
      return out;
    }

    case 'system': {
      if (rec.subtype === 'turn_duration') {
        out.push({
          id: `${base}:td`,
          agentId,
          ts: t,
          kind: 'turn_end',
          summary: `Tour terminé (${Math.round(Number(rec.durationMs ?? 0) / 1000)} s)`,
          source: 'transcript',
          data: { durationMs: rec.durationMs },
        });
      } else if (rec.level === 'error' || /error/i.test(String(rec.subtype ?? ''))) {
        out.push({
          id: `${base}:se`,
          agentId,
          ts: t,
          kind: 'tool_error',
          summary: `Erreur système : ${firstLine(clean(rec.content ?? rec.subtype, 400))}`,
          isError: true,
          source: 'transcript',
        });
      }
      return out;
    }

    case 'ai-title':
    case 'custom-title': {
      const title = rec.aiTitle ?? rec.customTitle ?? rec.title;
      if (typeof title === 'string' && title.trim()) {
        out.push({
          id: `title:${rec.sessionId}:${title}`,
          agentId,
          ts: t,
          kind: 'title',
          summary: clean(title, 120),
          source: 'transcript',
        });
      }
      return out;
    }

    case 'cost-state': {
      const cost = Number(rec.totalCostUSD);
      if (Number.isFinite(cost)) {
        out.push({
          id: `cost:${rec.sessionId}:${cost.toFixed(6)}`,
          agentId,
          ts: t,
          kind: 'cost',
          summary: `Coût cumulé ${cost.toFixed(4)} $`,
          source: 'transcript',
          data: {
            totalCostUSD: cost,
            unknownModelCost: !!rec.hasUnknownModelCost,
            linesAdded: rec.totalLinesAdded,
            linesRemoved: rec.totalLinesRemoved,
          },
        });
      }
      return out;
    }

    default:
      return out;
  }
}

/** Parses a whole JSONL chunk. Malformed lines are skipped (counted). */
export function parseLines(lines: string[], ctx: ParseContext): { events: AgentEvent[]; records: Rec[]; bad: number } {
  const events: AgentEvent[] = [];
  const records: Rec[] = [];
  let bad = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: Rec;
    try {
      rec = JSON.parse(line);
    } catch {
      bad++;
      continue;
    }
    records.push(rec);
    events.push(...parseRecord(rec, ctx));
  }
  return { events, records, bad };
}
