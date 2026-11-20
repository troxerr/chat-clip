# Chatclip UI redesign

The native AppKit interface now prioritizes Capture, Clips, and Storage, with licensing under Settings. Capture starts at the top of the window and groups the channel input with its primary action. Decorative output artwork and the four dashboard metric cards were replaced by a session summary and recent clips.

Changes include consistent typography and control heights, adaptive neutral surfaces, a compact sidebar status, real asynchronous local-video previews, sortable clip columns, contextual file/link actions, an empty-library message, and full paths in clip details. Settings uses stateful checkboxes and hides technical actions under Advanced. Storage separates local folders from cloud destinations, offers a local folder chooser, consolidates upload retention, and tracks unsaved changes. The shorter onboarding sheet validates usernames and permission confirmation and routes cloud setup to Storage. The onboarding Start action now reads the actual sheet fields.

## Build

From the project root:

```sh
BUILD_DIR="$PWD/mac/build-redesign" zsh mac/build.sh
```

The original running app at `mac/build/Chatclip.app` was left intact because its recorder was active. The redesigned app is at `mac/build-redesign/Chatclip.app`. Switch builds after finishing the active capture; no live cloud upload or new recording is required to review the interface.

## Validation

- Native arm64 build and ad-hoc signing completed without compiler warnings.
- All 92 existing tests passed.
- Screenshots generated at 960×640 and 1240×820 in light and dark appearances; representative screens visually reviewed and corrected.
- Isolated checks passed for permission gating, valid/invalid usernames, search filtering, local/cloud visibility, unsaved destination state, and no recorder starting during setup checks.
- Populated library checks use a generated local test video, a synthetic cloud entry, and a synthetic queued entry. Live provider authentication and uploads were not part of UI validation.

`mac/build-redesign/ui-review/` contains the final snapshots and behavior-checks.json. `mac/ui-backups/before-redesign/` preserves the prior UI/controller/build files. Backend recorder files and credentials were not edited by this redesign.

For a repeatable isolated screenshot review, launch the built executable with temporary `HIGHLIGHT_DESK_CONFIG` and `HIGHLIGHT_DESK_STATE` paths, `HIGHLIGHT_DESK_KEYCHAIN=0`, `HIGHLIGHT_DESK_NOTIFICATIONS=0`, and `HIGHLIGHT_DESK_UI_REVIEW` set to the output directory. This mode exits after capturing the screens.
