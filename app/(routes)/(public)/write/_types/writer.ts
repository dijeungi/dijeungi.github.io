import type { usePostWriter } from "../_hooks/usePostWriter";
import type { BlogDocument, RichDocument } from "@/app/shared/types/content";

export type WriterConnection = "loading" | "ready" | "unavailable";

export type WriterIconName = "bold" | "italic" | "strike" | "link" | "bullets" | "numbers" | "code" | "image" | "undo" | "redo" | "back" | "check" | "plus";

export type DraftSummary = Pick<BlogDocument, "id" | "title" | "slug" | "updatedAt"> & { isLocalDraft?: boolean };

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

export type MarkdownFormat = "heading1" | "heading2" | "heading3" | "bold" | "italic" | "strike" | "link" | "bullets" | "numbers" | "quote" | "code";

export type MarkdownEdit = { value: string; start: number; end: number };

export type MarkdownSnapshot = MarkdownEdit & { content: RichDocument };

export type WriterConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
};

export type WriterPreviewProps = { draft: BlogDocument | null };

export type WriterDraftListProps = Pick<
  PostWriterState,
  "draft" | "drafts" | "busy" | "saving" | "uploading" | "deletingId" | "loadDraft" | "deleteDraft" | "setDraftsOpen"
>;

export type WriterToolbarProps = Pick<
  PostWriterState,
  "busy" | "uploading" | "insertMarkdown" | "uploadInlineImage" | "undo" | "redo" | "canUndo" | "canRedo"
>;
