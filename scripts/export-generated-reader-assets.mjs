import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readStableRegularFile} from '../lib/stable-local-read.mjs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256, verifySource} from '../lib/source-integrity.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_FILES = 128;
const CHUNK_CHARACTERS = 4096; // Base64 quantum aligned; each log line stays below 4.2 KiB.
const FORMAT = 'dlkt-reader-assets-1';
const BEGIN = 'DLKT_READER_ASSETS_BEGIN';
const CHUNK = 'DLKT_READER_ASSETS_CHUNK';
const END = 'DLKT_READER_ASSETS_END';

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root, maxBuffer: MAX_OUTPUT_BYTES, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('READER_EXPORT_GIT_FAILED');
  }
}

function decodeUtf8(bytes) {
  const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('READER_EXPORT_UTF8');
  return text;
}

function allowedPath(file, manifestPath) {
  return file === 'SOURCE-PIN.json' || file === 'vercel.json' ||
    file === 'source/' + manifestPath ||
    ['about','terms','privacy','cookies','disclaimer','sources','accessibility','company','contact','iceo','account','organizations','wallet'].some(name => file === 'source/public/' + name + '.html') ||
    /^source\/public\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(file);
}

function nulFields(bytes) {
  const text = decodeUtf8(bytes);
  if (!text) return [];
  if (!text.endsWith('\0')) throw new Error('READER_EXPORT_GIT_FORMAT');
  return text.slice(0, -1).split('\0');
}

function changedPaths(manifestPath) {
  const tracked = nulFields(git([
    'diff', '--name-status', '--no-renames', '-z', 'HEAD', '--',
    'source', 'SOURCE-PIN.json', 'vercel.json',
  ]));
  if (tracked.length % 2 !== 0) throw new Error('READER_EXPORT_GIT_FORMAT');
  const changed = new Map();
  for (let index = 0; index < tracked.length; index += 2) {
    const status = tracked[index], file = tracked[index + 1];
    if (!['A', 'M', 'D'].includes(status) || changed.has(file)) {
      throw new Error('READER_EXPORT_CHANGE_TYPE');
    }
    changed.set(file, status === 'D' ? 'delete' : 'write');
  }
  for (const file of nulFields(git([
    'ls-files', '--others', '--exclude-standard', '-z', '--',
    'source', 'SOURCE-PIN.json', 'vercel.json',
  ]))) {
    if (changed.has(file)) throw new Error('READER_EXPORT_DUPLICATE_PATH');
    changed.set(file, 'write');
  }
  if (changed.size > MAX_FILES) throw new Error('READER_EXPORT_FILE_LIMIT');
  for (const file of changed.keys()) {
    if (!allowedPath(file, manifestPath)) throw new Error('READER_EXPORT_UNEXPECTED_PATH:' + file);
  }
  return [...changed.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

function baseline(file) {
  const entry = nulFields(git(['ls-tree', '-z', 'HEAD', '--', file]));
  if (!entry.length) return null;
  if (entry.length !== 1 || !entry[0].startsWith('100644 blob ') ||
      entry[0].slice(entry[0].indexOf('\t') + 1) !== file) {
    throw new Error('READER_EXPORT_BASE_TYPE');
  }
  return sha256(git(['show', 'HEAD:' + file]));
}

function readText(file) {
  let bytes;
  try {
    bytes = readStableRegularFile(join(root, file), {maxBytes: MAX_OUTPUT_BYTES, rejectExecutable: true});
  } catch (error) {
    if (error?.message === 'DLKT_LOCAL_READ_SIZE') throw new Error('READER_EXPORT_FILE_BYTES');
    if (error?.message === 'DLKT_LOCAL_READ_TYPE' || error?.code === 'ELOOP') throw new Error('READER_EXPORT_FILE_TYPE');
    throw new Error('READER_EXPORT_FILE_READ');
  }
  const content = decodeUtf8(bytes);
  return {content, bytes: bytes.length, sha256: sha256(bytes)};
}

function newsRegistryProjection() {
  const compiled = decodeUtf8(readStableRegularFile(join(root, 'source/.build/src/iceo/news-sources.js'), {maxBytes: MAX_OUTPUT_BYTES, rejectExecutable: true}))
    .replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu, '');
  const shipped = readText('source/public/news-sources.js');
  if (compiled !== shipped.content) throw new Error('READER_EXPORT_NEWS_PROJECTION');
  return {
    compiledPath: 'source/.build/src/iceo/news-sources.js',
    publicPath: 'source/public/news-sources.js',
    publicSha256: shipped.sha256,
  };
}

function frameEnvelope(envelope) {
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8');
  if (payload.length > MAX_OUTPUT_BYTES) throw new Error('READER_EXPORT_OUTPUT_LIMIT');
  const digest = sha256(payload), encoded = payload.toString('base64');
  const count = Math.ceil(encoded.length / CHUNK_CHARACTERS);
  const header = {
    format: FORMAT, inputCommit: envelope.inputCommit,
    payloadBytes: payload.length, payloadSha256: digest, chunks: count,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  };
  const lines = [BEGIN + ' ' + JSON.stringify(header)];
  for (let index = 0; index < count; index++) {
    lines.push(CHUNK + ' ' + String(index + 1).padStart(6, '0') + ' ' +
      encoded.slice(index * CHUNK_CHARACTERS, (index + 1) * CHUNK_CHARACTERS));
  }
  lines.push(END + ' ' + digest);
  const output = lines.join('\n') + '\n';
  // Check the complete framed output before printing any marker or payload.
  if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new Error('READER_EXPORT_OUTPUT_LIMIT');
  }
  return output;
}

function selfTest() {
  const manifestPath = 'RELEASE-0.9.46.json';
  for (const file of ['SOURCE-PIN.json', 'vercel.json', 'source/' + manifestPath,
    'source/public/i18n-locale.js', 'source/public/news-sources.js',
    ...['about','terms','privacy','cookies','disclaimer','sources','accessibility','company','contact','iceo','account','organizations','wallet'].map(name=>'source/public/'+name+'.html')]) {
    assert.equal(allowedPath(file, manifestPath), true);
  }
  for (const file of ['.env', 'source/.env', 'source/src/iceo/news-sources.ts',
    'source/public/../secrets.js', 'source/public/nested/module.js',
    'source/public/credential.json', 'source/public/secret.js\n.env',
    'source/public/unknown.html', 'source/public/index.html', 'source/public/sources.html/secret.js',
    'source/public/sources.html\n.env']) {
    assert.equal(allowedPath(file, manifestPath), false);
  }
  assert.deepEqual(nulFields(Buffer.from('M\0source/public/reader.js\0')), ['M', 'source/public/reader.js']);
  assert.throws(() => nulFields(Buffer.from('M\0source/public/reader.js')), /GIT_FORMAT/u);
  assert.throws(() => decodeUtf8(Buffer.from([0xff])), /encoded data/u);
  assert.equal(decodeUtf8(Buffer.from('\uFEFForiginal\n')), '\uFEFForiginal\n');
  const content = 'const title = "Bucuresti 東京 العربية 🧭";\n' + 'x'.repeat(CHUNK_CHARACTERS * 2);
  const envelope = {
    format: FORMAT, inputCommit: '1'.repeat(40), sourceSha256: '2'.repeat(64),
    files: [{path: 'source/public/example.js', operation: 'write', baseSha256: null,
      encoding: 'utf-8', content, bytes: Buffer.byteLength(content), sha256: sha256(content)}],
  };
  const lines = frameEnvelope(envelope).trimEnd().split('\n');
  const header = JSON.parse(lines[0].slice((BEGIN + ' ').length));
  const chunks = lines.slice(1, -1);
  assert.equal(chunks.length, header.chunks);
  assert.ok(chunks.length > 1);
  assert.ok(lines.every(line => Buffer.byteLength(line) < 4200));
  const joined = chunks.map((line, index) => {
    const prefix = CHUNK + ' ' + String(index + 1).padStart(6, '0') + ' ';
    assert.ok(line.startsWith(prefix));
    return line.slice(prefix.length);
  }).join('');
  const decoded = Buffer.from(joined, 'base64');
  assert.equal(decoded.length, header.payloadBytes);
  assert.equal(sha256(decoded), header.payloadSha256);
  assert.equal(lines.at(-1), END + ' ' + header.payloadSha256);
  assert.deepEqual(JSON.parse(decodeUtf8(decoded)), envelope);
  assert.throws(() => frameEnvelope({...envelope, oversized: 'x'.repeat(MAX_OUTPUT_BYTES)}), /OUTPUT_LIMIT/u);
  process.stdout.write('DLKT_READER_ASSETS_EXPORT_SELF_TEST_OK\n');
}

function exportGenerated() {
  const inputCommit = decodeUtf8(git(['rev-parse', '--verify', 'HEAD'])).trim();
  if (!/^[a-f0-9]{40}$/u.test(inputCommit) ||
      (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== inputCommit)) {
    throw new Error('READER_EXPORT_CHECKOUT_IDENTITY');
  }
  const pin = JSON.parse(readText('SOURCE-PIN.json').content);
  verifySource(join(root, 'source'), pin);
  if (!/^RELEASE-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\.json$/u.test(pin.manifestPath)) {
    throw new Error('READER_EXPORT_MANIFEST_PATH');
  }
  const projection = newsRegistryProjection();
  const files = changedPaths(pin.manifestPath).map(([path, operation]) => {
    const baseSha256 = baseline(path);
    if (operation === 'delete') {
      if (baseSha256 === null || !/^source\/public\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(path)) {
        throw new Error('READER_EXPORT_DELETE_PATH');
      }
      return {path, operation, baseSha256, encoding: 'utf-8', sha256: null, bytes: 0, content: null};
    }
    return {path, operation, baseSha256, encoding: 'utf-8', ...readText(path)};
  });
  const envelope = {
    format: FORMAT, inputCommit, sourceSha256: pin.sourceSha256,
    manifestPath: 'source/' + pin.manifestPath,
    checks: {newsRegistryProjection: projection}, files,
  };
  process.stdout.write(frameEnvelope(envelope));
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') selfTest();
  else if (args.length === 0) exportGenerated();
  else throw new Error('READER_EXPORT_ARGUMENT');
} catch (error) {
  // Never dump process environment, subprocess output, source contents or credentials.
  const code = error instanceof Error && /^READER_EXPORT_[A-Z_]+(?::[A-Za-z0-9_./-]+)?$/u.test(error.message)
    ? error.message : 'READER_EXPORT_FAILED';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
}
