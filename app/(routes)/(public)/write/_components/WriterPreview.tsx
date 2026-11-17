import Image from "next/image";

import { formatPostDate } from "@/app/shared/lib/date";
import { useCodeCopy } from "@/app/shared/hooks/useCodeCopy";
import { getFirstContentImage, estimateReadingMinutes } from "@/app/shared/lib/content";
import { ArticleRichContent } from "../../posts/[slug]/_components/ArticleRichContent";

import styles from "../Write.module.css";
import mediaStyles from "@/app/shared/styles/ArticleMedia.module.css";

import type { WriterPreviewProps } from "../_types/writer";

// 실제 상세 본문 렌더러를 공유하는 실시간 글 미리보기
export function WriterPreview({ draft }: WriterPreviewProps) {
  const { copyCode, codeStatuses } = useCodeCopy();
  const firstImage = draft ? getFirstContentImage(draft.content) : undefined;
  const heroImage = draft?.heroImage?.src === firstImage?.src ? undefined : draft?.heroImage;

  return (
    <section className={styles.previewPane} aria-label="실시간 미리보기">
      <div className={styles.paneLabel}><span className={styles.liveDot} aria-hidden="true" />실시간 미리보기</div>
      <article className={styles.previewArticle}>
        <header className={styles.previewHeading}>
          <span className={styles.previewCategory} data-empty={!draft?.category.trim()}>{draft?.category || "카테고리"}</span>
          <h1 className={styles.previewTitle} data-empty={!draft?.title.trim()}>{draft?.title || "제목을 입력하세요"}</h1>
          <p className={styles.previewSubtitle} data-empty={!draft?.subtitle?.trim()}>{draft?.subtitle?.trim() ? draft.subtitle : "부제목을 입력하세요"}</p>
          {draft?.date && (
            <p className={styles.previewMeta}>
              <time dateTime={draft.date}>{formatPostDate(draft.date)}</time>
              <span className={styles.metaSeparator} aria-hidden="true">|</span>
              <span>{draft.readingMinutes || estimateReadingMinutes(draft.content)} min read</span>
            </p>
          )}
        </header>
        {heroImage && <Image className={styles.previewHero + " " + mediaStyles.image} src={heroImage.src} alt={heroImage.alt} width={heroImage.width ?? 1600} height={heroImage.height ?? 900} unoptimized />}
        {draft && <div className={styles.previewBody}><ArticleRichContent document={draft.content} copyCode={copyCode} codeStatuses={codeStatuses} /></div>}
      </article>
    </section>
  );
}
