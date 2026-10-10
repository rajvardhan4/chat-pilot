import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { ROOT } from '../config/env.ts';

export function getPluginVersion(): string {
  const candidates = [
    path.join(ROOT, '..', 'wordpress-plugin', 'chat-pilot', 'chat-pilot.php'),
    path.join(process.cwd(), 'wordpress-plugin', 'chat-pilot', 'chat-pilot.php'),
    path.join(process.cwd(), 'saas', '..', 'wordpress-plugin', 'chat-pilot', 'chat-pilot.php'),
    path.join(ROOT, 'wordpress-plugin', 'chat-pilot', 'chat-pilot.php'),
  ];

  for (const f of candidates) {
    try {
      if (existsSync(f)) {
        const content = readFileSync(f, 'utf8');
        const m = content.match(/Version:\s*([0-9.]+)/i);
        if (m && m[1]) {
          return m[1].trim();
        }
      }
    } catch {
      // ignore error and continue
    }
  }
  return '2.3.2';
}

export function getPluginZipFile(): string | null {
  const candidates = [
    path.join(ROOT, 'src', 'public', 'downloads', 'chat-pilot.zip'),
    path.join(ROOT, 'public', 'downloads', 'chat-pilot.zip'),
    path.join(process.cwd(), 'saas', 'src', 'public', 'downloads', 'chat-pilot.zip'),
    path.join(process.cwd(), 'saas', 'public', 'downloads', 'chat-pilot.zip'),
    path.join(process.cwd(), 'OUTPUTS', 'chat-pilot-v2.3.2.zip'),
    path.join(ROOT, '..', 'OUTPUTS', 'chat-pilot-v2.3.2.zip'),
    path.join(process.cwd(), 'OUTPUTS', 'chat-pilot-v2.3.1.zip'),
    path.join(ROOT, '..', 'OUTPUTS', 'chat-pilot-v2.3.1.zip'),
    path.join(ROOT, '..', 'OUTPUTS', 'chat-pilot.zip'),
  ];

  for (const f of candidates) {
    try {
      if (existsSync(f) && !statSync(f).isDirectory()) {
        return f;
      }
    } catch {
      // ignore error and continue
    }
  }
  return null;
}
