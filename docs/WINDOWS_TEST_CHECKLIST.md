# Windows manual test checklist and release notes

Use for every Windows release candidate, on a clean Windows 10/11 machine or VM with a standard
(non-admin) user, no Node, FFmpeg or Streamlink installed, and no earlier ClipSpike. CI covers the
simulated chat-spike clip for the installer and Portable builds; this list covers what CI cannot.

Build under test: version ____ (`win/package.json`), signed: yes / no.

## 1. Download and hash
- [ ] Download both `ClipSpike-<version>-x64.exe` and `ClipSpike-<version>-x64-portable.exe` from the public URL or draft release (not the build folder).
- [ ] `Get-FileHash .\<file> -Algorithm SHA256` and record it next to the release notes. For auto-update, check the `sha512` in `latest.yml` matches the hosted installer.
- [ ] `Get-AuthenticodeSignature .\<file>`: `Valid` and the expected publisher if signed; `NotSigned` is expected otherwise.
- [ ] Note the SmartScreen result (signed: none or reputation warning; unsigned: "Unknown publisher", More info, Run anyway).

## 2. Clean-machine install (installer)
- [ ] Install as the non-admin user (no UAC prompt; per-user install). App opens, no missing-DLL or runtime errors.
- [ ] Settings shows the bundled FFmpeg/Streamlink working; no external tools needed.
- [ ] Start Menu entry and uninstall entry say "ClipSpike".

## 3. Portable
- [ ] Run the Portable exe from `Downloads` and from a path with a space, as a non-admin user. It opens without installing.
- [ ] Data is written to `%APPDATA%\ClipSpike`; nothing new appears next to the exe.
- [ ] No auto-update attempt (diagnostic log has no `[updater]` activity); upgrading means replacing the file.
- [ ] Windows Defender/SmartScreen behaviour noted.

## 4. Live Twitch
- [ ] Start capture on a real live channel; the buffer fills and a chat spike (or manual hotkey/button) produces a clip.
- [ ] The clip plays, is 1080x1920 with audio, and opens from the Clips page.
- [ ] Stop capture cleanly; relaunch and confirm settings and clips persist.
- [ ] Test with a game or streaming app running; CPU stays acceptable (exports run below normal priority).

## 5. Upgrade over an existing install
- [ ] Install the previous release, make a clip, change a setting, activate or start a trial.
- [ ] Install the new build over it (or let the updater do it: launch the old build, it installs on quit; see `CLIPSPIKE_NO_UPDATE=1`).
- [ ] After relaunch: new version shown, settings, license/trial and existing clips intact.
- [ ] A pre-rename ChatClip/Highlight Desk profile, if available, is migrated to `ClipSpike` and the old data is left in place.

## 6. Uninstall keeps clips
- [ ] Uninstall from Settings, Apps. The app and its shortcuts are removed.
- [ ] Saved clips are still in the clips folder, and `%APPDATA%\ClipSpike` (settings, license) is still present (`deleteAppDataOnUninstall: false`).
- [ ] Reinstall: previous settings and clips are picked up.

## Release notes template
```
ClipSpike for Windows <version>
- Installer: ClipSpike-<version>-x64.exe  (SHA256: ...)
- Portable:  ClipSpike-<version>-x64-portable.exe  (SHA256: ...)
- Signed: yes/no. Unsigned builds show a SmartScreen "Unknown publisher" warning (More info, Run anyway).
- Portable does not auto-update; replace the exe to upgrade.
- Data lives in %APPDATA%\ClipSpike and is kept on uninstall.
- Known issues / changes: ...
```
