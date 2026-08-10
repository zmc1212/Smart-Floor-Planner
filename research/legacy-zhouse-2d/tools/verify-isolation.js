'use strict'

const fs = require('node:fs')
const path = require('node:path')

const moduleRoot = path.resolve(__dirname, '..')
const repositoryRoot = path.resolve(moduleRoot, '..', '..')
const productionRoots = [path.join(repositoryRoot, 'miniprogram'), path.join(repositoryRoot, 'admin')]
const forbiddenImport = /research[\\/]legacy-zhouse-2d|@smart-floor-planner[\\/]legacy-zhouse-2d-reconstruction/

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', '.next', 'build', 'coverage', 'dist', 'node_modules'].includes(entry.name)) return []
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(fullPath) : [fullPath]
  })
}

const violations = []
for (const root of productionRoots) {
  for (const file of walk(root)) {
    if (!/\.(?:js|ts|tsx|json|wxml)$/.test(file)) continue
    const content = fs.readFileSync(file, 'utf8')
    if (forbiddenImport.test(content)) violations.push(path.relative(repositoryRoot, file))
  }
}

if (violations.length > 0) {
  throw new Error(`production code imports the reconstruction lab:\n${violations.join('\n')}`)
}

process.stdout.write('verified reconstruction-lab isolation\n')
