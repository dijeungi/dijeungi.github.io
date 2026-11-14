import type { BlogDocument } from "@/app/shared/types/content";
import type { usePostWriter } from "../_hooks/usePostWriter";

export type WriterConnection = "loading" | "ready" | "unavailable";

export type WriterIconName = "bold" | "italic" | "strike" | "link" | "bullets" | "numbers" | "code" | "image" | "undo" | "redo" | "back" | "close" | "check" | "plus" | "eye" | "upload";

export type DraftSummary = Pick<BlogDocument, "id" | "title" | "slug" | "updatedAt">;

export type WriterImage = NonNullable<BlogDocument["heroImage"]>;

export type PublishResult = {
  draft: BlogDocument;
  slug: string;
  url: string;
  commit: string;
  pushed: boolean;
};

export type WriterErrorResponse = {
  error?: string;
  code?: string;
  commit?: string;
};

export type WriterBackup = {
  draft: BlogDocument;
  dirty: boolean;
};

export type PostWriterState = ReturnType<typeof usePostWriter>;

export type WriterToolbarProps = Pick<
  PostWriterState,
  "editor" | "selection" | "busy" | "uploading" | "editLink" | "uploadInlineImage"
>;
