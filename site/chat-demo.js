document.querySelectorAll("[data-chat-demo]").forEach((demo) => {
  const bars = demo.querySelector("[data-bars]");
  const status = demo.querySelector("[data-demo-status]");
  const progress = demo.querySelector("progress");
  const preview = demo.querySelector("video");
  const placeholder = demo.querySelector("[data-preview-placeholder]");
  const controls = demo.querySelector("[data-demo-controls]");
  const buttons = controls.querySelectorAll("button");
  const threshold = 24;
  const chartMax = 40;
  const history = [8, 11, 9, 13, 7, 11, 15, 10, 12, 8, 10, 9];
  let timer;

  demo.querySelector(".thr").style.bottom = `${threshold / chartMax * 100}%`;
  controls.hidden = false;

  function draw(values, trigger = -1) {
    bars.replaceChildren(...values.map((value, index) => {
      const bar = document.createElement("span");
      bar.style.height = `${value / chartMax * 100}%`;
      if (index === trigger) bar.className = "trig";
      else if (trigger >= 0 && index >= trigger - 3) bar.className = "clip";
      return bar;
    }));
  }

  function run(kind) {
    if (timer !== undefined) return;

    const isRaid = kind === "raid";
    const count = isRaid ? 16 : 36;
    const trigger = history.length;
    const values = [...history, count];
    const startedAt = performance.now();

    for (const button of buttons) button.setAttribute("aria-disabled", "true");
    preview.pause();
    const previewHadFocus = document.activeElement === preview;
    preview.hidden = true;
    if (previewHadFocus) buttons[0].focus();
    placeholder.hidden = false;
    placeholder.textContent = "Capturing sample…";
    const message = isRaid
      ? `Raid detected with ${count} chatters, below the ${threshold}-chatter threshold.`
      : `${count} chatters crossed the ${threshold}-chatter threshold.`;
    status.textContent = `${message} Capturing 15 more seconds.`;
    progress.value = 15;
    draw(values, trigger);

    const tail = isRaid ? [18, 14, 10] : [30, 21, 14];
    timer = setInterval(() => {
      const elapsed = Math.min(15, (performance.now() - startedAt) / 1000);
      progress.value = 15 + elapsed;
      const windows = Math.floor(elapsed / 5);
      if (values.length !== trigger + 1 + windows) {
        values.push(...tail.slice(values.length - trigger - 1, windows));
        draw(values, trigger);
      }
      if (elapsed < 15) return;

      clearInterval(timer);
      timer = undefined;
      for (const button of buttons) button.setAttribute("aria-disabled", "false");
      preview.src = "/media/sample-highlight.mp4";
      preview.hidden = false;
      placeholder.hidden = true;
      status.textContent = "30-second capture complete. Play the 9:16 sample preview.";
    }, 200);
  }

  preview.addEventListener("error", () => {
    preview.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = "Sample preview unavailable";
    status.textContent = "The capture simulation finished, but the sample video could not load.";
  });
  for (const button of buttons) button.addEventListener("click", () => run(button.dataset.trigger));
  draw(history);
});
