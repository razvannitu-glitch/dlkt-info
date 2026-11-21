import {createHash} from 'node:crypto';
import {copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

const generated = new Set(['node_modules', '.build']);
const forbidden = new Set(['.git', '.vercel', '.next', '.cache', '__pycache__', 'coverage']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function assertSourcePath(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') ||
      file.split('/').some(part => !part || part === '.' || part === '..' || generated.has(part) || forbidden.has(part) || part.startsWith('._') || /^\.env(?:\.|$)/u.test(part)) ||
      /^[A-Za-z]:/u.test(file) || file.startsWith('supabase/.temp/')) throw new Error('SOURCE_PATH');
  return file;
}
function sourceFiles(root, relative = '') {
  if (!relative && (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())) throw new Error('SOURCE_ROOT');
  const result = [];
  for (const name of readdirSync(join(root, relative)).sort()) {
    if (generated.has(name)) continue;
    const file = relative ? `${relative}/${name}` : name;
    assertSourcePath(file);
    const info = lstatSync(join(root, file));
    if (info.isSymbolicLink()) throw new Error('SOURCE_SYMLINK');
    if (info.isDirectory()) result.push(...sourceFiles(root, file));
    else if (info.isFile()) result.push(file);
    else throw new Error('SOURCE_FILE_TYPE');
  }
  return result.sort();
}
function canonicalFiles(files) {
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
export function createSourcePin(root) {
  const files = Object.fromEntries(sourceFiles(root).map(file => [file, sha256(readFileSync(join(root, file)))]));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifestPath = `RELEASE-${pkg.version}.json`;
  if (!files[manifestPath]) throw new Error('SOURCE_MANIFEST_MISSING');
  return {format: 'dlkt-info-source-pin-1', product: 'dlkt-info', version: pkg.version, manifestPath,
    sourceSha256: sha256(JSON.stringify(canonicalFiles(files))), files};
}
export function verifySource(root, pin) {
  if (pin?.format !== 'dlkt-info-source-pin-1' || pin.product !== 'dlkt-info' ||
      !pin.files || typeof pin.files !== 'object' || Array.isArray(pin.files)) throw new Error('SOURCE_PIN');
  const expected = Object.keys(pin.files).sort();
  for (const file of expected) {
    assertSourcePath(file);
    if (!/^[a-f0-9]{64}$/u.test(pin.files[file])) throw new Error('SOURCE_HASH_FORMAT');
  }
  if (pin.sourceSha256 !== sha256(JSON.stringify(canonicalFiles(pin.files)))) throw new Error('SOURCE_INDEX_INTEGRITY');
  if (JSON.stringify(sourceFiles(root)) !== JSON.stringify(expected)) throw new Error('SOURCE_FILE_SET');
  for (const file of expected) if (sha256(readFileSync(join(root, file))) !== pin.files[file]) throw new Error(`SOURCE_INTEGRITY:${file}`);
  assertSourcePath(pin.manifestPath);
  if (!Object.hasOwn(pin.files, pin.manifestPath)) throw new Error('SOURCE_MANIFEST_UNPINNED');
  const manifest = JSON.parse(readFileSync(join(root, pin.manifestPath), 'utf8'));
  if (manifest.product !== 'dlkt-info' || manifest.version !== pin.version ||
      !/^[a-f0-9]{64}$/u.test(manifest.expectedSchemaFingerprint) ||
      !/^\d{14}_dlkt_info_[a-z0-9_]+$/u.test(manifest.databaseReadinessMigration) ||
      !manifest.files || typeof manifest.files !== 'object') throw new Error('SOURCE_MANIFEST');
  for (const [file, hash] of Object.entries(manifest.files)) {
    assertSourcePath(file);
    if (pin.files[file] !== hash) throw new Error(`SOURCE_MANIFEST_FILE:${file}`);
  }
  const migration = `supabase/migrations/${manifest.databaseReadinessMigration}.sql`;
  if (!manifest.files[migration]) throw new Error('SOURCE_MIGRATION_UNPINNED');
  return manifest;
}
export function copyVerifiedSource(source, destination, pin) {
  if (resolve(source) === resolve(destination)) throw new Error('SOURCE_DESTINATION');
  verifySource(source, pin);
  for (const file of Object.keys(pin.files)) {
    const target = join(destination, assertSourcePath(file));
    mkdirSync(dirname(target), {recursive: true});
    copyFileSync(join(source, file), target);
  }
  verifySource(destination, pin);
}
