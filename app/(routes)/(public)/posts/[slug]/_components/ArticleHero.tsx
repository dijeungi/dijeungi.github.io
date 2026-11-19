import Image from "next/image";
import { LuCheck, LuLink } from "react-icons/lu";

import { formatPostDate } from "@/app/shared/lib/date";
import { getFirstContentImage } from "@/app/shared/lib/content";

import styles from "../PostDetail.module.css";
import mediaStyles from "@/app/shared/styles/ArticleMedia.module.css";

import type { ArticleHeroProps } from "../_types/reader";

// 카테고리, 제목, 글 주소 복사 버튼과 대표 이미지 표시
export function ArticleHero({ post, copyLink, shareStatus }: ArticleHeroProps) {
  const firstContentImage = getFirstContentImage(post.document);
  const heroImage = post.heroImage?.src === firstContentImage?.src ? undefined : post.heroImage;

  return (
    <section className={styles.hero + (heroImage ? " " + styles.heroWithMedia : "")} aria-labelledby="article-title">
      <div className={styles.pageGrid + " " + styles.heroGrid}>
        <header className={styles.heading}>
          <p className={styles.category}>{post.category}</p>
          <h1 id="article-title">{post.title}</h1>
          {post.subtitle && <p className={styles.subtitle}>{post.subtitle}</p>}
          <div className={styles.meta} role="group" aria-label="글 정보">
            <div className={styles.metaDetails}>
              <time dateTime={post.date}>
                {formatPostDate(post.date)}
              </time>
              <span className={styles.metaSeparator} aria-hidden="true" />
              <span>{post.readingMinutes} min read</span>
            </div>
            <div className={styles.share}>
              <span className={styles.metaSeparator} aria-hidden="true" />
              <button
                className={styles.shareButton}
                type="button"
                disabled={shareStatus === "copying"}
                aria-label="Copy URL"
                title="글 링크 복사"
                data-copied={shareStatus === "success"}
                onClick={() => void copyLink()}
              >
                <span className={styles.shareButtonIdle} aria-hidden="true">
                  <LuLink size={16} focusable="false" />
                  <span className={styles.shareButtonLabel}>Copy URL</span>
                </span>
                <span className={styles.shareButtonCopied} aria-hidden="true">
                  <LuCheck size={16} focusable="false" />
                  <span className={styles.shareButtonLabel}>Copied</span>
                </span>
              </button>
            </div>
            <p className={shareStatus === "error" ? styles.shareFeedback : styles.srOnly} role="status">
              {shareStatus === "success" && "글 링크를 복사했습니다."}
              {shareStatus === "error" && "링크를 복사하지 못했습니다. 주소창의 주소를 직접 복사해 주세요."}
            </p>
          </div>
        </header>
      </div>
      {heroImage && (
        <div className={styles.heroMedia + " " + mediaStyles.frame}>
          <Image
            className={mediaStyles.image}
            src={heroImage.src}
            alt={heroImage.alt}
            width={heroImage.width ?? 1600}
            height={heroImage.height ?? 900}
            unoptimized
            preload
          />
        </div>
      )}
    </section>
  );
}
