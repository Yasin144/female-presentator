import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import * as acorn from 'acorn';
import { analyze } from 'eslint-scope';
import postcss from 'postcss';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STAGE = path.join(ROOT, 'review', 'ota-release');
const RELEASES = [
  {
    mode: 'salary', directory: 'ota', version: '8.2.34',
    buildId: 'ota_8_2_34_time_is_money_silent_expenses',
    jsFile: 'app-bundle-8.2.34.js', cssFile: 'app-bundle-8.2.34.css', manifestFile: 'ota-manifest.json',
    notes: 'v8.2.34: Updated Time Is Money interface and private transaction views. Opening Expenses no longer plays the app confirmation beep. Existing biometric protection and records are preserved. Screen-off reminder and background update controls require a compatible Android APK.',
  },
  {
    mode: 'udhaar', directory: 'ota-udhaar', version: '1.0.11',
    buildId: 'udhaar_ota_1_0_11_time_is_money_transactions',
    jsFile: 'udhaar-bundle-1.0.11.js', cssFile: 'udhaar-bundle-1.0.11.css', manifestFile: 'udhaar-ota-manifest.json',
    notes: 'v1.0.11: Updated Udhaar Book interface and transaction details with existing biometric protection and records preserved. Background update controls require a compatible Android APK.',
  },
];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

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

async function validateRelease(release, manifest) {
  const directory = path.join(STAGE, release.directory);
  const jsBytes = await fs.readFile(path.join(directory, release.jsFile));
  const cssBytes = await fs.readFile(path.join(directory, release.cssFile));
  validateJs(jsBytes.toString('utf8'), release);
  const css = validateCss(cssBytes.toString('utf8'), release);
  if (sha256(jsBytes) !== manifest.jsSha256 || sha256(cssBytes) !== manifest.cssSha256) throw new Error(`${release.mode}: payload SHA256 does not match its manifest.`);
  const filenames = await fs.readdir(directory);
  const allowed = [release.jsFile, release.cssFile, release.manifestFile];
  if (filenames.some(name => !allowed.includes(name))) throw new Error(`${release.mode}: unexpected files in OTA payload: ${filenames.filter(name => !allowed.includes(name)).join(', ')}`);
  return {
    mode: release.mode, version: release.version, buildId: release.buildId,
    directory, jsFile: release.jsFile, cssFile: release.cssFile,
    jsBytes: jsBytes.length, cssBytes: cssBytes.length,
    jsSha256: manifest.jsSha256, cssSha256: manifest.cssSha256,
    ...css,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === '--validate-only')) throw new Error('Usage: node scripts/stage-mobile-ota.mjs [--validate-only]');
  const validateOnly = args[0] === '--validate-only';
  const createdAt = new Date().toISOString();
  const results = [];
  for (const release of RELEASES) {
    const directory = path.join(STAGE, release.directory);
    const manifestPath = path.join(directory, release.manifestFile);
    if (!validateOnly) {
      await build({ configFile: path.join(ROOT, 'vite.ota.config.js'), mode: release.mode });
      const manifest = {
        ...(release.mode === 'udhaar' ? { appType: 'udhaar-only' } : {}),
        version: release.version, buildId: release.buildId,
        [release.mode === 'udhaar' ? 'updatedAt' : 'releasedAt']: createdAt,
        jsFile: release.jsFile, cssFile: release.cssFile, notes: release.notes,
        jsSha256: sha256(await fs.readFile(path.join(directory, release.jsFile))),
        cssSha256: sha256(await fs.readFile(path.join(directory, release.cssFile))),
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.version !== release.version || manifest.buildId !== release.buildId
        || manifest.jsFile !== release.jsFile || manifest.cssFile !== release.cssFile
        || (release.mode === 'udhaar' && manifest.appType !== 'udhaar-only')) {
      throw new Error(`${release.mode}: staged manifest does not match the release definition.`);
    }
    const result = await validateRelease(release, manifest);
    results.push(result);
    console.log(`Validated ${release.mode} ${release.version}: ${result.jsBytes} bytes JS, ${result.cssBytes} bytes CSS, ${result.inlineFontSources} embedded fonts.`);
  }
  if (!validateOnly) {
    await fs.writeFile(path.join(STAGE, 'release-validation.json'), JSON.stringify({ createdAt, stagedOnly: true, nativeHashEnforcement: false, releases: results }, null, 2) + '\n');
  }
  console.log(`OTA payloads are staged locally at ${STAGE}.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
