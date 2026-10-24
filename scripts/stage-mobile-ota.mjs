import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import * as acorn from 'acorn';
import { analyze } from 'eslint-scope';
import postcss from 'postcss';
import { OTA_RELEASES, otaReleaseFor } from '../ota-release.config.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STAGE = path.join(ROOT, 'review', 'ota-release');
const BUILD = path.join(ROOT, 'review', 'ota-build');
const USAGE = 'Usage: node scripts/stage-mobile-ota.mjs [--app salary|udhaar|all] [--validate-only]';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function parseArgs(args) {
  const options = { app: 'all', validateOnly: false, help: false };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--validate-only') options.validateOnly = true;
    else if (args[index] === '--help' || args[index] === '-h') options.help = true;
    else if (args[index] === '--app') {
      options.app = args[++index];
      if (!['salary', 'udhaar', 'all'].includes(options.app)) throw new Error(USAGE);
    } else throw new Error(USAGE);
  }
  return options;
}

export function readPublishedTree() {
  let revision;
  try {
    revision = execFileSync('git', ['rev-parse', '--verify', 'origin/main^{commit}'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    throw new Error('OTA immutability checks require the local origin/main reference. Fetch origin/main before preparing a release.', { cause: error });
  }
  const filenames = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', revision, '--', 'ota/', 'ota-udhaar/'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  return {
    ref: 'origin/main', revision, files: new Set(filenames),
    read: filename => execFileSync('git', ['show', `${revision}:${filename}`], { cwd: ROOT, maxBuffer: 32e6, stdio: ['ignore', 'pipe', 'pipe'] }),
  };
}

export function assertPublishedPayloadUnchanged(filename, bytes, published) {
  if (!published.files.has(filename)) return;
  if (sha256(bytes) !== sha256(published.read(filename))) {
    throw new Error(`Published OTA payload ${filename} differs from ${published.ref} (${published.revision.slice(0, 7)}). Bump the release version and use a new payload filename.`);
  }
}

function validateJs(js, release) {
  if (Buffer.byteLength(js) < 1024) throw new Error(`${release.mode}: OTA JavaScript is too small for the native loader.`);
  if (release.mode === 'udhaar' && !js.startsWith('window.__UDHAAR_ONLY_APK__')) {
    throw new Error('Udhaar bundle must set its native app flag before execution.');
  }
  const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script', ranges: true });
  const scopes = analyze(ast, { ecmaVersion: 2022, sourceType: 'script', optimistic: true, ignoreEval: true });
  const unboundProcess = new Set(scopes.globalScope.through
    .filter(reference => reference.identifier.name === 'process').map(reference => reference.identifier));
  (function visit(node) {
    if (!node || typeof node !== 'object') return;
    // React retains guarded Node fallbacks in its browser bundle. Environment
    // dependencies must be compiled away rather than supplied by a fake global.
    if (node.type === 'MemberExpression' && unboundProcess.has(node.object)
        && (node.computed ? node.property.value === 'env' : node.property.name === 'env')) {
      throw new Error(`${release.mode}: OTA payload references unavailable browser process.env.`);
    }
    if (node.type === 'ImportExpression' || node.type === 'ImportDeclaration' || String(node.type).startsWith('Export')) {
      throw new Error(`${release.mode}: OTA payload depends on another JavaScript module.`);
    }
    if (node.type === 'MetaProperty' && node.meta?.name === 'import') throw new Error(`${release.mode}: OTA payload uses import.meta.`);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  })(ast);
}

function validateCss(css, release) {
  if (Buffer.byteLength(css) <= 50) throw new Error(`${release.mode}: OTA CSS is too small for the native loader.`);
  const parsed = postcss.parse(css, { from: release.cssFile });
  parsed.walkAtRules('import', () => { throw new Error(`${release.mode}: OTA CSS cannot import another stylesheet.`); });
  let inlineFontSources = 0;
  parsed.walkDecls(declaration => {
    for (const match of declaration.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
      const url = match[2].trim();
      if (!url.startsWith('data:') && !url.startsWith('#')) throw new Error(`${release.mode}: OTA CSS has an unpackaged asset URL: ${url}`);
      if (declaration.prop === 'src' && url.startsWith('data:')) inlineFontSources += 1;
    }
  });
  if (inlineFontSources < 2) throw new Error(`${release.mode}: expected regular and bold font data embedded in CSS.`);
  return { inlineFontSources };
}

async function validateRelease(release, manifest, published) {
  const directory = path.join(STAGE, release.directory);
  const jsBytes = await fs.readFile(path.join(directory, release.jsFile));
  const cssBytes = await fs.readFile(path.join(directory, release.cssFile));
  validateJs(jsBytes.toString('utf8'), release);
  const css = validateCss(cssBytes.toString('utf8'), release);
  if (sha256(jsBytes) !== manifest.jsSha256 || sha256(cssBytes) !== manifest.cssSha256) throw new Error(`${release.mode}: payload SHA256 does not match its manifest.`);
  assertPublishedPayloadUnchanged(`${release.directory}/${release.jsFile}`, jsBytes, published);
  assertPublishedPayloadUnchanged(`${release.directory}/${release.cssFile}`, cssBytes, published);
  const filenames = await fs.readdir(directory);
  const allowed = [release.jsFile, release.cssFile, release.manifestFile];
  for (const filename of filenames.filter(name => !allowed.includes(name))) {
    const relative = `${release.directory}/${filename}`;
    if (!/^(?:app|udhaar)-bundle-\d+(?:\.\d+)+\.(?:js|css)$/.test(filename) || !published.files.has(relative)) {
      throw new Error(`${release.mode}: unexpected file in OTA staging: ${filename}`);
    }
    assertPublishedPayloadUnchanged(relative, await fs.readFile(path.join(directory, filename)), published);
  }
  return {
    mode: release.mode, version: release.version, buildId: release.buildId,
    directory, jsFile: release.jsFile, cssFile: release.cssFile,
    jsBytes: jsBytes.length, cssBytes: cssBytes.length,
    jsSha256: manifest.jsSha256, cssSha256: manifest.cssSha256,
    ...css,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`${USAGE}\n\nDefault app: all. Use --app salary to prepare only the Salary release.\nBuilds stay local; existing published payload filenames cannot change bytes.`);
    return;
  }
  const published = readPublishedTree();
  const releases = OTA_RELEASES.filter(item => options.app === 'all' || item.mode === options.app).map(item => otaReleaseFor(item.mode));
  const createdAt = new Date().toISOString();
  const results = [];
  const candidates = [];
  // Build away from staging so a failed guard cannot overwrite a published
  // filename or remove an earlier release's local artifacts.
  if (!options.validateOnly) {
    for (const release of releases) {
      const directory = path.join(BUILD, release.mode);
      await build({ configFile: path.join(ROOT, 'vite.ota.config.js'), mode: release.mode, build: { outDir: directory } });
      const jsBytes = await fs.readFile(path.join(directory, release.jsFile));
      const cssBytes = await fs.readFile(path.join(directory, release.cssFile));
      validateJs(jsBytes.toString('utf8'), release);
      validateCss(cssBytes.toString('utf8'), release);
      assertPublishedPayloadUnchanged(`${release.directory}/${release.jsFile}`, jsBytes, published);
      assertPublishedPayloadUnchanged(`${release.directory}/${release.cssFile}`, cssBytes, published);
      const emitted = await fs.readdir(directory);
      if (emitted.length !== 2 || !emitted.includes(release.jsFile) || !emitted.includes(release.cssFile)) throw new Error(`${release.mode}: OTA build must emit only its JavaScript and CSS payloads.`);
      const manifest = {
        ...(release.mode === 'udhaar' ? { appType: 'udhaar-only' } : {}),
        version: release.version, buildId: release.buildId,
        [release.mode === 'udhaar' ? 'updatedAt' : 'releasedAt']: createdAt,
        jsFile: release.jsFile, cssFile: release.cssFile, notes: release.notes,
        jsSha256: sha256(jsBytes), cssSha256: sha256(cssBytes),
      };
      candidates.push({ release, manifest, jsBytes, cssBytes });
    }
    for (const { release, manifest, jsBytes, cssBytes } of candidates) {
      const directory = path.join(STAGE, release.directory);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, release.jsFile), jsBytes);
      await fs.writeFile(path.join(directory, release.cssFile), cssBytes);
      await fs.writeFile(path.join(directory, release.manifestFile), JSON.stringify(manifest, null, 2) + '\n');
    }
  }
  for (const release of releases) {
    const manifestPath = path.join(STAGE, release.directory, release.manifestFile);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.version !== release.version || manifest.buildId !== release.buildId
        || manifest.jsFile !== release.jsFile || manifest.cssFile !== release.cssFile
        || (release.mode === 'udhaar' && manifest.appType !== 'udhaar-only')) {
      throw new Error(`${release.mode}: staged manifest does not match the release definition.`);
    }
    const result = await validateRelease(release, manifest, published);
    results.push(result);
    console.log(`Validated ${release.mode} ${release.version}: ${result.jsBytes} bytes JS, ${result.cssBytes} bytes CSS, ${result.inlineFontSources} embedded fonts.`);
  }
  if (!options.validateOnly) {
    const report = { createdAt, selectedApp: options.app, stagedOnly: true, nativeHashEnforcement: false, publishedRef: published.ref, publishedRevision: published.revision, releases: results };
    await fs.writeFile(path.join(STAGE, `release-validation${options.app === 'all' ? '' : `-${options.app}`}.json`), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`OTA payloads are staged locally at ${STAGE}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
