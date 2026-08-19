# Reproducible builds and release provenance

SafeRide publishes a deterministic source archive for each open-source tag.
The archive is generated from Git-tracked files at the exact tagged commit,
with a stable prefix and Git-controlled timestamps.

## Reproduce a source archive

```bash
npm ci
npm run public:repository:check
npm run public:source-bundle -- --ref v0.5.8-open-source.1 --out dist/repro-a
npm run public:source-bundle -- --ref v0.5.8-open-source.1 --out dist/repro-b
shasum -a 256 dist/repro-a/*.tar dist/repro-b/*.tar
```

The two `.tar` hashes must match. Each output includes:

- the deterministic source `.tar`;
- `SHA256SUMS.txt`; and
- `reproducible-source-build.json` containing the exact commit, commit time,
  archive command, tool versions, byte size, and SHA-256.

GitHub release automation repeats the archive twice, compares the hashes, and
uploads the archive, checksum, and provenance record to the tag.

## Android artifacts

Android APK/AAB reproducibility is recorded separately because signing and
remote build environments can introduce controlled differences. A release must
publish the source commit, build profile, toolchain, model manifest/checksum,
artifact SHA-256, signing identity fingerprint (never the key), and clean/
upgrade test result. Public users verify the tested APK through the checksum on
`https://saferide.esheria.org/download/`.

No key, keystore, credential, private AAB, or production build environment is
placed in the public repository.
