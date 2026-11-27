async function loadHighlight() {
  const response = await fetch('/app/data/featured.json');
  if (!response.ok) return;
  const clip = await response.json();
  if (!clip || clip.mature || typeof clip.slug !== 'string' || !/^[a-z0-9_-]+$/i.test(clip.slug)) return;

  const container = document.getElementById('featured-media');
  const link = document.getElementById('featured-link');
  link.href = '/app/clips/' + encodeURIComponent(clip.id) + '/';
  link.textContent = clip.title;
  link.hidden = false;
  document.getElementById('featured-fallback').hidden = true;

  document.getElementById('featured-streamer').textContent = clip.streamer;
  document.getElementById('featured-game').textContent = clip.game;
  const timestamp = document.getElementById('featured-time');
  const createdAt = new Date(clip.createdAt);
  if (Number.isFinite(createdAt.getTime())) {
    timestamp.dateTime = createdAt.toISOString();
    timestamp.textContent = new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(createdAt);
    timestamp.hidden = false;
  }
  document.getElementById('featured-meta').hidden = false;

  const play = document.createElement('button');
  play.className = 'featured-play';
  play.type = 'button';
  play.setAttribute('aria-label', 'Play clip: ' + clip.title);
  const poster = document.createElement('img');
  poster.src = clip.thumbnailUrl;
  poster.alt = '';
  const label = document.createElement('span');
  label.className = 'featured-play-label';
  label.textContent = 'Play clip';
  play.append(poster, label);
  if (Number.isFinite(clip.duration) && clip.duration > 0) {
    const duration = document.createElement('span');
    duration.className = 'featured-duration';
    const seconds = Math.round(clip.duration);
    duration.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    play.append(duration);
  }
  play.addEventListener('click', () => {
    const query = new URLSearchParams({ clip: clip.slug, parent: location.hostname, autoplay: 'true' });
    const player = document.createElement('iframe');
    player.src = 'https://clips.twitch.tv/embed?' + query;
    player.title = clip.title;
    player.allow = 'autoplay; fullscreen';
    player.allowFullscreen = true;
    play.replaceWith(player);
    player.focus();
    window.clipSpikeTrack?.('homepage_clip_play');
  });
  container.replaceChildren(play);
  container.hidden = false;
}

void loadHighlight().catch(() => {});
