import type { Post } from "@/app/shared/data/posts";

export type HomePost = Pick<
  Post,
  "slug" | "title" | "description" | "category" | "date" | "readingMinutes" | "heroImage"
>;

export type HomePageProps = { posts: HomePost[] };

export type HomeCategory = { name: string; count: number };

export type HomeSelection = { category: string | null; page: number };
