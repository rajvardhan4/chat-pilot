import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { ROOT } from '../config/env.js';

/**
 * Dynamically resolves the current plugin version from chat-pilot.php
 * so the portal UI always reflects the live plugin build.
 */
export function getPluginVersion() {
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

/**
 * Locates the canonical, latest plugin ZIP archive for download.
 * Checks bundled downloads directory first, falling back to build outputs.
 */
export function getPluginZipFile() {
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
