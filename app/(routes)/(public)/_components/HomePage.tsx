"use client";

import Link from "next/link";
import Image from "next/image";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";

import { GitHubOverview } from "./GitHubOverview";
import { siteName } from "@/app/shared/constants/site";
import { useHomePosts } from "../_hooks/useHomePosts";
import { formatPostDate } from "@/app/shared/lib/date";
import { postPath } from "@/app/shared/lib/post-urls";
import { WriteButton } from "../write/_components/WriteButton";
import { SiteHeader } from "@/app/shared/components/SiteHeader";

import styles from "../Home.module.css";
import frameStyles from "@/app/shared/styles/PageFrame.module.css";

import type { HomePageProps } from "../_types/home";

// 카테고리 탐색과 왼쪽 썸네일을 갖춘 글 목록
export function HomePage({ posts, github }: HomePageProps) {
  const hasPosts = posts.length > 0;
  const {
    categories,
    currentPage,
    totalPages,
    pageNumbers,
    visiblePosts,
    filteredPostCount,
    selectedCategory,
    selectPage,
    selectCategory,
  } = useHomePosts(posts);

  return (
    <div className={styles.home + " " + frameStyles.frame}>
      {hasPosts && <a className={styles.skipLink} href="#posts">글 목록으로 바로가기</a>}
      <SiteHeader />

      <GitHubOverview github={github} />

      {hasPosts ? (
        <div className={styles.layout + " " + frameStyles.content}>
          <aside className={styles.sidebar}>
            <nav className={styles.categories} aria-label="카테고리">
              <button
                className={styles.category}
                type="button"
                aria-pressed={selectedCategory === null}
                onClick={() => selectCategory(null)}
              >
                <span>전체</span><span className={styles.categoryCount}>({posts.length})</span>
              </button>
              {categories.map((category) => (
                <button
                  className={styles.category}
                  key={category.name}
                  type="button"
                  aria-pressed={selectedCategory === category.name}
                  onClick={() => selectCategory(category.name)}
                >
                  <span>{category.name}</span><span className={styles.categoryCount}>({category.count})</span>
                </button>
              ))}
            </nav>
          </aside>

          <main className={styles.feed} id="posts" aria-label="글 목록">
            <p className={styles.srOnly} role="status">
              {selectedCategory ?? "전체"} 글 {filteredPostCount}개
              {totalPages > 0 && `, ${currentPage}/${totalPages} 페이지`}
            </p>
            {visiblePosts.map((post) => (
              <article className={styles.post} key={post.slug}>
                <Link
                  className={styles.postLink}
                  href={postPath(post.slug)}
                  aria-labelledby={"post-title-" + post.slug}
                >
                  <div className={styles.thumbnail} aria-hidden="true">
                    {post.heroImage ? (
                      <>
                        <Image className={styles.thumbnailBackdrop} src={post.heroImage.src} alt="" fill unoptimized />
                        <Image
                          className={styles.thumbnailImage}
                          src={post.heroImage.src}
                          alt=""
                          width={post.heroImage.width ?? 1600}
                          height={post.heroImage.height ?? 900}
                          sizes="(max-width: 600px) 70vw, (max-width: 820px) 224px, 288px"
                          unoptimized
                        />
                      </>
                    ) : (
                      <div className={styles.thumbnailFallback}>
                        <span>{post.category}</span>
                        <div className={styles.fallbackLines}><span /><span /><span /></div>
                      </div>
                    )}
                  </div>
                  <div className={styles.postCopy}>
                    <span className={styles.postCategory} title={post.category}>{post.category}</span>
                    <h2 className={styles.postTitle} id={"post-title-" + post.slug} title={post.title}>{post.title}</h2>
                    <p className={styles.postDescription}>{post.description}</p>
                    <p className={styles.postMeta}>
                      <time dateTime={post.date}>{formatPostDate(post.date)}</time>
                      <span className={styles.metaSeparator} aria-hidden="true">|</span>
                      <span>{post.readingMinutes} min read</span>
                    </p>
                  </div>
                </Link>
              </article>
            ))}
          </main>
          {totalPages > 0 && (
            <nav className={styles.pagination} aria-label="글 목록 페이지">
              <button
                className={styles.pageButton}
                type="button"
                aria-label="이전 페이지"
                disabled={currentPage === 1}
                onClick={() => selectPage(currentPage - 1)}
              >
                <LuChevronLeft size={18} strokeWidth={1.6} aria-hidden="true" focusable="false" />
              </button>
              {pageNumbers.map((page) => (
                <button
                  className={styles.pageButton}
                  key={page}
                  type="button"
                  aria-label={page + "페이지로 이동"}
                  aria-current={currentPage === page ? "page" : undefined}
                  onClick={() => selectPage(page)}
                >
                  {page}
                </button>
              ))}
              <button
                className={styles.pageButton}
                type="button"
                aria-label="다음 페이지"
                disabled={currentPage === totalPages}
                onClick={() => selectPage(currentPage + 1)}
              >
                <LuChevronRight size={18} strokeWidth={1.6} aria-hidden="true" focusable="false" />
              </button>
            </nav>
          )}
        </div>
      ) : <main id="posts" aria-label="글 목록" />}
      <footer className={styles.footer + " " + frameStyles.content} data-empty={!hasPosts}>© {new Date().getUTCFullYear()} {siteName}</footer>
      <WriteButton />
    </div>
  );
}
