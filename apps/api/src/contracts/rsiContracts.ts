import { z } from 'zod';

const controlVersion = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._:-]+$/);

export const rsiAreaSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('coarse_cell'), id: z.string().regex(/^cell-\d+-\d+$/) }).strict(),
  z.object({ type: z.literal('corridor'), id: z.string().regex(/^corridor-[a-z0-9-]+$/) }).strict(),
]);

/**
 * The only anonymous signal shape accepted by the API. Keep this contract in
 * the contracts layer so case and RSI routes cannot drift into different
 * representations of the same privacy-sensitive payload.
 */
export const rsiSignalSchema = z.object({
  schemaVersion: z.literal('1.0'),
  configVersion: controlVersion,
  policyVersion: controlVersion,
  consentVersion: controlVersion,
  area: rsiAreaSchema,
  timeBucket: z.string().datetime(),
  category: z.string().regex(/^[a-z0-9_]+$/).max(64),
}).strict();

export const rsiAggregateConsentSchema = z.object({
  recordId: z.string().uuid(),
  purpose: z.literal('anonymous_aggregate'),
  version: controlVersion,
}).strict();

export const rsiSignalSubmissionSchema = z.object({
  consent: rsiAggregateConsentSchema,
  ingestionId: z.string().uuid(),
  signal: rsiSignalSchema,
}).strict();

export const rsiSignalBatchSchema = z.object({
  consent: rsiAggregateConsentSchema,
  ingestionId: z.string().uuid(),
  signals: z.array(rsiSignalSchema).min(1).max(8),
}).strict().superRefine((batch, ctx) => {
  const seen = new Set<string>();
  for (const [index, signal] of batch.signals.entries()) {
    const key = `${signal.area.type}|${signal.area.id}|${signal.timeBucket}|${signal.category}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signals', index],
        message: 'duplicate minimized signal dimension',
      });
    }
    seen.add(key);
  }
});

export type RsiSignalInput = z.infer<typeof rsiSignalSchema>;
