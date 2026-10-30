// CPU / RAM sampling of identified Claude Code processes, via one PowerShell call for all PIDs.
// Runs at a low frequency so it does not slow Claude Code down.

import { execFile } from 'node:child_process';
import os from 'node:os';

export interface Sample {
  cpu: number | null;
  memMB: number;
}

/** Parses "pid,cpuMs,workingSetBytes" lines. Exported for tests. */
export function parseSamples(stdout: string): Map<number, { cpuMs: number; mem: number }> {
  const m = new Map<number, { cpuMs: number; mem: number }>();
  for (const line of stdout.split(/\r?\n/)) {
    const [pid, cpu, mem] = line.trim().split(',');
    const p = Number(pid);
    if (!p) continue;
    m.set(p, { cpuMs: Number(String(cpu).replace(',', '.')) || 0, mem: Number(mem) || 0 });
  }
  return m;
}

export class ProcessMonitor {
  private prev = new Map<number, { cpuMs: number; at: number }>();
  private cores = Math.max(1, os.cpus().length);

  sample(pids: number[]): Promise<Map<number, Sample>> {
    const out = new Map<number, Sample>();
    if (!pids.length || process.platform !== 'win32') return Promise.resolve(out);
    const list = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0).join(',');
    const script = `Get-Process -Id ${list} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id),$([math]::Round($_.TotalProcessorTime.TotalMilliseconds)),$($_.WorkingSet64)" }`;
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
        if (err && !stdout) return resolve(out);
        const now = Date.now();
        for (const [pid, v] of parseSamples(stdout)) {
          const p = this.prev.get(pid);
          let cpu: number | null = null;
          if (p && now > p.at) cpu = Math.max(0, ((v.cpuMs - p.cpuMs) / (now - p.at) / this.cores) * 100);
          this.prev.set(pid, { cpuMs: v.cpuMs, at: now });
          out.set(pid, { cpu, memMB: v.mem / 1024 / 1024 });
        }
        resolve(out);
      });
    });
  }
}
