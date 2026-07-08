import { spawn } from 'node:child_process';
import { platform } from 'node:os';

function clipboardCommand(): [string, string[]] {
  switch (platform()) {
    case 'darwin':
      return ['pbcopy', []];
    case 'win32':
      return ['clip', []];
    default:
      return process.env.WAYLAND_DISPLAY
        ? ['wl-copy', []]
        : ['xclip', ['-selection', 'clipboard']];
  }
}

/** Copy text to the system clipboard. Returns false if no clipboard tool is available. */
export function copyToClipboard(text: string): Promise<boolean> {
  const [command, args] = clipboardCommand();
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.write(text);
    child.stdin.end();
  });
}
