#!/bin/zsh
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/ffmpeg-full/bin:$PATH"
if ! command -v node >/dev/null && [[ -s "$HOME/.nvm/nvm.sh" ]]; then source "$HOME/.nvm/nvm.sh"; fi
for tool in node streamlink ffmpeg; do
  if ! command -v "$tool" >/dev/null; then echo "Install $tool before starting."; read -k 1; exit 1; fi
done
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "ChatClip requires Node 22 or newer (found $(node --version))."
  read -k 1
  exit 1
fi
read 'streamer?Twitch username: '
exec caffeinate -i node background.cjs "$streamer"
