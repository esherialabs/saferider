import { createHash } from 'node:crypto';

import type { PublicRsiCell, RsiRelease } from './privacySuppressionService.js';

/**
 * Public releases are immutable and fetched as a whole. Repeated calls return
 * exactly the stored values, so fresh noise cannot be averaged. This guard
 * rejects any attempt to splice cells from different immutable revisions.
 */
export function buildVerifiedStoredRsiRelease(params: {
  releaseId: string;
  viewId: string;
  storedRevisionSha256: string;
  cells: PublicRsiCell[];
}): RsiRelease {
  for (const cell of params.cells) {
    if (cell.state === 'suppressed' && ('value' in cell || cell.display !== 'No data')) {
      throw new Error('Suppressed RSI cells cannot expose a value');
    }
  }
  const releaseWithoutHash = {
    schemaVersion: '1.0' as const,
    releaseId: params.releaseId,
    viewId: params.viewId,
    state: params.cells.length === 0 || params.cells.every(cell => cell.state === 'suppressed')
      ? 'no_data' as const
      : 'released' as const,
    cells: params.cells,
  };
  const calculated = createHash('sha256').update(JSON.stringify(releaseWithoutHash)).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(params.storedRevisionSha256) || calculated !== params.storedRevisionSha256) {
    throw new Error('RSI release revision is missing or does not match');
  }
  return { ...releaseWithoutHash, revisionSha256: calculated };
}
