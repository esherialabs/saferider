# API Contracts

All protected endpoints require:

```text
Authorization: Bearer <local auth-jwt>
```

Errors return:

```json
{
  "code": "bad_request",
  "message": "Invalid request",
  "requestId": "..."
}
```

## Drafts

- `GET /api/drafts`
- `GET /api/drafts/:id`
- `POST /api/drafts`
- `DELETE /api/drafts/:id`

`POST /api/drafts` accepts:

```json
{
  "id": "local-draft-id",
  "payload": {},
  "status": "draft",
  "lastAutosave": "2026-05-28T00:00:00.000Z"
}
```

## Cases

- `POST /api/cases`
- `GET /api/cases/:id`
- `POST /api/cases/:id/evidence`
- `POST /api/cases/:caseId/evidence/:attachmentId/complete`

Mobile drafts may persist retry metadata after a partial evidence upload failure:

```json
{
  "caseId": "owned-api-case-id",
  "caseSubmissionError": "One evidence item did not upload. The report is queued for retry.",
  "mediaFiles": [
    {
      "id": "local-media-id",
      "uploadStatus": "failed",
      "uploadError": "privacy-safe reason",
      "attachmentId": "owned-api-attachment-id-if-completed"
    }
  ]
}
```

Retries reuse `caseId` instead of creating a duplicate case and only upload evidence that is not already marked uploaded with a storage path.

## Mobile Offline Replay Queue

The mobile client stores replay work locally under `@sync_queue`. Queue entries are not remote API payloads, but release QA and support tooling should treat these fields as the retained local recovery contract:

```json
{
  "id": "submit_...",
  "type": "submit",
  "data": { "draftId": "local-draft-id", "pathway": "referral" },
  "retryCount": 1,
  "maxRetries": 3,
  "lastError": "privacy-safe reason",
  "blockedReason": "auth_required | max_retries | retry_pending",
  "blockedAt": "2026-06-06T00:00:00.000Z"
}
```

`auth_required` signs the user out but keeps the queue item. `max_retries` pauses automatic replay until the user manually retries. `retry_pending` keeps local data visible after a recoverable failed attempt.

## Chat

- `POST /api/chat/message`
- `GET /api/chat/session/:id/messages`
- `WS /chat/session/:id` will be implemented through Socket.IO room `chat:<sessionId>`.

## Catalog

- `GET /api/providers`
- `GET /api/tips`
- `GET /api/legal-tags`

## Runtime Config

- `GET /api/config/runtime`

The mobile runtime config store can use this endpoint to switch local/staging/production endpoints without an app rebuild.
