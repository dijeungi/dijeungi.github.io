import Image from "next/image";
import { Fragment } from "react";

import { isSafeContentUrl } from "@/app/shared/lib/content";

import styles from "../PostDetail.module.css";

import type { ReactNode } from "react";
import type { RichNode } from "@/app/shared/types/content";
import type { ArticleRichContentProps } from "../_types/reader";

// 편집기로 작성한 본문 요소 표시
export function ArticleRichContent({ document, copyCode, codeStatuses }: ArticleRichContentProps) {
  // 인라인 텍스트 서식 표시
  function renderText(node: RichNode, path: string): ReactNode {
    let text: ReactNode = node.text || "";
    for (const mark of node.marks || []) {
      if (mark.type === "bold") text = <strong>{text}</strong>;
      if (mark.type === "italic") text = <em>{text}</em>;
      if (mark.type === "underline") text = <u>{text}</u>;
      if (mark.type === "strike") text = <s>{text}</s>;
      if (mark.type === "code") text = <code>{text}</code>;
      if (mark.type === "link" && mark.attrs && isSafeContentUrl(mark.attrs.href)) {
        const external = /^https?:/i.test(mark.attrs.href);
        text = <a href={mark.attrs.href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{text}</a>;
      }
    }
    return <Fragment key={path}>{text}</Fragment>;
  }

  // 본문 블록 재귀 표시
  function renderNode(node: RichNode, path: string): ReactNode {
    const children = node.content?.map((child, index) => renderNode(child, path + "-" + index));
    if (node.type === "text") return renderText(node, path);
    if (node.type === "paragraph") return <p key={path}>{children?.length ? children : <br />}</p>;
    if (node.type === "heading") {
      return node.attrs?.level === 3
        ? <h3 key={path} id={"heading-" + path}>{children}</h3>
        : <h2 key={path} id={"heading-" + path}>{children}</h2>;
    }
    if (node.type === "bulletList") return <ul key={path}>{children}</ul>;
    if (node.type === "orderedList") return <ol key={path} start={node.attrs?.start}>{children}</ol>;
    if (node.type === "listItem") return <li key={path}>{children}</li>;
    if (node.type === "blockquote") return <blockquote key={path}>{children}</blockquote>;
    if (node.type === "hardBreak") return <br key={path} />;
    if (node.type === "horizontalRule") return <hr key={path} />;
    if (node.type === "image") {
      const src = node.attrs?.src;
      if (!src || !isSafeContentUrl(src) || /^mailto:/i.test(src) || src.startsWith("#")) return null;
      const alt = node.attrs?.alt || "";
      const width = node.attrs?.width;
      const height = node.attrs?.height;
      return (
        <figure key={path}>
          {width && height ? (
            <Image className={styles.richImage} src={src} alt={alt} width={width} height={height} loading="lazy" unoptimized />
          ) : (
            <img className={styles.richImage} src={src} alt={alt} loading="lazy" decoding="async" />
          )}
          {node.attrs?.title && <figcaption>{node.attrs.title}</figcaption>}
        </figure>
      );
    }
    if (node.type === "codeBlock") {
      const id = "editor-code-" + path;
      const code = (node.content || []).map((child) => child.text || "").join("");
      const status = codeStatuses[id];
      return (
        <div key={path} className={styles.codeBlock}>
          <div className={styles.codeToolbar}>
            <span>{node.attrs?.language || "text"}</span>
            <button type="button" disabled={status === "copying"} onClick={() => void copyCode(id, code)}>
              {status === "copying" ? "복사 중" : status === "success" ? "복사 완료" : "코드 복사"}
            </button>
          </div>
          <pre tabIndex={0}><code>{code}</code></pre>
          <p className={styles.copyFeedback} role="status">
            {status === "success" && "코드를 복사했습니다."}
            {status === "error" && "코드를 복사하지 못했습니다. 코드를 선택해 직접 복사해 주세요."}
          </p>
        </div>
      );
    }
    return <Fragment key={path}>{children}</Fragment>;
  }

  return <div className={styles.richContent}>{document.content.map((node, index) => renderNode(node, String(index)))}</div>;
}
