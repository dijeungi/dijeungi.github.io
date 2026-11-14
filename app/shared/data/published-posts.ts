import { join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

import { parseBlogDocument, toArticlePost } from "../lib/content";

import type { Post } from "../types/post";
import type { BlogDocument } from "../types/content";

// 로컬 발행 글 목록 읽기
async function readPublishedDocuments(): Promise<BlogDocument[]> {
  const directory = join(process.cwd(), "content", "posts");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const documents: BlogDocument[] = [];
  for (const entry of entries.filter((item) => item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      if (!entry.isFile()) throw new Error("발행 글은 일반 JSON 파일이어야 합니다.");
      const filename = join(directory, entry.name);
      if ((await stat(filename)).size > 2_000_000) throw new Error("발행 글 파일이 너무 큽니다.");
      const document = parseBlogDocument(JSON.parse(await readFile(filename, "utf8")), { publish: true });
      const slug = document.slug.normalize("NFC");
      if (entry.name.normalize("NFC") !== slug + ".json") throw new Error("파일 이름과 글 주소가 다릅니다.");
      if (slugs.has(slug) || ids.has(document.id)) throw new Error("글 주소나 식별자가 중복되었습니다.");
      slugs.add(slug);
      ids.add(document.id);
      documents.push(document);
    } catch (error) {
      throw new Error("발행 글을 읽지 못했습니다: " + entry.name, { cause: error });
    }
  }
  return documents.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt) || a.slug.localeCompare(b.slug));
}

// 실제 발행 파일에서 글 목록 구성
export async function getAllPosts(): Promise<Post[]> {
  const documents = await readPublishedDocuments();
  return documents.map(toArticlePost);
}

// 글 주소 기준 발행 본문 조회
export async function getPostBySlug(slug: string): Promise<Post | undefined> {
  let normalizedSlug: string;
  try {
    normalizedSlug = decodeURIComponent(slug).normalize("NFC");
  } catch {
    return undefined;
  }
  return (await getAllPosts()).find((post) => post.slug.normalize("NFC") === normalizedSlug);
}
