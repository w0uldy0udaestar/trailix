#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { runCli } from '../src/cli.ts';

/**
 * trailix CLI entrypoint. Requires Node 24+ (native TypeScript type stripping).
 * Read-only observer: any unexpected error is swallowed to a quiet exit so the
 * tool can never disrupt the user's terminal flow. The only writes are the
 * session-map HTML files under the tool's own cache directory.
 */

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** Open a file in the platform browser — best effort, silent on failure. */
function openPath(path: string): void {
  try {
    const detach = (cmd: string, args: string[]): void => {
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    };
    if (process.platform === 'darwin') return detach('open', [path]);
    if (process.platform === 'win32') return detach('cmd', ['/c', 'start', '', path]);
    // Linux: WSL needs the Windows-side browser (a Linux path is translated
    // first); native Linux uses xdg-open.
    if (existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') || process.env['WSL_DISTRO_NAME'] !== undefined) {
      const win = spawnSync('wslpath', ['-w', path], { encoding: 'utf8' });
      const winPath = win.status === 0 ? win.stdout.trim() : undefined;
      if (winPath !== undefined && winPath !== '') return detach('explorer.exe', [winPath]);
    }
    detach('xdg-open', [path]);
  } catch {
    /* opening is a convenience — never fail the command over it */
  }
}

try {
  const result = await runCli({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    isTTY: process.stdout.isTTY === true,
    termWidth: process.stdout.columns ?? 80,
    writeFile,
    openPath,
  });
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
} catch {
  process.exitCode = 0;
}
