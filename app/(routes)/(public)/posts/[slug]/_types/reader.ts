import type { Post } from "@/app/shared/data/posts";
import type { RichDocument } from "@/app/shared/types/content";
import type { useArticleReader } from "../_hooks/useArticleReader";

type ReaderState = ReturnType<typeof useArticleReader>;

export type ArticleReaderProps = { post: Post; commentsEnabled?: boolean };

export type ArticleHeaderProps = Pick<
  ReaderState,
  "progress" | "isReading" | "copyLink" | "scrollToTop" | "headerRef" | "shareStatus"
> & { title: string };

export type ArticleBodyProps = Pick<
  ReaderState,
  "copyCode" | "contentRef" | "codeStatuses"
> & ArticleReaderProps;

export type ArticleRichContentProps = Pick<
  ReaderState,
  "copyCode" | "codeStatuses"
> & { document: RichDocument };
