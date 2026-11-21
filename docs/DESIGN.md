# ChatClip presentation review

## Design plan

- Archetype: native AppKit sidebar window for a capture utility. Keep the existing controller and recorder architecture.
- Navigation: Capture, Clips, Storage; Settings contains licensing and support.
- Feeling: confident and calm. Deep violet marks actions; lavender marks selections; content stays neutral.
- Entry points: channel input and Start Capture, Twitch past-broadcast input and Find Highlights, app menu Save Highlight.
- Empty states: Capture explains how automatic and manual highlights work. Clips offers Go to Capture, or Clear Search & Filters when a query/scope has no results.

## Command map

| Action | Menu | Shortcut |
| --- | --- | --- |
| Capture | View | Command-1 |
| Clips | View | Command-2 |
| Storage | View | Command-3 |
| Save Highlight Now | ChatClip | Command-S |
| Settings | ChatClip | Command-comma |
| Capture Monitor | ChatClip | Command-Shift-M |
| Cut / Copy / Paste / Select All | Edit | Standard Mac shortcuts |
| Undo / Redo | Edit | Command-Z / Command-Shift-Z |

Command-S saves a clip during capture; this app does not edit documents. Text-editing commands use the standard responder chain. Undo availability is supplied by the focused native control.

## Presentation changes

- Centralized violet, accent-text, selection, canvas, surface and separator colors in mac/ui/HDUI.m.
- Primary buttons retain native NSButton actions and keyboard behavior, with explicit padding and readable disabled/hover states.
- Source labels say Live Stream and Past Broadcast; capture health is named explicitly.
- Empty clip tables are replaced by a centered, actionable message. Search/filter reset returns the library to All.
- Library columns fit the minimum window, including rating buttons and complete destination badges. Dates follow the Mac locale; the exact source timestamp remains in the tooltip.
- Recent-clip titles truncate with full tooltips, and long save-folder paths truncate in the middle.
- Support actions share one group. Settings displays the main shortcuts and reads the bundle version.
- Initial windows and onboarding open without a selected text field. User-initiated source changes still focus the relevant input.
- Local destination labels and clip ratings use adaptive colors in light and dark mode. Storage destinations have accessibility names.

## Existing-app mapping

This is Objective-C/AppKit, not SwiftUI. Build with `BUILD_DIR="$PWD/mac/build-presentation" zsh mac/build.sh`. The existing `CHATCLIP_UI_REVIEW` mode captures app-owned windows and exits. Always provide temporary `CHATCLIP_CONFIG` and `CHATCLIP_STATE` paths and disable keychain and notifications for review runs.

The existing 204-point sidebar, 28-point page margins, 24-point titles and native AppKit controls are intentionally retained for compatibility. This pass improves presentation without a framework migration, custom toolbar system or recorder rewrite. Native controls use the system appearance; custom action and selection colors use the violet brand. Status colors retain their semantic meaning.

## Validation

- All 156 existing Node tests pass. JavaScript syntax checks pass.
- Native arm64 build succeeds without compiler warnings.
- Review behavior checks pass with both empty and populated temporary state: storage saving, retention visibility, permission gating, invalid usernames, search filtering, search/filter reset, empty-table visibility and VOD source visibility. No recorder starts in review mode.
- Screens reviewed in light and dark at 960×640 and 1240×820: Capture, populated Clips, Storage, License, Settings and expanded past-broadcast options. Empty Clips and onboarding also reviewed.
- Populated review uses a generated two-second local test video plus synthetic cloud and queued entries. Destination badges and rating buttons are visible at the minimum window width.
- Live recording, real cloud sign-in/uploads, and paid licensing were not exercised by this presentation review.
- Original UI/controller copies: `mac/ui-backups/before-presentation/`. No Git metadata exists in this working folder, so no commit was made.
