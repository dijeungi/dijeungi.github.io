import { notFound } from "next/navigation";

import { getHomePost } from "@/app/shared/data/published-posts";
import { ArticleReader } from "./posts/[slug]/_components/ArticleReader";

import type { Metadata } from "next";

// 최신 발행 글의 검색 메타데이터 구성
export async function generateMetadata(): Promise<Metadata> {
  const post = await getHomePost();

  return {
    title: post?.title,
    description: post?.description,
    openGraph: {
      type: "article",
      title: post?.title,
      description: post?.description,
      publishedTime: post?.date,
    },
  };
}

// 기본 주소의 글 상세 화면
export default async function ArticlePage() {
  const post = await getHomePost();

  if (!post) {
    notFound();
  }

  return <ArticleReader key={post.slug} post={post} />;
}
