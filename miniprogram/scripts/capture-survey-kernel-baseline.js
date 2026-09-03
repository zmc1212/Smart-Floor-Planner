const fs = require('node:fs');
const path = require('node:path');
const { captureSurveyKernelBaseline } = require('../test/fixtures/survey-kernel-baseline/capture.js');

const outputPath = path.resolve(
  __dirname,
  '../test/fixtures/survey-kernel-baseline/expected-behavior.json'
);

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const actual = serialize(captureSurveyKernelBaseline());
  if (process.argv.includes('--write')) {
    fs.writeFileSync(outputPath, actual, 'utf8');
    process.stdout.write(`Wrote ${path.relative(process.cwd(), outputPath)}\n`);
    return;
  }

  if (!fs.existsSync(outputPath)) {
    process.stderr.write(`Missing ${path.relative(process.cwd(), outputPath)}; run with --write once.\n`);
    process.exitCode = 1;
    return;
  }
  const expected = fs.readFileSync(outputPath, 'utf8');
  if (actual !== expected) {
    process.stderr.write(
      'Survey kernel behavior differs from the Phase 0 baseline. Review the semantic diff before regenerating.\n'
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Survey kernel Phase 0 behavior baseline matches.\n');
}

if (require.main === module) main();

module.exports = { main, outputPath, serialize };
