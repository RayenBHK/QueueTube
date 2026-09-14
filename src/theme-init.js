(() => {
  const allowed = new Set(["system", "light", "dark"]);
  let theme = "system";
  try {
    const cached = localStorage.getItem("qt-theme-cache");
    if (allowed.has(cached)) theme = cached;
  } catch {
    // The default follows the operating system when storage is unavailable.
  }
  document.documentElement.dataset.theme = theme;
})();
