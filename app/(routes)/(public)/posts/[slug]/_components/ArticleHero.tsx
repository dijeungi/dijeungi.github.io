import Image from "next/image";

import { formatPostDate } from "@/app/shared/lib/date";
import { getFirstContentImage } from "@/app/shared/lib/content";

import styles from "../PostDetail.module.css";
import mediaStyles from "@/app/shared/styles/ArticleMedia.module.css";

import type { ArticleReaderProps } from "../_types/reader";

// 카테고리와 제목 및 대표 이미지 표시
export function ArticleHero({ post }: ArticleReaderProps) {
  const firstContentImage = getFirstContentImage(post.document);
  const heroImage = post.heroImage?.src === firstContentImage?.src ? undefined : post.heroImage;

  return (
    <section className={styles.hero + (heroImage ? " " + styles.heroWithMedia : "")} aria-labelledby="article-title">
      <div className={styles.pageGrid + " " + styles.heroGrid}>
        <header className={styles.heading}>
          <p className={styles.category}>{post.category}</p>
          <h1 id="article-title">{post.title}</h1>
          {post.subtitle && <p className={styles.subtitle}>{post.subtitle}</p>}
          <div className={styles.meta} aria-label="글 정보">
            <time dateTime={post.date}>
              {formatPostDate(post.date)}
            </time>
            <span className={styles.metaSeparator} aria-hidden="true">|</span>
            <span>{post.readingMinutes} min read</span>
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
