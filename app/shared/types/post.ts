import type { RichDocument } from "./content";

export type ArticleSection = {
  id: string;
  title: string;
  paragraphs: string[];
  code?: { language: string; value: string };
  note?: string;
};

export type Post = {
  slug: string;
  title: string;
  subtitle?: string;
  description: string;
  category: string;
  date: string;
  readingMinutes: number;
  heroImage?: {
    src: string;
    alt: string;
    width?: number;
    height?: number;
  };
  sections: ArticleSection[];
  document?: RichDocument;
};
