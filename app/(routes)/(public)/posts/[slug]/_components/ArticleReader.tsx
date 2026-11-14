"use client";

import { ArticleBody } from "./ArticleBody";
import { ArticleHero } from "./ArticleHero";
import { ArticleHeader } from "./ArticleHeader";
import { ArticleComments } from "./ArticleComments";
import { useArticleReader } from "../_hooks/useArticleReader";

import styles from "../PostDetail.module.css";
import frameStyles from "@/app/shared/styles/PageFrame.module.css";

import type { ArticleReaderProps } from "../_types/reader";

// 읽기 상태와 글 상세 화면 조합
export function ArticleReader({ post, commentsEnabled = false }: ArticleReaderProps) {
  const {
    progress,
    isReading,
    copyCode,
    copyLink,
    scrollToTop,
    headerRef,
    contentRef,
    shareStatus,
    codeStatuses,
  } = useArticleReader();

  return (
    <div className={styles.reader + " " + frameStyles.frame}>
      <a className={styles.skipLink} href="#main-content">본문으로 바로가기</a>
      <ArticleHeader
        title={post.title}
        progress={progress}
        isReading={isReading}
        copyLink={copyLink}
        scrollToTop={scrollToTop}
        headerRef={headerRef}
        shareStatus={shareStatus}
      />
      <main id="main-content">
        <ArticleHero post={post} />
        <div className={styles.pageGrid}>
          <ArticleBody
            post={post}
            copyCode={copyCode}
            contentRef={contentRef}
            codeStatuses={codeStatuses}
          />
          {commentsEnabled && <ArticleComments key={post.slug} slug={post.slug} />}
        </div>
      </main>
    </div>
  );
}
