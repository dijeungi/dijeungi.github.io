import { notFound } from "next/navigation";

import { ArticleReader } from "./_components/ArticleReader";
import { WriteButton } from "../../write/_components/WriteButton";
import { siteName, siteUrl } from "@/app/shared/constants/site";
import { getFirstContentImage } from "@/app/shared/lib/content";
import { postPath, postSlugMigrations } from "@/app/shared/lib/post-urls";
import { getAllPosts, getPostBySlug } from "@/app/shared/data/published-posts";

import type { Metadata } from "next";

export const dynamicParams = false;

// 정적 게시글 주소 목록 생성
export async function generateStaticParams() {
  const posts = await getAllPosts();
  const slugs = new Set(posts.map((post) => post.slug));

  for (const { previous, current } of postSlugMigrations) {
    if (slugs.has(current)) slugs.add(previous);
  }

  return Array.from(slugs, (slug) => ({ slug }));
}

// 게시글별 검색 및 링크 공유 메타데이터 생성
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const description = post.subtitle || post.description;
  const image = post.heroImage ?? getFirstContentImage(post.document);
  const url = new URL(postPath(post.slug), siteUrl).href;

  return {
    title: post.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      locale: "ko_KR",
      siteName,
      title: post.title,
      description,
      url,
      publishedTime: post.date,
      images: image ? [{
        url: new URL(image.src, siteUrl).href,
        alt: image.alt || post.title,
        width: image.width,
        height: image.height,
      }] : undefined,
    },
    other: {
      "giscus:backlink": url,
    },
  };
}

// 실제 발행한 글 주소별 상세 화면 구성
export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  if (decodeURIComponent(slug).normalize("NFC") !== post.slug) {
    const path = (process.env.NEXT_PUBLIC_BASE_PATH || "") + postPath(post.slug);

    return (
      <>
        <meta httpEquiv="refresh" content={"0;url=" + path} />
        <main id="main-content">
          <a href={path}>새 글 주소로 이동</a>
        </main>
      </>
    );
  }

  return (
    <>
      <ArticleReader key={post.slug} post={post} commentsEnabled />
      <WriteButton postSlug={post.slug} />
    </>
  );
}
