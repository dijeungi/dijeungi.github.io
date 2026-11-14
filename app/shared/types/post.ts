import type { BlogDocument } from "./content";

export type Post = Pick<
  BlogDocument,
  "slug" | "title" | "subtitle" | "description" | "category" | "date" | "readingMinutes" | "heroImage"
> & {
  document: BlogDocument["content"];
};
