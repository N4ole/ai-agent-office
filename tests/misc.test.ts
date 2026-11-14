import { describe, expect, it } from 'vitest';
import { redact, setCustomRedactions } from '../src/main/core/redact';
import { addHooks, hooksInstalled, removeHooks, hookCommand } from '../src/main/core/hooks';
import { buildArgs, renderStreamMessage, userMessage } from '../src/main/providers/claude/managed';
import { mapRegistryStatus } from '../src/main/providers/claude/claudeProvider';
import { parseSamples } from '../src/main/core/processMonitor';
import { mergeSettings } from '../src/main/core/settings';
import { isTestCommand } from '../src/main/core/activity';

describe('redaction', () => {
  it('masks common secrets', () => {
    const s = redact('key sk-ant-api03-abcdefghijklmnopqrstuv and AKIAABCDEFGHIJKLMNOP and password=hunter22 and ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(s).not.toMatch(/sk-ant-api03-abc|AKIAABCD|hunter22|ghp_abcdef/);
    expect(s).toContain('password=');
  });
  it('applies custom patterns', () => {
    setCustomRedactions(['CLIENT-\\d+']);
    expect(redact('id CLIENT-12345')).toBe('id ••••••');
    setCustomRedactions([]);
  });
  it('leaves normal text alone', () => {
    expect(redact('npm run build && git status')).toBe('npm run build && git status');
  });
});

describe('hooks installer', () => {
  const cmd = hookCommand('C:\\Users\\me\\.ai-agent-office\\hook-relay.js');
  it('adds our hooks while keeping user hooks', () => {
    const user = { theme: 'dark', hooks: { Notification: [{ hooks: [{ type: 'command', command: 'my-script' }] }] } };
    const s = addHooks(user, cmd);
    expect(hooksInstalled(s)).toBe(true);
    expect(s.theme).toBe('dark');
    expect(s.hooks.Notification).toHaveLength(2);
    expect(addHooks(s, cmd).hooks.Notification).toHaveLength(2);
  });
  it('removes only our hooks', () => {
    const s = removeHooks(addHooks({ hooks: { Notification: [{ hooks: [{ type: 'command', command: 'my-script' }] }] } }, cmd));
    expect(hooksInstalled(s)).toBe(false);
    expect(s.hooks.Notification[0].hooks[0].command).toBe('my-script');
    expect(s.hooks.SessionStart).toBeUndefined();
  });
});

describe('managed sessions (headless protocol)', () => {
  it('builds documented CLI arguments', () => {
    expect(buildArgs({ cwd: '.', model: 'sonnet', permissionMode: 'acceptEdits', resumeSessionId: 'abc' })).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'sonnet',
      '--permission-mode',
      'acceptEdits',
      '--resume',
      'abc',
    ]);
    expect(buildArgs({ cwd: '.', permissionMode: 'default' })).not.toContain('--permission-mode');
  });
  it('encodes user messages as stream-json lines', () => {
    expect(JSON.parse(userMessage('salut'))).toEqual({ type: 'user', message: { role: 'user', content: 'salut' } });
  });
  it('renders stream messages for the console', () => {
    expect(renderStreamMessage({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } })).toEqual([
      '⚙ Lit a.ts',
    ]);
    expect(renderStreamMessage({ type: 'result', subtype: 'success', duration_ms: 3000, total_cost_usd: 0.01 })[0]).toContain('success');
  });
});

describe('misc', () => {
  it('maps registry statuses honestly', () => {
    expect(mapRegistryStatus('busy')).toBe('working');
    expect(mapRegistryStatus('idle')).toBe('idle');
    expect(mapRegistryStatus('waiting_for_permission')).toBe('waiting');
    expect(mapRegistryStatus('something-new')).toBe('unknown');
  });
  it('parses process samples', () => {
    const m = parseSamples('123,4500,104857600\r\n456,10,2048\r\n');
    expect(m.get(123)).toEqual({ cpuMs: 4500, mem: 104857600 });
    expect(m.size).toBe(2);
  });
  it('sanitizes settings', () => {
    const s = mergeSettings({ scanDays: -5, costThresholdUSD: 'x' as any, notifications: { error: { app: false, os: true } } as any });
    expect(s.scanDays).toBe(1);
    expect(s.costThresholdUSD).toBe(5);
    expect(s.notifications.error).toEqual({ app: false, os: true });
    expect(s.notifications.agent_new.app).toBe(true);
  });
  it('detects test commands', () => {
    expect(isTestCommand('npm test')).toBe(true);
    expect(isTestCommand('cd x && pytest -q')).toBe(true);
    expect(isTestCommand('npm run build')).toBe(false);
  });
});
