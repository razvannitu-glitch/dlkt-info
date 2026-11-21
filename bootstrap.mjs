import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {copyVerifiedSource, verifySource} from './lib/source-integrity.mjs';
import {attestProduction, PROJECT_ID} from './lib/production-attestation.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = join(root, 'source');
const pin = JSON.parse(readFileSync(join(root, 'SOURCE-PIN.json'), 'utf8'));
const manifest = verifySource(source, pin);
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !['--check', '--local'].includes(arg))) throw new Error('BUILD_ARGUMENT');
const expectedConfig = JSON.parse(readFileSync(join(source, 'vercel.public.json'), 'utf8'));
expectedConfig.installCommand = 'npm ci --ignore-scripts --no-audit --no-fund';
if (JSON.stringify(JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))) !== JSON.stringify(expectedConfig)) throw new Error('PUBLIC_CONFIG_MISMATCH');
if (args[0] === '--check') {
  console.log(`DLKT_SOURCE_VERIFIED ${pin.sourceSha256}`);
} else {
  if (args[0] === '--local') {
    if (process.env.VERCEL === '1') throw new Error('LOCAL_BUILD_FORBIDDEN_ON_VERCEL');
  } else await attestProduction(manifest);
  if (!existsSync(join(root, 'node_modules', '.bin', 'tsc'))) throw new Error('DEPENDENCIES_REQUIRED_RUN_NPM_CI');
  const output = args[0] === '--local' ? join(root, '.dlkt-local-build') : root;
  if (existsSync(output) && (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory())) throw new Error('BUILD_OUTPUT_PATH');
  const stage = mkdtempSync(join(root, '.dlkt-build-'));
  try {
    copyVerifiedSource(source, stage, pin);
    symlinkSync(resolve(root, 'node_modules'), join(stage, 'node_modules'), 'dir');
    execFileSync('npm', ['run', 'build'], {cwd: stage, stdio: 'inherit'});
    const {preparePublicRelease} = await import(pathToFileURL(join(stage, 'scripts', 'prepare-public-release.mjs')).href);
    const release = preparePublicRelease(stage, {projectId: PROJECT_ID, build: true});
    const handlers = Object.keys(expectedConfig.functions).map(file => `/${file.replace(/\.ts$/u, '')}`).sort();
    if (JSON.stringify(release.api.slice().sort()) !== JSON.stringify(handlers)) throw new Error('PUBLIC_API_MISMATCH');
    mkdirSync(output, {recursive: true});
    for (const directory of ['api', 'src', 'public', 'public-launch', '.build']) {
      rmSync(join(output, directory), {recursive: true, force: true});
      cpSync(join(stage, directory), join(output, directory), {recursive: true});
    }
    for (const file of ['tsconfig.json', 'tsconfig.build.json']) cpSync(join(stage, file), join(output, file));
    if (output !== root) cpSync(join(root, 'vercel.json'), join(output, 'vercel.json'));
    verifySource(source, pin);
    console.log(`DLKT_PUBLIC_BUILD_VERIFIED ${pin.sourceSha256}`);
  } finally {
    rmSync(stage, {recursive: true, force: true});
  }
}
