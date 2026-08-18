# Storage Flow

## Target Upload Flow

```text
Expo app
  -> POST /api/cases/:id/evidence
  -> API validates MIME, size, ownership, and retention metadata
  -> API returns MinIO signed PUT URL
  -> Expo uploads directly to MinIO
  -> POST /api/cases/:caseId/evidence/:attachmentId/complete
  -> API hashes object and commits metadata
```

## Implemented Scaffold

- Size validation capped at 100 MB.
- MIME type is required.
- Upload manifests are stored with attachment metadata.
- SHA-256 hash verification runs after upload completion.
- Antivirus integration is represented by `antivirus_status` and remains a placeholder hook.
- Signed upload URLs expire after 5 minutes.

## Security Notes

Clients do not receive arbitrary bucket access. They receive a short-lived object-specific signed URL after API authorization.

## Current Mobile Path

Mobile case submissions request object-specific signed upload URLs from the API, upload evidence to MinIO/S3-compatible storage, then call the completion endpoint so the API can hash and finalize metadata.
