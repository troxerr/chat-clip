(function () {
  const consentKey = 'clipspike:consent';
  const config = fetch('/analytics-config.json').then((response) => response.ok ? response.json() : null).catch(() => null);

  function readConsent() {
    try {
      const consent = JSON.parse(localStorage.getItem(consentKey) || 'null');
      return consent?.v === 1 ? consent : null;
    } catch {
      return null;
    }
  }

  function init(analytics) {
    if (!analytics || window.plausible) return;
    window.plausible = (...args) => (window.plausible.q ||= []).push(args);
    const script = document.createElement('script');
    script.defer = true;
    script.src = analytics.src;
    script.dataset.domain = analytics.domain;
    document.head.append(script);
  }

  window.clipSpikeTrack = (name, props) => {
    if (readConsent()?.analytics === true) window.plausible?.(name, { props });
  };

  config.then((analytics) => {
    if (analytics?.provider !== 'plausible') return;
    const consent = readConsent();
    if (consent) {
      if (consent.analytics) init(analytics);
      return;
    }

    const banner = document.createElement('aside');
    banner.className = 'site-consent wrap';
    banner.setAttribute('aria-label', 'Analytics preferences');
    const copy = document.createElement('p');
    copy.textContent = 'Allow anonymous analytics to help improve ClipSpike?';
    banner.append(copy);
    for (const [label, allow] of [['Allow analytics', true], ['Decline', false]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = allow ? 'btn small primary' : 'btn small';
      button.textContent = label;
      button.addEventListener('click', () => {
        try {
          localStorage.setItem(consentKey, JSON.stringify({ v: 1, ads: false, analytics: allow }));
          if (allow) init(analytics);
        } catch {
          // Storage is unavailable, so no analytics are enabled.
        }
        banner.remove();
      });
      banner.append(button);
    }
    document.querySelector('footer')?.before(banner);
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('[data-download]');
    if (link) {
      const creatorReferral = document.referrer === location.origin + '/capture.html';
      window.clipSpikeTrack('windows_download', { installer: link.dataset.download, entry: creatorReferral ? 'creator' : 'direct' });
    }
  });
})();
