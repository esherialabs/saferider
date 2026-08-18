import { closeDb } from '../plugins/db.js';
import { executeApprovedRsiRetention } from '../services/rsiRetentionService.js';

try {
  const result = await executeApprovedRsiRetention();
  process.stdout.write(`RSI retention completed; expired minimized rows deleted: ${result.deletedCount}\n`);
} catch {
  process.stderr.write('RSI retention failed closed; no approval-dependent success is claimed\n');
  process.exitCode = 1;
} finally {
  await closeDb();
}
