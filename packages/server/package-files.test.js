import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import pkg from './package.json';
describe('electron-builder files', () => {
  it('ships every runtime module main.js requires', () => {
    const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const locals = [...src.matchAll(/require\('\.\/([\w-]+)'\)/g)].map(m => `${m[1]}.js`);
    // Glob "*.js" + "!*.test.js" must admit all of them.
    for (const f of locals) expect(pkg.build.files).toContain('*.js');
    expect(pkg.build.files).toContain('!*.test.js');
    expect(pkg.build.asarUnpack).toContain('**/node_modules/ffmpeg-static/**');
  });
});
