// R-03 (claude.cmd from npm) and R-18 (terminal in a folder with cmd metacharacters).
// Runs real cmd.exe command lines against a .cmd placed in a deliberately hostile folder name.

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  claudeSpawn,
  clearResolveCache,
  cmdWindowSpec,
  escapeWt,
  quoteForCmd,
  resolveProgram,
  spawnSpec,
  UnsafeArgumentError,
  wtSpec,
  type SpawnSpec,
} from '../src/main/core/winCommand';

// Long path form: on CI runners tmpdir() is an 8.3 short path (RUNNER~1) while `where` prints long paths.
const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aao-win-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
// Every character cmd.exe or Windows Terminal could interpret, in a valid Windows folder name.
const TRAP = path.join(root, 'a&b ^c;d %PATH% (x)!e');
mkdirSync(TRAP, { recursive: true });
const fakeClaude = path.join(TRAP, 'claude.cmd');
// Writes its first two arguments and its working folder, one per line.
writeFileSync(fakeClaude, '@echo off\r\n> "%~dp0out.txt" (echo(%~1& echo(%~2& echo("%CD%")\r\n');
const outLines = () => readFileSync(path.join(TRAP, 'out.txt'), 'utf8').trim().split(/\r?\n/);
const run = (spec: SpawnSpec, cwd = root) =>
  spawnSync(spec.file, spec.args, { cwd, windowsVerbatimArguments: spec.windowsVerbatimArguments, windowsHide: true, encoding: 'utf8' });

describe.runIf(process.platform === 'win32')('Windows command lines', () => {
  it('quotes tokens and neutralizes %', () => {
    expect(quoteForCmd('C:\\a&b')).toBe('"C:\\a&b"');
    expect(quoteForCmd('x%PATH%y')).toBe('"x"^%"PATH"^%"y"');
    expect(() => quoteForCmd('a"b')).toThrow(UnsafeArgumentError);
  });

  it('resolves `claude` to the npm shim claude.cmd with where (R-03)', () => {
    clearResolveCache();
    // PATH cannot hold a ';' inside a folder name: a hostile folder without it.
    const npmDir = path.join(root, 'npm & co %USERNAME% (x)');
    mkdirSync(npmDir, { recursive: true });
    writeFileSync(path.join(npmDir, 'claude.cmd'), '@echo off\r\n');
    writeFileSync(path.join(npmDir, 'claude'), '#!/bin/sh\n'); // npm also installs this extension-less script
    const env = { ...process.env, PATH: `${npmDir};${process.env.PATH}` };
    expect(resolveProgram('claude', env)).toBe(path.join(npmDir, 'claude.cmd'));
    expect(claudeSpawn('claude', ['--version'], env).file.toLowerCase()).toMatch(/cmd\.exe$/);
    expect(resolveProgram('C:\\explicit\\claude.exe', env)).toBe('C:\\explicit\\claude.exe');
  });

  it('runs a .cmd in a hostile folder with its arguments intact (R-03)', () => {
    rmSync(path.join(TRAP, 'out.txt'), { force: true });
    const r = run(spawnSpec(fakeClaude, ['--resume', 'aaaa-bbbb']));
    expect(r.status).toBe(0);
    expect(outLines()).toEqual(['--resume', 'aaaa-bbbb', `"${root}"`]);
  });

  it('refuses arguments that the .cmd script could re-interpret', () => {
    expect(() => spawnSpec(fakeClaude, ['x&calc'])).toThrow(UnsafeArgumentError);
    expect(() => spawnSpec(fakeClaude, ['%PATH%'])).toThrow(UnsafeArgumentError);
    // A real executable gets its arguments without any shell: nothing to interpret.
    expect(spawnSpec('C:\\x\\claude.exe', ['x&calc'])).toEqual({ file: 'C:\\x\\claude.exe', args: ['x&calc'] });
  });

  it('escapes ; for Windows Terminal (R-18)', () => {
    expect(escapeWt('C:\\a;b')).toBe('C:\\a\\;b');
    expect(wtSpec(TRAP, [fakeClaude, '--resume', 'id']).args).toEqual(['-d', escapeWt(TRAP), escapeWt(fakeClaude), '--resume', 'id']);
  });

  it('opens cmd in a hostile folder without putting the folder on the command line (R-18)', () => {
    expect(cmdWindowSpec().args.join(' ')).not.toContain('a&b');
    // Same command line, with the launcher removed so the test does not open a window.
    rmSync(path.join(TRAP, 'out.txt'), { force: true });
    const r = run(cmdWindowSpec([fakeClaude, '--resume', 'id-1'], process.env, { launcher: '', keep: '/c' }), TRAP);
    expect(r.status).toBe(0);
    expect(outLines()).toEqual(['--resume', 'id-1', `"${TRAP}"`]);
  });
});
