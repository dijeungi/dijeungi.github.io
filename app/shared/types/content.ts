export type RichMark = {
  type: "bold" | "italic" | "underline" | "strike" | "code" | "link";
  attrs?: { href: string };
};

export type RichNode = {
  type: "doc" | "paragraph" | "heading" | "text" | "bulletList" | "orderedList" | "listItem" | "blockquote" | "codeBlock" | "hardBreak" | "horizontalRule" | "image";
  text?: string;
  marks?: RichMark[];
  content?: RichNode[];
  attrs?: {
    src?: string;
    alt?: string;
    title?: string | null;
    level?: number;
    start?: number;
    width?: number;
    height?: number;
    language?: string | null;
  };
};

export type RichDocument = { type: "doc"; content: RichNode[] };

export type BlogDocument = {
  version: 1;
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  description: string;
  category: string;
  date: string;
  readingMinutes: number;
  updatedAt: string;
  content: RichDocument;
  heroImage?: { src: string; alt: string; width?: number; height?: number };
};

export type ParseBlogDocumentOptions = { publish?: boolean };
