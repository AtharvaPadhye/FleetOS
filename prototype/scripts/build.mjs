import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/src', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('src/main.js', 'dist/src/main.js');
await cp('src/style.css', 'dist/src/style.css');
console.log('FleetOS static production build created in dist/');
