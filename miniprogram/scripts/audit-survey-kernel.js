const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const miniRoot = path.join(repoRoot, 'miniprogram');
const miniSurveyUtils = path.join(miniRoot, 'packages', 'surveying', 'utils');
const expectedPath = path.join(
  miniRoot,
  'test',
  'fixtures',
  'survey-kernel-baseline',
  'expected-audit.json'
);
const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules'
]);

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function walkFiles(rootPath) {
  if (!fs.existsSync(rootPath)) return [];
  const output = [];
  const visit = (entryPath) => {
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(path.basename(entryPath))) return;
      fs.readdirSync(entryPath)
        .sort()
        .forEach((name) => visit(path.join(entryPath, name)));
      return;
    }
    if (CODE_EXTENSIONS.has(path.extname(entryPath))) output.push(entryPath);
  };
  visit(rootPath);
  return output;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveLocalModule(fromFile, specifier) {
  if (!specifier || !specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function requireSpecifiers(source) {
  const specifiers = [];
  const matcher = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = matcher.exec(source))) specifiers.push(match[1]);
  return specifiers;
}

function propertyUses(source, aliases) {
  const names = [];
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, match => ' '.repeat(match.length));
  aliases.forEach((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dotted = new RegExp(`\\b${escaped}\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)`, 'g');
    const bracketed = new RegExp(`\\b${escaped}\\s*\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g');
    let match;
    while ((match = dotted.exec(code))) names.push(match[1]);
    while ((match = bracketed.exec(source))) names.push(match[1]);
    // Computed access and passing the whole object (including arrays of both
    // runtimes in differential tests) conservatively retain every export.
    const dynamic = new RegExp(`\\b${escaped}\\s*\\[\\s*[^'"\\s]`, 'g');
    const escapedObject = new RegExp(`(?:[([,=:]\\s*${escaped}\\s*[,\\])}]|\\.\\.\\.\\s*${escaped}\\b)`, 'g');
    if (dynamic.test(source) || escapedObject.test(code)) names.push('*');
  });
  return uniqueSorted(names);
}

function requireAliases(source, token) {
  const aliases = [];
  const direct = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\([^;\\n]*${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^;\\n]*\\)`,
    'g'
  );
  let match;
  while ((match = direct.exec(source))) aliases.push(match[1]);
  return uniqueSorted(aliases);
}

function classifyConsumer(relativePath) {
  if (relativePath.includes('/__tests__/') || relativePath.includes('/test/') || /(^|\/)test[^/]*\.(?:js|ts)$/.test(relativePath)) return 'test-only';
  if (relativePath.startsWith('miniprogram/packages/surveying/editor/')) return 'editor-direct';
  if (relativePath === 'miniprogram/packages/surveying/utils/surveyCanvasRenderer.js') return 'production-reachable';
  if (relativePath === 'admin/src/lib/survey-runtime/surveyCanvasRenderer.js') return 'admin-production';
  if (relativePath.startsWith('admin/src/')) return 'admin-production';
  if (relativePath.startsWith('surveying-h5/src/')) return 'developer-harness';
  if (relativePath.startsWith('surveying-h5/') || relativePath.startsWith('miniprogram/tmp')) return 'suspected-dead';
  if (relativePath.includes('/scripts/')) return 'script';
  return 'production-reachable';
}

function parseFacadeBindings(source) {
  const block = source.match(/^module\.exports = \{([\s\S]*?)^\};/m);
  if (!block) throw new Error('Facade must use explicit property bindings');
  const bindings = new Map();
  block[1].split('\n').map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const match = line.match(/^([A-Za-z_$][\w$]*): ([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*),?$/);
    if (!match) throw new Error(`Implicit facade binding: ${line}`);
    const [, name, owner, property] = match;
    if (bindings.has(name)) throw new Error(`Duplicate facade export: ${name}`);
    bindings.set(name, { owner, property });
  });
  return bindings;
}

function buildFacadeAudit() {
  const kernel = require(path.join(miniSurveyUtils, 'survey', 'legacy-kernel.js'));
  const wallGeometry = require(path.join(miniSurveyUtils, 'survey', 'read-model', 'wall-geometry.js'));
  const wallFaces = require(path.join(miniSurveyUtils, 'survey', 'read-model', 'wall-faces.js'));
  const spaceBoundary = require(path.join(miniSurveyUtils, 'survey', 'read-model', 'space-boundary.js'));
  const spaceDimensions = require(path.join(miniSurveyUtils, 'survey', 'read-model', 'space-dimensions.js'));
  const wallOperations = require(path.join(miniSurveyUtils, 'survey', 'operations', 'wall-operations.js'))
    .createWallOperations();
  const measurementOperations = require(path.join(miniSurveyUtils, 'survey', 'operations', 'measurement.js'))
    .createMeasurementOperations();
  const previewCommit = require(path.join(miniSurveyUtils, 'survey', 'operations', 'commit-preview.js'));
  const closureOperations = require(path.join(miniSurveyUtils, 'survey', 'operations', 'closure.js'))
    .createClosureOperations(previewCommit.commitPreviewLength);
  const openingOperations = require(path.join(miniSurveyUtils, 'survey', 'operations', 'opening-operations.js'))
    .createOpeningOperations();
  const { validateSurveyDraft } = require(path.join(
    miniSurveyUtils,
    'survey',
    'invariants',
    'floor-plan-validator.js'
  ));
  const facade = require(path.join(miniSurveyUtils, 'surveyWallGraph.js'));
  const interactions = require(path.join(miniSurveyUtils, 'survey/operations/interaction-operations.js'));
  const snapEngine = require(path.join(miniSurveyUtils, 'survey/snap/snap-engine.js'));
  const cursorReadModel = require(path.join(miniSurveyUtils, 'survey/read-model/cursor.js'));
  const closureInteraction = require(path.join(miniSurveyUtils, 'survey/interaction/closure-projection.js'));
  const layers = [
    ['interactions', 'interaction-operations', 'miniprogram/packages/surveying/utils/survey/operations/interaction-operations.js', interactions],
    ['snapEngine', 'snap-engine', 'miniprogram/packages/surveying/utils/survey/snap/snap-engine.js', snapEngine],
    ['cursorReadModel', 'cursor-read-model', 'miniprogram/packages/surveying/utils/survey/read-model/cursor.js', cursorReadModel],
    ['closureInteraction', 'closure-interaction', 'miniprogram/packages/surveying/utils/survey/interaction/closure-projection.js', closureInteraction],
    ['kernel', 'legacy-kernel', 'miniprogram/packages/surveying/utils/survey/legacy-kernel.js', kernel],
    ['wallGeometry', 'wall-geometry-read-model', 'miniprogram/packages/surveying/utils/survey/read-model/wall-geometry.js', wallGeometry],
    ['wallFaces', 'wall-faces-read-model', 'miniprogram/packages/surveying/utils/survey/read-model/wall-faces.js', wallFaces],
    ['spaceBoundary', 'space-boundary-read-model', 'miniprogram/packages/surveying/utils/survey/read-model/space-boundary.js', spaceBoundary],
    ['spaceDimensions', 'space-dimension-read-model', 'miniprogram/packages/surveying/utils/survey/read-model/space-dimensions.js', spaceDimensions],
    ['transactionalWalls', 'transactional-wall-operations', 'miniprogram/packages/surveying/utils/survey/operations/wall-operations.js', wallOperations],
    ['transactionalMeasurements', 'transactional-measurement-operations', 'miniprogram/packages/surveying/utils/survey/operations/measurement.js', measurementOperations],
    ['transactionalClosures', 'transactional-closure-operations', 'miniprogram/packages/surveying/utils/survey/operations/closure.js', closureOperations],
    ['transactionalOpenings', 'transactional-opening-operations', 'miniprogram/packages/surveying/utils/survey/operations/opening-operations.js', openingOperations],
    ['validator', 'floor-plan-validator', 'miniprogram/packages/surveying/utils/survey/invariants/floor-plan-validator.js', { validateSurveyDraft }]
  ];
  const directOwners = {
    constants: 'core/constants', draftCore: 'core/draft', queries: 'core/graph-query',
    legacyQueries: 'compat/legacy-queries', geometry: 'geometry/vector2',
    closureQueries: 'topology/closure-queries', wallHelpers: 'operations/wall-mutation-helpers',
    wallProperties: 'operations/wall-properties', spaceProperties: 'operations/space-properties',
    wallRepair: 'operations/wall-repair', measurementSide: 'interaction/measurement-side'
  };
  Object.entries(directOwners).forEach(([owner, relativePath]) => {
    const source = `miniprogram/packages/surveying/utils/survey/${relativePath}.js`;
    layers.push([owner, relativePath, source, require(path.join(repoRoot, source))]);
  });
  const bindings = parseFacadeBindings(fs.readFileSync(path.join(miniSurveyUtils, 'surveyWallGraph.js'), 'utf8'));
  const exportNames = Object.keys(facade).sort();
  const compatibilityProxyNames = new Set([
    'addOpeningToWall', 'commitPreviewLength', 'confirmClosure', 'deleteClosedSpace',
    'deleteOpening', 'deleteWall', 'remeasureSelectedWall', 'repairCollinearDegree2Walls',
    'renameClosedSpace', 'setMeasurementSide', 'setThickness', 'snapCursorToWall', 'updateOpening'
  ]);
  const facadeOnlyNames = new Set(['measuredReadingMm', 'projectWallFaces', 'projectWorkingFace', 'resolveBodyNormal', 'validateSurveyDraft']);
  if (JSON.stringify([...bindings.keys()].sort()) !== JSON.stringify(exportNames)) {
    throw new Error('Facade runtime exports differ from explicit source bindings');
  }
  const exports = exportNames.map((name) => {
    const sources = layers
      .filter(([, , , values]) => Object.prototype.hasOwnProperty.call(values, name))
      .map(([, layer, source]) => ({ layer, source }));
    const binding = bindings.get(name);
    const winner = layers.find(([owner]) => owner === binding.owner);
    if (!winner || !Object.prototype.hasOwnProperty.call(winner[3], binding.property)) {
      throw new Error(`Unknown facade owner for ${name}`);
    }
    const winnerValue = winner[3][binding.property];
    const matchesWinner = facade[name] === winnerValue || (
      typeof facade[name] === 'function' &&
      typeof winnerValue === 'function' &&
      facade[name].toString() === winnerValue.toString()
    );
    if (!matchesWinner) {
      throw new Error(`Facade export ${name} does not match the recorded winning layer`);
    }
    return {
      name,
      legacyStatus: facadeOnlyNames.has(name) ? 'facade-only' :
        (compatibilityProxyNames.has(name) ? 'compatibility-proxy' : 'migrated'),
      kind: typeof facade[name],
      actualSource: winner[2],
      binding: `${binding.owner}.${binding.property}`,
      sourceLayers: sources.map((source) => source.layer),
      overwritten: sources.length > 1,
      sameReferenceAsLegacy: Object.prototype.hasOwnProperty.call(kernel, name) && facade[name] === kernel[name]
    };
  });
  return {
    selection: 'explicit-property-bindings',
    sourceModules: layers.map(([, layer]) => layer),
    legacyExportCount: Object.keys(kernel).length,
    facadeExportCount: exportNames.length,
    exports,
    overrides: exports.filter((entry) => entry.overwritten).map((entry) => entry.name)
  };
}

function collectCodeFiles() {
  return uniqueSorted([
    ...walkFiles(path.join(repoRoot, 'miniprogram')),
    ...walkFiles(path.join(repoRoot, 'admin', 'src')),
    ...walkFiles(path.join(repoRoot, 'admin', 'scripts')),
    ...walkFiles(path.join(repoRoot, 'surveying-h5')),
    ...walkFiles(path.join(repoRoot, 'scripts'))
  ]);
}

function buildConsumerAudit(facadeExportNames) {
  const facadeExportSet = new Set(facadeExportNames);
  const facadeConsumers = [];
  const legacyReferences = [];

  collectCodeFiles().forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = toRepoPath(filePath);
    const facadeAliases = requireAliases(source, 'surveyWallGraph');
    const injectedSurveyGraph = relativePath === 'surveying-h5/src/scenarios.js';
    const helperSurveyGraph = relativePath === 'miniprogram/scripts/benchmark-survey-kernel.js';
    if (injectedSurveyGraph || helperSurveyGraph) facadeAliases.push('surveyGraph');
    if (facadeAliases.length) {
      const used = propertyUses(source, facadeAliases);
      const specifiers = uniqueSorted(
        [...source.matchAll(/['"]([^'"]*surveyWallGraph(?:\.js)?)['"]/g)].map((match) => match[1])
      );
      const resolvedFiles = specifiers
        .map((specifier) => {
          if (specifier.startsWith('miniprogram/')) {
            const candidate = path.resolve(repoRoot, specifier);
            return fs.existsSync(candidate) ? candidate : null;
          }
          return resolveLocalModule(filePath, specifier);
        })
        .filter(Boolean)
        .map(toRepoPath);
      const unresolved = !injectedSurveyGraph && !helperSurveyGraph &&
        specifiers.some((specifier) => specifier.startsWith('.')) &&
        resolvedFiles.length === 0;
      facadeConsumers.push({
        file: relativePath,
        classification: unresolved ? 'suspected-dead' : classifyConsumer(relativePath),
        binding: injectedSurveyGraph
          ? 'injected'
          : (helperSurveyGraph ? 'fixture-helper' : 'direct-require'),
        specifiers,
        resolvedFiles: uniqueSorted(resolvedFiles),
        unresolved,
        exports: used.includes('*') ? ['*'] : used.filter((name) => facadeExportSet.has(name)).length
          ? used.filter((name) => facadeExportSet.has(name))
          : ['*'],
        unknownProperties: used.filter((name) => name !== '*' && !facadeExportSet.has(name))
      });
    }

    if (!source.includes('legacy-kernel')) return;
    const aliases = requireAliases(source, 'legacy-kernel');
    const specifierMatches = [...source.matchAll(/['"]([^'"]*legacy-kernel(?:\.js)?)['"]/g)];
    const specifiers = uniqueSorted(specifierMatches.map((match) => match[1]));
    const resolvableSpecifiers = specifiers.filter((specifier) => (
      specifier.startsWith('.') ||
      specifier.startsWith('miniprogram/') ||
      specifier.startsWith('packages/')
    ));
    const resolvedFiles = resolvableSpecifiers
      .map((specifier) => {
        if (specifier.startsWith('miniprogram/')) {
          const candidate = path.resolve(repoRoot, specifier);
          return fs.existsSync(candidate) ? candidate : null;
        }
        if (specifier.startsWith('packages/')) {
          const candidate = path.resolve(miniRoot, specifier);
          return fs.existsSync(candidate) ? candidate : null;
        }
        return resolveLocalModule(filePath, specifier);
      })
      .filter(Boolean)
      .map(toRepoPath);
    const unresolved = resolvableSpecifiers.length > 0 && resolvedFiles.length === 0;
    legacyReferences.push({
      file: relativePath,
      classification: unresolved ? 'suspected-dead' : classifyConsumer(relativePath),
      access: aliases.length ? 'require' : 'source-reference',
      specifiers,
      resolvedFiles: uniqueSorted(resolvedFiles),
      unresolved,
      exports: aliases.length ? propertyUses(source, aliases) : []
    });
  });

  facadeConsumers.sort((first, second) => first.file.localeCompare(second.file));
  legacyReferences.sort((first, second) => first.file.localeCompare(second.file));
  return { facadeConsumers, legacyReferences };
}

function buildModuleGraph() {
  const surveyModuleFiles = walkFiles(path.join(miniSurveyUtils, 'survey'));
  const facadePath = path.join(miniSurveyUtils, 'surveyWallGraph.js');
  const moduleFiles = uniqueSorted([...surveyModuleFiles, facadePath]);
  const moduleSet = new Set(moduleFiles.map((filePath) => path.resolve(filePath)));
  const edges = [];
  moduleFiles.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    requireSpecifiers(source).forEach((specifier) => {
      const resolved = resolveLocalModule(filePath, specifier);
      if (resolved && moduleSet.has(path.resolve(resolved))) {
        edges.push({ from: toRepoPath(filePath), to: toRepoPath(resolved) });
      }
    });
  });
  edges.sort((first, second) => `${first.from}:${first.to}`.localeCompare(`${second.from}:${second.to}`));

  const adjacency = new Map();
  edges.forEach(({ from, to }) => {
    const targets = adjacency.get(from) || [];
    targets.push(to);
    adjacency.set(from, targets);
  });
  const facadeRelative = toRepoPath(facadePath);
  const facadeReachable = new Set();
  const queue = [facadeRelative];
  while (queue.length) {
    const current = queue.shift();
    if (facadeReachable.has(current)) continue;
    facadeReachable.add(current);
    (adjacency.get(current) || []).forEach((target) => queue.push(target));
  }

  const editorDirect = new Set();
  walkFiles(path.join(miniRoot, 'packages', 'surveying', 'editor')).forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    requireSpecifiers(source).forEach((specifier) => {
      const resolved = resolveLocalModule(filePath, specifier);
      if (resolved && moduleSet.has(path.resolve(resolved))) editorDirect.add(toRepoPath(resolved));
    });
  });

  const testDirect = new Set();
  collectCodeFiles().forEach((filePath) => {
    const relativePath = toRepoPath(filePath);
    if (classifyConsumer(relativePath) !== 'test-only') return;
    const source = fs.readFileSync(filePath, 'utf8');
    requireSpecifiers(source).forEach((specifier) => {
      const resolved = resolveLocalModule(filePath, specifier);
      if (resolved && moduleSet.has(path.resolve(resolved))) testDirect.add(toRepoPath(resolved));
    });
  });

  const nodes = moduleFiles.map((filePath) => {
    const relativePath = toRepoPath(filePath);
    let classification = 'suspected-dead';
    if (relativePath === facadeRelative) classification = 'facade';
    else if (facadeReachable.has(relativePath)) classification = 'production-reachable';
    else if (editorDirect.has(relativePath)) classification = 'editor-direct';
    else if (testDirect.has(relativePath)) classification = 'test-only';
    return {
      file: relativePath,
      classification,
      facadeReachable: facadeReachable.has(relativePath),
      editorDirect: editorDirect.has(relativePath),
      testDirect: testDirect.has(relativePath)
    };
  });
  nodes.sort((first, second) => first.file.localeCompare(second.file));
  return { nodes, edges };
}

function buildMirrorAudit() {
  const adminRuntimeRoot = path.join(repoRoot, 'admin', 'src', 'lib', 'survey-runtime');
  const exactPairs = walkFiles(path.join(miniSurveyUtils, 'survey')).map((sourcePath) => ({
    sourcePath,
    targetPath: path.join(adminRuntimeRoot, path.relative(miniSurveyUtils, sourcePath)),
    mode: 'exact'
  }));
  exactPairs.push({
    sourcePath: path.join(miniSurveyUtils, 'surveyWallGraph.js'),
    targetPath: path.join(adminRuntimeRoot, 'surveyWallGraph.js'),
    mode: 'exact'
  });
  exactPairs.push({
    sourcePath: path.join(miniSurveyUtils, 'surveyDimensionPlan.js'),
    targetPath: path.join(repoRoot, 'admin', 'src', 'lib', 'surveyDimensionPlan.js'),
    mode: 'exact'
  });
  exactPairs.push({
    sourcePath: path.join(miniSurveyUtils, 'surveyWallSolidPlan.js'),
    targetPath: path.join(repoRoot, 'admin', 'src', 'lib', 'surveyWallSolidPlan.js'),
    mode: 'exact'
  });
  exactPairs.push({
    sourcePath: path.join(miniSurveyUtils, 'surveyCanvasRenderer.js'),
    targetPath: path.join(adminRuntimeRoot, 'surveyCanvasRenderer.js'),
    mode: 'admin-require-rewrite'
  });
  return exactPairs.map(({ sourcePath, targetPath, mode }) => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const expectedContent = mode === 'admin-require-rewrite'
      ? source
        .replace("require('./surveyDimensionPlan.js')", "require('../surveyDimensionPlan.js')")
        .replace("require('./surveyWallSolidPlan.js')", "require('../surveyWallSolidPlan.js')")
      : source;
    return {
      source: toRepoPath(sourcePath),
      target: toRepoPath(targetPath),
      mode,
      targetExists: fs.existsSync(targetPath),
      contentMatches: fs.existsSync(targetPath) &&
        crypto.createHash('sha256').update(expectedContent).digest('hex') === hashFile(targetPath)
    };
  });
}

function buildKernelFacts() {
  const kernelPath = path.join(miniSurveyUtils, 'survey', 'legacy-kernel.js');
  const source = fs.readFileSync(kernelPath, 'utf8');
  return {
    file: toRepoPath(kernelPath),
    lineCount: source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0),
    topLevelFunctionCount: (source.match(/^function\s+[A-Za-z_$][\w$]*\s*\(/gm) || []).length
  };
}

function createSurveyKernelAudit() {
  const facade = buildFacadeAudit();
  const consumers = buildConsumerAudit(facade.exports.map((entry) => entry.name));
  return {
    schemaVersion: 1,
    scope: 'Mini Program survey wall-graph facade, kernel modules, callers, and Admin runtime mirror',
    kernel: buildKernelFacts(),
    facade,
    consumers,
    moduleGraph: buildModuleGraph(),
    adminMirror: buildMirrorAudit()
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const actual = serialize(createSurveyKernelAudit());
  if (process.argv.includes('--write')) {
    fs.writeFileSync(expectedPath, actual, 'utf8');
    process.stdout.write(`Wrote ${path.relative(process.cwd(), expectedPath)}\n`);
    return;
  }
  if (!fs.existsSync(expectedPath)) {
    process.stderr.write(`Missing ${path.relative(process.cwd(), expectedPath)}; run with --write once.\n`);
    process.exitCode = 1;
    return;
  }
  if (fs.readFileSync(expectedPath, 'utf8') !== actual) {
    process.stderr.write(
      'Survey kernel exports, consumers, dependency graph, or mirror status differ from the Phase 0 audit.\n'
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Survey kernel Phase 0 export/consumer/dependency audit matches.\n');
}

if (require.main === module) main();

module.exports = {
  buildConsumerAudit,
  buildFacadeAudit,
  buildModuleGraph,
  createSurveyKernelAudit,
  parseFacadeBindings,
  propertyUses,
  expectedPath,
  main,
  serialize
};
