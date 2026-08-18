#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { io } from 'socket.io-client';

const apiOrigin = process.env.SAFERIDE_SMOKE_API_ORIGIN ?? 'http://127.0.0.1:3333';
const apiBase = process.env.SAFERIDE_SMOKE_API_BASE ?? `${apiOrigin}/api`;
const authBase = process.env.SAFERIDE_SMOKE_AUTH_BASE ?? `${apiOrigin}/auth`;
const wsBase =
  process.env.SAFERIDE_SMOKE_WS_BASE ??
  (apiOrigin.startsWith('https://') ? apiOrigin.replace(/^https:/, 'wss:') : 'ws://127.0.0.1:3334');
const composeFile = process.env.SAFERIDE_SMOKE_COMPOSE_FILE ?? 'infra/local/docker-compose.yml';
const composeEnvFile = process.env.SAFERIDE_SMOKE_COMPOSE_ENV ?? 'infra/local/.env';

const results = [];

function pass(name, details = undefined) {
  results.push({ name, status: 'pass', details });
  console.log(`PASS ${name}${details ? `: ${details}` : ''}`);
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertNoLeak(value, forbidden, context) {
  const serialized = JSON.stringify(value);
  for (const token of forbidden) {
    if (token && serialized.includes(token)) {
      fail(`${context} leaked forbidden token: ${token}`);
    }
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    fail(`${options.method ?? 'GET'} ${url} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return body;
}

async function expectStatus(url, expectedStatus, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  assert(
    response.status === expectedStatus,
    `${options.method ?? 'GET'} ${url} returned ${response.status}, expected ${expectedStatus}`,
  );
  return response;
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function waitForSocket(socket, eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for websocket event ${eventName}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.off(eventName, onEvent);
      socket.off('connect_error', onError);
    }

    function onEvent(payload) {
      cleanup();
      resolve(payload);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    socket.on(eventName, onEvent);
    socket.on('connect_error', onError);
  });
}

function runDockerComposePostgres(args) {
  if (!existsSync(composeFile) || !existsSync(composeEnvFile)) {
    return null;
  }

  const baseArgs = ['compose', '--env-file', composeEnvFile, '-f', composeFile, 'exec', '-T', 'postgres'];
  const result = spawnSync('docker', [...baseArgs, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

function readPostgresEnv(name) {
  return runDockerComposePostgres(['printenv', name]);
}

function queryLocalAuditEvents(userId) {
  if (process.env.SAFERIDE_SMOKE_SKIP_DB_AUDIT === '1') {
    return null;
  }

  const database = readPostgresEnv('POSTGRES_DB');
  const user = readPostgresEnv('POSTGRES_USER');
  if (!database || !user) return null;

  const sql = `
    select coalesce(
      json_agg(
        json_build_object('action', action, 'metadata', metadata)
        order by created_at asc
      ),
      '[]'::json
    )
    from saferide.audit_events
    where actor_id = '${userId}'
      and action in ('evidence.signed_upload', 'case.deletion_request')
  `;
  const output = runDockerComposePostgres(['psql', '-U', user, '-d', database, '-Atc', sql]);
  if (!output) return null;
  return JSON.parse(output);
}

function queryLocalAttachment(attachmentId) {
  if (process.env.SAFERIDE_SMOKE_SKIP_DB_AUDIT === '1') {
    return null;
  }

  const database = readPostgresEnv('POSTGRES_DB');
  const user = readPostgresEnv('POSTGRES_USER');
  if (!database || !user) return null;

  const sql = `
    select json_build_object(
      'bucket_path', bucket_path,
      'metadata', metadata,
      'upload_manifest', upload_manifest,
      'owner_id', owner_id,
      'case_id', case_id,
      'draft_id', draft_id
    )
    from saferide.attachments
    where id = '${attachmentId}'
    limit 1
  `;
  const output = runDockerComposePostgres(['psql', '-U', user, '-d', database, '-Atc', sql]);
  if (!output) return null;
  return JSON.parse(output);
}

async function main() {
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `smoke+${runId}@saferide.local`;
  const password = `Smoke-${runId}-password`;
  const draftId = `smoke-draft-${runId}`;
  const originalFileName = `survivor-private-note-${runId}.jpg`;
  const evidenceBytes = Buffer.from(`SafeRide owned-stack smoke evidence ${runId}`);
  const evidenceHash = sha256(evidenceBytes);

  const health = await requestJson(`${apiOrigin}/health`);
  assert(health.ok === true && health.service === 'saferide-api', 'API health response is invalid');
  pass('api health');

  const ready = await requestJson(`${apiOrigin}/ready`);
  assert(ready.ok === true, 'API ready response is invalid');
  pass('api readiness');

  const runtime = await requestJson(`${apiBase}/config/runtime`);
  assert(runtime.features?.ownedApi === true, 'runtime config does not advertise owned API');
  assert(runtime.features?.ownedStorage === true, 'runtime config does not advertise owned storage');
  assert(runtime.features?.ownedRealtime === true, 'runtime config does not advertise owned realtime');
  assert(!JSON.stringify(runtime).toLowerCase().includes('supabase'), 'runtime config contains supabase');
  pass('owned runtime config', runtime.environment);

  const [providers, tips, legalTags] = await Promise.all([
    requestJson(`${apiBase}/providers`),
    requestJson(`${apiBase}/tips`),
    requestJson(`${apiBase}/legal-tags`),
  ]);
  assert(Array.isArray(providers.providers), 'providers response is not an array');
  assert(Array.isArray(tips.tips), 'tips response is not an array');
  assert(Array.isArray(legalTags.tags), 'legal tags response is not an array');
  pass('catalog endpoints', `${providers.providers.length}/${tips.tips.length}/${legalTags.tags.length}`);

  const session = await requestJson(`${authBase}/signup`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      data: { smoke: true, runId },
    }),
  });
  assert(session.access_token && session.user?.id, 'signup did not return a session');
  const token = session.access_token;
  const userId = session.user.id;
  pass('auth signup');

  const authUser = await requestJson(`${authBase}/user`, { headers: bearer(token) });
  assert(authUser.id === userId, 'auth user did not match signup user');
  pass('auth user lookup');

  await expectStatus(`${authBase}/recover`, 501, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  pass('password recovery unavailable by design');

  const draftPayload = {
    id: draftId,
    payload: {
      incidentType: 'harassment',
      route: 'smoke route',
      notes: 'local owned-stack smoke draft',
    },
    status: 'draft',
    lastAutosave: new Date().toISOString(),
  };
  const savedDraft = await requestJson(`${apiBase}/drafts`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify(draftPayload),
  });
  assert(savedDraft.draft?.id === draftId, 'draft create response did not include the draft id');
  const drafts = await requestJson(`${apiBase}/drafts`, { headers: bearer(token) });
  assert(drafts.drafts.some(draft => draft.id === draftId), 'draft list did not include the saved draft');
  pass('draft create and list');

  const createdCase = await requestJson(`${apiBase}/cases`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({
      draftId,
      pathway: 'owned-stack-smoke',
      summary: {
        route: 'smoke route',
        incidentType: 'harassment',
        notes: 'local owned-stack smoke case',
      },
    }),
  });
  const caseId = createdCase.case?.id;
  assert(caseId, 'case create did not return a case id');
  const caseDetail = await requestJson(`${apiBase}/cases/${caseId}`, { headers: bearer(token) });
  assert(caseDetail.case?.id === caseId, 'case detail did not return the created case');
  assert(caseDetail.events.some(event => event.event_type === 'submission'), 'case timeline is missing submission');
  pass('case create and detail');

  const forbiddenTokens = [userId, caseId, draftId, originalFileName, 'survivor-private-note'];
  const evidenceRequest = {
    fileName: 'evidence-photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: evidenceBytes.length,
    sha256: evidenceHash,
    retention: { policy: 'local-smoke' },
    metadata: {
      displayName: 'Photo evidence',
      mediaType: 'image/jpeg',
    },
  };
  assertNoLeak(evidenceRequest, [originalFileName, 'sourceDraftId', 'originalFileName'], 'evidence request');

  const signedUpload = await requestJson(`${apiBase}/cases/${caseId}/evidence`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify(evidenceRequest),
  });
  const attachment = signedUpload.attachment;
  assert(attachment?.id && signedUpload.upload?.url, 'signed upload did not return attachment and upload url');
  assert(!('bucket_path' in attachment), 'public attachment leaked bucket_path');
  assert(!('bucket' in attachment), 'public attachment leaked bucket');
  assert(!('owner_id' in attachment), 'public attachment leaked owner_id');
  assert(!('draft_id' in attachment), 'public attachment leaked draft_id');
  assert(!('upload_manifest' in attachment), 'public attachment leaked upload manifest');
  assert(!('sha256' in attachment), 'public attachment leaked stored checksum');
  assertNoLeak(attachment.metadata ?? {}, [originalFileName, draftId, 'sourceDraftId', 'originalFileName'], 'attachment metadata');
  pass('evidence signed upload and public metadata minimization');

  const localAttachment = queryLocalAttachment(attachment.id);
  if (localAttachment) {
    assert(/^evidence\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(localAttachment.bucket_path), 'stored bucket path is not opaque');
    assertNoLeak(localAttachment.bucket_path, forbiddenTokens, 'stored bucket path');
    assertNoLeak(localAttachment.metadata ?? {}, [originalFileName, draftId, 'sourceDraftId', 'originalFileName'], 'stored attachment metadata');
    assertNoLeak(
      localAttachment.upload_manifest ?? {},
      [originalFileName, draftId, 'sourceDraftId', 'originalFileName'],
      'stored upload manifest',
    );
    pass('local stored evidence object key minimization');
  } else {
    pass('local stored evidence object key minimization skipped', 'docker postgres query unavailable');
  }

  const uploadOrigin = new URL(signedUpload.upload.url).origin;
  let uploadResponse;
  try {
    uploadResponse = await fetch(signedUpload.upload.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: evidenceBytes,
    });
  } catch (error) {
    fail(
      `presigned upload request to ${uploadOrigin} failed: ${error.message}. ` +
        'For local smoke, make sure LOCAL_PUBLIC_HOST points at a reachable host before recreating the API container.',
    );
  }
  assert(uploadResponse.ok, `presigned upload failed with ${uploadResponse.status}`);
  pass('evidence object upload');

  const completed = await requestJson(`${apiBase}/cases/${caseId}/evidence/${attachment.id}/complete`, {
    method: 'POST',
    headers: bearer(token),
  });
  assert(completed.attachment?.status === 'uploaded', 'completed evidence status is not uploaded');
  assert(completed.attachment?.size_bytes === evidenceBytes.length, 'completed evidence size mismatch');
  pass('evidence complete status and size verification');

  const download = await requestJson(`${apiBase}/cases/${caseId}/evidence/${attachment.id}/download`, {
    headers: bearer(token),
  });
  const downloadOrigin = new URL(download.url).origin;
  let downloaded;
  try {
    downloaded = await fetch(download.url);
  } catch (error) {
    fail(
      `presigned download request to ${downloadOrigin} failed: ${error.message}. ` +
        'For local smoke, make sure LOCAL_PUBLIC_HOST points at a reachable host before recreating the API container.',
    );
  }
  assert(downloaded.ok, `presigned download failed with ${downloaded.status}`);
  const downloadedBytes = Buffer.from(await downloaded.arrayBuffer());
  assert(downloadedBytes.equals(evidenceBytes), 'downloaded evidence bytes did not match uploaded bytes');
  pass('evidence download byte match');

  const deletionRequest = await requestJson(`${apiBase}/cases/${caseId}/deletion-request`, {
    method: 'POST',
    headers: bearer(token),
  });
  assert(deletionRequest.deletionRequest?.status === 'requested', 'deletion request did not return requested');
  assert(deletionRequest.deletionRequest?.event?.event_type === 'deletion_requested', 'deletion event type mismatch');
  const afterDeletionRequest = await requestJson(`${apiBase}/cases/${caseId}`, { headers: bearer(token) });
  assert(afterDeletionRequest.case?.id === caseId, 'case disappeared after deletion request');
  assert(
    afterDeletionRequest.attachments.some(item => item.id === attachment.id && item.status === 'uploaded'),
    'evidence disappeared after deletion request',
  );
  assert(
    afterDeletionRequest.events.some(event => event.event_type === 'deletion_requested'),
    'case timeline is missing deletion_requested event',
  );
  pass('deletion request records event without deleting evidence');

  const auditEvents = queryLocalAuditEvents(userId);
  if (auditEvents) {
    const signedAudit = auditEvents.find(event => event.action === 'evidence.signed_upload');
    const deletionAudit = auditEvents.find(event => event.action === 'case.deletion_request');
    assert(signedAudit, 'local audit query is missing evidence.signed_upload');
    assert(deletionAudit, 'local audit query is missing case.deletion_request');
    assertNoLeak(signedAudit.metadata ?? {}, [attachment.bucket_path, originalFileName, draftId], 'signed-upload audit metadata');
    assert(signedAudit.metadata?.caseId === caseId, 'signed-upload audit metadata is missing case correlation');
    assert(signedAudit.metadata?.uploadStatus === 'signed', 'signed-upload audit metadata status mismatch');
    assert(deletionAudit.metadata?.status === 'requested', 'deletion-request audit metadata status mismatch');
    pass('local audit metadata minimization');
  } else {
    pass('local audit metadata minimization skipped', 'docker postgres query unavailable');
  }

  const chatSession = await requestJson(`${apiBase}/chat/sessions`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({ mode: 'legal-aid' }),
  });
  const sessionId = chatSession.session?.id;
  assert(sessionId, 'chat session create did not return a session id');

  const socket = io(wsBase, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
  });
  await waitForSocket(socket, 'connect');
  socket.emit('chat:join', { sessionId });

  const messagePromise = waitForSocket(socket, 'chat:message');
  const chatMessage = await requestJson(`${apiBase}/chat/message`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({
      sessionId,
      mode: 'legal-aid',
      role: 'user',
      content: `owned-stack smoke chat ${runId}`,
    }),
  });
  const realtimeMessage = await messagePromise;
  socket.disconnect();
  assert(realtimeMessage?.id === chatMessage.message?.id, 'websocket chat fanout did not match REST message');
  const messages = await requestJson(`${apiBase}/chat/session/${sessionId}/messages`, {
    headers: bearer(token),
  });
  assert(messages.messages.some(message => message.id === chatMessage.message.id), 'chat message list is missing message');
  pass('chat REST and websocket fanout');

  console.log(
    JSON.stringify(
      {
        status: 'pass',
        branchExpectation: 'run on top-of-stack review branch',
        apiOrigin,
        apiBase,
        authBase,
        wsBase,
        checks: results,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
