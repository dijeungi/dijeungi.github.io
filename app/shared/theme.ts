export type Theme = "light" | "dark";

export const themeStorageKey = "junho-tech-blog-theme";

export const themeInitScript = `(() => {
  let preference = null;
  try {
    preference = localStorage.getItem("${themeStorageKey}");
  } catch {}
  document.documentElement.dataset.theme =
    preference === "light" || preference === "dark"
      ? preference
      : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
})();`;
