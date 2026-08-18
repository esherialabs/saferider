import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSuppressedRsiRelease } from '../services/privacySuppressionService.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const outputDirectory = resolve(repositoryRoot, 'docs/qa/fixtures/rsi-synthetic-proof');
const releaseId = '11111111-1111-4111-8111-111111111111';

const { release } = buildSuppressedRsiRelease([
  {
    areaId: 'cell-100-100', timeBucket: '2026-07-30T10:00:00.000Z',
    category: 'harassment', rawCount: 3,
  },
  {
    areaId: 'cell-100-101', timeBucket: '2026-07-30T10:00:00.000Z',
    category: 'harassment', rawCount: 20,
  },
], {
  releaseId,
  viewId: 'rsi-fixed-grid-v1',
  minimumCount: 10,
  differentialPrivacy: { status: 'not_approved' },
});

const proof = {
  schema: 'com.saferide.rsi-synthetic-public-proof',
  schemaVersion: 1,
  generatedAt: '2026-07-30T00:00:00.000Z',
  dataClass: 'synthetic-test-only',
  configuration: {
    profileId: 'rsi-synthetic-suppression-v1',
    minimumCount: 10,
    policyStatus: 'provisional-test-only-not-approved',
    differentialPrivacyStatus: 'not-approved-no-noise-applied',
  },
  release,
  limitations: [
    'This is a deterministic repository rendering, not a device screenshot, production run, privacy approval, or UNICEF evidence of field readiness.',
    'The synthetic threshold is test-only. Production ingestion, releases, operator access, exports, retention execution, and dashboards remain disabled.',
  ],
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character] ?? character);
}

const rows = release.cells.map((cell, index) => {
  const y = 190 + index * 54;
  return [
    `<rect x="34" y="${y - 28}" width="892" height="44" rx="8" fill="#f4f7f6"/>`,
    `<text x="54" y="${y}" class="cell">${escapeXml(cell.areaId)}</text>`,
    `<text x="280" y="${y}" class="cell">${escapeXml(cell.timeBucket)}</text>`,
    `<text x="590" y="${y}" class="cell">${escapeXml(cell.category)}</text>`,
    `<text x="790" y="${y}" class="suppressed">No data</text>`,
  ].join('\n');
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${250 + release.cells.length * 54}" viewBox="0 0 960 ${250 + release.cells.length * 54}">
  <style>
    .title { font: 700 24px sans-serif; fill: #12372a; }
    .warning { font: 700 14px sans-serif; fill: #8a3b12; }
    .meta { font: 14px sans-serif; fill: #33443e; }
    .header { font: 700 13px sans-serif; fill: #51635d; }
    .cell { font: 13px monospace; fill: #15231e; }
    .suppressed { font: 700 14px sans-serif; fill: #8a3b12; }
  </style>
  <rect width="960" height="100%" fill="#ffffff"/>
  <text x="34" y="42" class="title">SafeRide RSI suppression proof</text>
  <text x="34" y="70" class="warning">SYNTHETIC TEST OUTPUT — NOT DEVICE OR PRODUCTION EVIDENCE</text>
  <text x="34" y="100" class="meta">Provisional test-only k=10 · differential privacy not approved · public state: ${release.state}</text>
  <text x="34" y="126" class="meta">Revision ${release.revisionSha256}</text>
  <text x="54" y="154" class="header">AREA</text>
  <text x="280" y="154" class="header">FIXED TIME BUCKET</text>
  <text x="590" y="154" class="header">CATEGORY</text>
  <text x="790" y="154" class="header">PUBLIC OUTPUT</text>
  ${rows}
  <text x="34" y="${220 + release.cells.length * 54}" class="meta">Low-count and complementary cells expose no numeric value or internal suppression rationale.</text>
</svg>
`;

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, 'public-release.json'), `${JSON.stringify(proof, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 }),
  writeFile(resolve(outputDirectory, 'public-release.svg'), svg, { encoding: 'utf8', mode: 0o644 }),
]);
process.stdout.write('Generated deterministic synthetic RSI public-output proof (runtime capabilities unchanged)\n');
