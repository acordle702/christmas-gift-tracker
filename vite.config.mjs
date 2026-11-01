import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function resolveExportTarget(pkgDir, exportEntry) {
  if (typeof exportEntry === 'string') return join(pkgDir, exportEntry);
  if (exportEntry && typeof exportEntry === 'object') {
    for (const cond of ['browser', 'import', 'module', 'default']) {
      if (typeof exportEntry[cond] === 'string') return join(pkgDir, exportEntry[cond]);
      if (exportEntry[cond] && typeof exportEntry[cond] === 'object') {
        for (const sc of ['browser', 'import', 'module', 'default']) {
          if (typeof exportEntry[cond][sc] === 'string') return join(pkgDir, exportEntry[cond][sc]);
        }
      }
    }
  }
  return null;
}

function buildAliases() {
  const nmDir = join(__dirname, 'node_modules');
  const aliases = {};
  if (!existsSync(nmDir)) return aliases;

  function addPackage(pkgName, pkgDir) {
    const pkg = readJson(join(pkgDir, 'package.json'));
    if (!pkg) return;
    const mainEntry = pkg.module || (pkg.browser && typeof pkg.browser === 'string' ? pkg.browser : pkg.main) || 'index.js';
    const mainPath = join(pkgDir, mainEntry);
    if (existsSync(mainPath)) aliases[pkgName] = mainPath;

    if (pkg.exports) {
      for (const [key, value] of Object.entries(pkg.exports)) {
        if (key === '.') continue;
        const resolved = resolveExportTarget(pkgDir, value);
        if (resolved && existsSync(resolved)) {
          const subImport = pkgName + key.replace(/^\./, '');
          aliases[subImport] = resolved;
        }
      }
    }
  }

  try {
    for (const entry of readdirSync(nmDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('@')) {
        const scopedDir = join(nmDir, entry.name);
        for (const se of readdirSync(scopedDir, { withFileTypes: true })) {
          if (!se.isDirectory() || se.name.startsWith('.')) continue;
          const pkgDir = join(scopedDir, se.name);
          if (existsSync(join(pkgDir, 'package.json'))) {
            addPackage(`${entry.name}/${se.name}`, pkgDir);
          }
        }
      } else {
        const pkgDir = join(nmDir, entry.name);
        if (existsSync(join(pkgDir, 'package.json'))) {
          addPackage(entry.name, pkgDir);
        }
      }
    }
  } catch {}

  return aliases;
}

const aliases = buildAliases();

const aliasArray = Object.entries(aliases).map(([find, replacement]) => {
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { find: new RegExp(`^${escaped}$`), replacement };
});

export default {
  esbuild: { jsx: 'automatic' },
  resolve: { alias: aliasArray },
  build: {
    rolldownOptions: {
      resolve: {
        alias: aliases,
      },
    },
  },
};
