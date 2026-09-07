import { cpSync, mkdirSync } from 'node:fs';
// Explicit allowlist: never publish the repository root or server environment files.
mkdirSync('public', { recursive: true });
for (const source of ['index.html', 'images', 'css', 'js', 'fonts']) cpSync(source, `public/${source}`, { recursive: true });
console.log('Arquivos públicos preparados.');
