import { join } from "node:path";
import { mkdir, readdir, writeFile } from "node:fs/promises";

import { SLUG_PATTERN } from "../app/shared/lib/content.ts";
import { siteUrl } from "../app/shared/constants/site.ts";
import { canonicalPostSlug, postPath } from "../app/shared/lib/post-urls.ts";

const postsDirectory = join("out", "posts");
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const entries = await readdir(postsDirectory, { withFileTypes: true }).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const stem = entry.name.slice(0, -".html".length);
  const slug = decodeURIComponent(stem);
  if (!SLUG_PATTERN.test(slug)) continue;

  const target = new URL(basePath + postPath(canonicalPostSlug(slug)), siteUrl).href;
  const directory = join(postsDirectory, stem);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>게시글 주소 이동</title>
<link rel="canonical" href="${target}">
<meta http-equiv="refresh" content="0;url=${target}">
</head>
<body><a href="${target}">게시글로 이동</a></body>
</html>
`);
}
