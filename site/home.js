async function loadHighlight() {
  const response = await fetch('/app/data/featured.json');
  if (!response.ok) return;
  const clip = await response.json();
  if (!clip || !/^[a-z0-9_-]+$/i.test(clip.slug)) return;

  const container = document.getElementById('featured-media');
  const link = document.getElementById('featured-link');
  link.href = '/app/clips/' + encodeURIComponent(clip.id) + '/';
  link.textContent = clip.title + ' · ' + clip.streamer;

  const play = document.createElement('button');
  play.className = 'featured-play';
  play.type = 'button';
  play.setAttribute('aria-label', 'Play clip: ' + clip.title);
  const poster = document.createElement('img');
  poster.src = clip.thumbnailUrl;
  poster.alt = '';
  const label = document.createElement('span');
  label.textContent = '▶ Play clip';
  play.append(poster, label);
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
