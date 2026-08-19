# Public dependency audit — 18 August 2026

## Result

| Workspace | Production audit result |
| --- | --- |
| Owned API | 0 vulnerabilities |
| Public website | 0 vulnerabilities |
| Mobile/Expo workspace | 0 critical; 11 high and 8 moderate npm meta-findings rooted in reviewed build/configuration tooling |

The update removed the actionable `fast-uri`, `socket.io-parser`, and `nanoid`
findings from the API, mobile client dependency graph, and website production
graph.

## Mobile build-tool exception

The remaining mobile npm report fans out through Expo, Metro, and React Native.
Its concrete advisory records are:

- `GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq` for `image-size`, used by
  Metro while processing local build images; and
- `GHSA-w5hq-g745-h8pq` for `uuid`, used by the Xcode configuration package.

The compatible `image-size` dependency has no fixed npm release as of this
audit date. Downgrading Expo/React Native to the npm audit suggestion would
replace the tested SDK/runtime with an incompatible older stack and is not an
accepted remediation.

`config/release/mobile-audit-exceptions.v1.json` therefore permits only these
three advisory IDs in public-source CI through 18 September 2026. The check
fails on a new advisory ID, a critical finding, an expired exception, or a
changed root package.

This exception does not authorize production, store submission,
survivor-facing deployment, or UNICEF submission approval. Those gates remain
separate and fail closed.
