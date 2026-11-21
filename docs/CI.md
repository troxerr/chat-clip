# CI

`.github/workflows/build.yml` builds unsigned artifacts on both Mac architectures:

- `macos-15-intel` → x86_64 (`macos-13` was retired by GitHub)
- `macos-15` → arm64

Each job:

1. installs Node 22, Python 3.12, and FFmpeg for tests;
2. fetches Sparkle;
3. builds the LGPL FFmpeg/Streamlink runtime with `tools/build-runtime.sh`;
4. runs tests with the bundled runtime;
5. builds the app and verifies its signature/runtime/Sparkle;
6. uploads an unsigned `.zip` and `.dmg`.

The signed/notarized release is deliberately manual. Use `./mac/release.sh --check` with Apple/OAuth/Lemon/Sparkle credentials, then `./mac/release.sh`.

## Notes

- The GitHub-hosted runner labels must map to the intended architectures in your organization. Verify `uname -m` in the job log.
- `tools/build-runtime.sh` downloads and builds FFmpeg, so the job takes longer than the app compile.
- Unsigned artifacts are for QA only. They will be blocked by Gatekeeper on another Mac.
- `tools/package-unsigned.sh` can create QA zips or DMGs; DMG creation needs an unsandboxed runner with `hdiutil`.
- Never add a Sparkle private key, Lemon Squeezy secret, OAuth client secret, or Developer ID certificate to the repository. Use CI secrets and `tools/fetch-sparkle.sh`-style pinned downloads.

## Release workflow

The signed release workflow lives in the public runner repo [troxerr/chatclip-release](https://github.com/troxerr/chatclip-release) (manual dispatch with a tag; it checks out this public repo) and uploads signed, notarized builds to private R2 storage. See [RELEASE.md](RELEASE.md) for secrets and setup. `build.yml` remains the unsigned QA build.
