export type Theme = "light" | "dark";

export const themeStorageKey = "junho-tech-blog-theme";
export const systemThemeQuery = "(prefers-color-scheme: dark)";

export const themeInitScript = `(() => {
  let preference = null;
  try {
    preference = localStorage.getItem("${themeStorageKey}");
  } catch {}
  document.documentElement.dataset.theme =
    preference === "light" || preference === "dark"
      ? preference
      : matchMedia("${systemThemeQuery}").matches ? "dark" : "light";
})();`;
