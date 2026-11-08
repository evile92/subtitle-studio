import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const rootDir = process.cwd();

const hookCode = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = ${JSON.stringify(rootDir)};

function tryResolveTs(candidatePath) {
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const full = candidatePath + ext;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return pathToFileURL(full).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = path.join(rootDir, 'src', specifier.slice(2));
    const resolved = tryResolveTs(target);
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const target = path.resolve(parentDir, specifier);
    const resolved = tryResolveTs(target);
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
`;

register(
  `data:text/javascript;base64,${Buffer.from(hookCode).toString('base64')}`,
  pathToFileURL('./')
);
