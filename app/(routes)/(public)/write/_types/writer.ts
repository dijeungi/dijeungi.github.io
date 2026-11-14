import type { usePostWriter } from "../_hooks/usePostWriter";
import type { BlogDocument } from "@/app/shared/types/content";

export type WriterConnection = "loading" | "ready" | "unavailable";

export type WriterIconName = "bold" | "italic" | "strike" | "link" | "bullets" | "numbers" | "code" | "image" | "undo" | "redo" | "back" | "check" | "plus" | "eye" | "upload";

export type DraftSummary = Pick<BlogDocument, "id" | "title" | "slug" | "updatedAt">;

export type WriterImage = Required<NonNullable<BlogDocument["heroImage"]>>;

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

type PostWriterState = ReturnType<typeof usePostWriter>;

export type WriterToolbarProps = Pick<
  PostWriterState,
  "editor" | "selection" | "busy" | "uploading" | "editLink" | "uploadInlineImage"
>;
