import type { Post } from "@/app/shared/types/post";
import type { RichDocument } from "@/app/shared/types/content";
import type { useArticleReader } from "../_hooks/useArticleReader";

type ReaderState = ReturnType<typeof useArticleReader>;

export type ArticleReaderProps = { post: Post; commentsEnabled?: boolean };

export type ArticleHeaderProps = Pick<
  ReaderState,
  "progress" | "isReading" | "scrollToTop" | "headerRef"
> & { title: string };

export type ArticleHeroProps = Pick<ReaderState, "copyLink" | "shareStatus"> & { post: Post };

export type ArticleBodyProps = Pick<
  ReaderState,
  "copyCode" | "contentRef" | "codeStatuses"
> & ArticleReaderProps;

export type ArticleRichContentProps = Pick<
  ReaderState,
  "copyCode" | "codeStatuses"
> & { document: RichDocument };
