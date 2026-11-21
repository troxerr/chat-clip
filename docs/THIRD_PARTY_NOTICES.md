# Third-party notices

ChatClip bundles or links the following components. This file is a summary; the full license texts must ship with the release.

## FFmpeg

- **Version:** 7.1.1
- **License:** LGPL v2.1 or later (built with `--disable-gpl --disable-nonfree`)
- **Why:** capture/remux, MP4 export, 9:16 reframing, VideoToolbox H.264, AAC.
- **Source:** https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz
- **Build:** `tools/build-runtime.sh` records the exact configure flags. This build does not include libx264 or other GPL components. `boxblur` is GPL-dependent in FFmpeg 7.1 and is not used; the reframe filter uses `gblur`.
- **LGPL compliance:** provide the license text, this notice, and the corresponding source/build instructions (or a written offer) with the app.

### Written source offer (FFmpeg, LGPL)

The FFmpeg libraries and binary in this app are licensed under the GNU Lesser General Public License v2.1 or later. You may obtain the complete corresponding source from <https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz>. The build recipe, including every `./configure` flag used, is `tools/build-runtime.sh` in this project. For three years after you receive a copy of the app, you may also request the source and build scripts directly from the publisher at `<SUPPORT EMAIL — fill in before release>`. You may replace the bundled FFmpeg with your own build of the same libraries; the app looks for it in `Contents/Resources/runtime/bin`. The full LGPL text must ship in the app bundle alongside this notice.

## Windows runtime (FFmpeg and Streamlink)

The Windows app bundles builds that CI downloads and verifies against pinned SHA-256 values in `tools/runtime-win.json`. This section is a working record, not legal advice; it still needs legal review before the app is sold.

### FFmpeg (Windows)

- **Build:** `ffmpeg version n7.1.5-12-g1fdbca85aa-20260731`, the BtbN `win64-lgpl` build from release `autobuild-2026-07-31-14-10`, file `ffmpeg-n7.1.5-12-g1fdbca85aa-win64-lgpl-7.1.zip`, SHA-256 `b7c1c846dacca68ee4ebf5c390742c973b3d5d14a6d44b061f500d8e4ac74fc0`.
- **Licence:** LGPL version 3 or later. The configure line below has `--enable-version3` and has neither `--enable-gpl` nor `--enable-nonfree`. (This differs from the macOS build above, which is LGPL v2.1 or later.)
- **Checked on every CI run:** `tools/verify-runtime.js` fails the build if the binary reports `--enable-gpl` or `--enable-nonfree`, contains `libx264`, `libx265` or `libxvid`, or has no usable H.264 encoder. It records the version and configure line in the job summary. The configure line below was taken from the Windows CI job log of the run for commit `27c3172`.
- **H.264 encoders it contains:** `h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_mf` (Windows Media Foundation) and `libopenh264` (software; used when no other encoder works, and proven by a CI clip made with only the bundled binaries).
- **Static build:** it is a single statically linked `ffmpeg.exe` (`--pkg-config-flags=--static`), shipped as a separate program that the app starts as its own process.

Configure line, verbatim:

```
--prefix=/ffbuild/prefix --pkg-config-flags=--static --pkg-config=pkg-config --cross-prefix=x86_64-w64-mingw32- --arch=x86_64 --target-os=mingw32 --enable-version3 --disable-debug --disable-w32threads --enable-pthreads --enable-iconv --enable-zlib --enable-libxml2 --enable-libvmaf --enable-fontconfig --enable-libharfbuzz --enable-libfreetype --enable-libfribidi --enable-vulkan --enable-libshaderc --enable-libvorbis --disable-libxcb --disable-xlib --disable-libpulse --enable-gmp --enable-lzma --disable-liblcevc-dec --enable-opencl --enable-amf --enable-libaom --enable-libaribb24 --disable-avisynth --enable-chromaprint --enable-libdav1d --disable-libdavs2 --disable-libdvdread --disable-libdvdnav --disable-libfdk-aac --enable-ffnvcodec --enable-cuda-llvm --disable-frei0r --enable-libgme --enable-libkvazaar --enable-libaribcaption --enable-libass --enable-libbluray --enable-libjxl --enable-libmp3lame --enable-libopus --enable-libplacebo --enable-librist --enable-libssh --enable-libtheora --enable-libvpx --enable-libwebp --enable-libzmq --enable-lv2 --enable-libvpl --enable-openal --enable-libopencore-amrnb --enable-libopencore-amrwb --enable-libopenh264 --enable-libopenjpeg --enable-libopenmpt --enable-librav1e --disable-librubberband --enable-schannel --enable-sdl2 --enable-libsnappy --enable-libsoxr --enable-libsrt --enable-libsvtav1 --enable-libtwolame --enable-libuavs3d --disable-libdrm --enable-vaapi --disable-libvidstab --enable-libvvenc --disable-libx264 --disable-libx265 --disable-libxavs2 --disable-libxvid --enable-libzimg --enable-libzvbi --extra-cflags=-DLIBTWOLAME_STATIC --extra-cxxflags= --extra-libs=-lgomp --extra-ldflags=-pthread --extra-ldexeflags= --cc=x86_64-w64-mingw32-gcc --cxx=x86_64-w64-mingw32-g++ --ar=x86_64-w64-mingw32-gcc-ar --ranlib=x86_64-w64-mingw32-gcc-ranlib --nm=x86_64-w64-mingw32-gcc-nm --extra-version=20260731
```

### Corresponding source and written offer

- **FFmpeg source:** commit `1fdbca85aa`, which is 12 commits after the tag `n7.1.5` (that is what `n7.1.5-12-g1fdbca85aa` means). Links to check: https://github.com/FFmpeg/FFmpeg/commit/1fdbca85aa and https://ffmpeg.org/releases/. **These links have not been checked** (the environment this was written in cannot reach those pages).
- **Build scripts and the other libraries' sources:** https://github.com/BtbN/FFmpeg-Builds at release tag `autobuild-2026-07-31-14-10`. **Not checked either.** Those scripts fetch and pin the sources of every library named in the configure line.
- **Written offer:** ChatClip will provide, to anyone who received the Windows app, the complete corresponding source of the FFmpeg it bundles, including the build scripts, for at least three years after that version was last distributed, for no more than the cost of physically performing the distribution. Contact: **[support address to be added before release; none exists yet]**.
- Ship with the app: the FFmpeg `LICENSE`/`COPYING` files (the fetch script copies the ones in the archive into `runtime/licenses`), and the licence texts of the libraries below.

### Points for the legal review

- Many third-party libraries are linked in (for example libvpx, libaom, libsvtav1, libopus, libass, libopenjpeg, libvmaf, libsrt, libssh, libplacebo, libopencore-amr, libzvbi, libmp3lame, libtwolame). Each has its own licence, and some require their notices to ship with the binary.
- Several of the codecs involved (for example AAC, HEVC, VVC, AV1) can carry patent licensing obligations that FFmpeg's licence does not remove. The app only needs H.264 and AAC output; a build with fewer codecs would reduce this.
- `libopenh264` built into FFmpeg is not covered by Cisco's patent licence for its own prebuilt binaries. Decide whether to rely on `h264_mf` and the hardware encoders only, or to accept that position.
- An LGPL v3 "installation information" duty may apply to a statically linked program; because the app only starts `ffmpeg.exe` as a separate process and ships it unmodified, replacing it should be straightforward, but this needs a lawyer's answer.
- BtbN prunes old autobuilds. If the pinned release disappears, the source offer must still be honored: keep a copy of the exact archive and the corresponding source (re-hosting them in a release of this repository would do that; not done yet).

### Streamlink (Windows)

- **Version:** 8.6.3 (`streamlink-8.6.3-1-py315-x86_64.zip`, portable build from `streamlink/windows-builds`, SHA-256 `3b1f1470d4b135080a8107ca2917379ca3ff5acadbcdc215568b79eea1450497`).
- **Licence:** BSD 2-Clause, as for the macOS build. The portable folder also carries its own Python and Python packages; their licences ship in that folder.

## Streamlink

- **Version:** 8.6.2
- **License:** BSD 2-Clause
- **Use:** resolves Twitch streams locally.

## Python

- **Version:** 3.12 (embedded by PyInstaller)
- **License:** PSF License
- **Use:** Streamlink runtime.

## PyInstaller

- **Version:** 6.14.2
- **License:** GPL v2 with a special exception that permits distribution of bundled applications.
- **Use:** builds the self-contained Streamlink executable.

## Node.js

- **Version:** bundled Node runtime (currently 24.x)
- **License:** MIT and third-party licenses included with Node.
- **Use:** recorder engine, OAuth/license helpers.

## Sparkle

- **Version:** 2.10.1
- **License:** MIT
- **Use:** auto-update and EdDSA update signature verification.

## Apple frameworks

Cocoa, Security, VideoToolbox, AudioToolbox, and other system frameworks are used under the macOS SDK terms.

## 7TV

Public emote metadata and images are fetched from `7tv.io`/`cdn.7tv.app`; no code is bundled.

## Trademarks

Twitch, TikTok, Dropbox, Google Drive, and Lemon Squeezy are trademarks of their respective owners. ChatClip is not affiliated with or endorsed by them.
