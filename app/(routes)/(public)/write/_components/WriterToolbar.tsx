import { LuQuote } from "react-icons/lu";

import { WriterIcon } from "./WriterIcon";

import styles from "../Write.module.css";

import type { WriterToolbarProps } from "../_types/writer";

// 마크다운 서식과 본문 이미지 삽입 도구
export function WriterToolbar({ busy, uploading, insertMarkdown, uploadInlineImage, undo, redo, canUndo, canRedo }: WriterToolbarProps) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="마크다운 편집 도구">
      <button className={styles.toolButton + " " + styles.headingButton} type="button" title="제목 1" aria-label="제목 1" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("heading1")}>H1</button>
      <button className={styles.toolButton + " " + styles.headingButton} type="button" title="제목 2" aria-label="제목 2" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("heading2")}>H2</button>
      <button className={styles.toolButton + " " + styles.headingButton} type="button" title="제목 3" aria-label="제목 3" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("heading3")}>H3</button>
      <span className={styles.toolbarSeparator} aria-hidden="true" />
      <button className={styles.toolButton} type="button" title="굵게" aria-label="굵게" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("bold")}><WriterIcon name="bold" /></button>
      <button className={styles.toolButton} type="button" title="기울임" aria-label="기울임" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("italic")}><WriterIcon name="italic" /></button>
      <button className={styles.toolButton} type="button" title="취소선" aria-label="취소선" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("strike")}><WriterIcon name="strike" /></button>
      <button className={styles.toolButton} type="button" title="링크" aria-label="링크" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("link")}><WriterIcon name="link" /></button>
      <span className={styles.toolbarSeparator} aria-hidden="true" />
      <button className={styles.toolButton} type="button" title="글머리 목록" aria-label="글머리 목록" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("bullets")}><WriterIcon name="bullets" /></button>
      <button className={styles.toolButton} type="button" title="번호 목록" aria-label="번호 목록" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("numbers")}><WriterIcon name="numbers" /></button>
      <button
        className={styles.toolButton}
        type="button"
        title="인용문"
        aria-label="인용문"
        disabled={busy}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => insertMarkdown("quote")}
      >
        <LuQuote size={20} strokeWidth={1.6} aria-hidden="true" focusable="false" />
      </button>
      <button className={styles.toolButton} type="button" title="코드 블록" aria-label="코드 블록" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMarkdown("code")}><WriterIcon name="code" /></button>
      <label className={styles.toolButton + (busy || uploading ? " " + styles.disabledTool : "")} title="본문 이미지 추가">
        <input className={styles.srOnly} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="본문 이미지 추가" disabled={busy || uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadInlineImage(file); event.currentTarget.value = ""; }} />
        <WriterIcon name="image" />
      </label>
      <span className={styles.toolbarEnd} />
      <button className={styles.toolButton} type="button" title="실행 취소" aria-label="실행 취소" disabled={busy || !canUndo} onMouseDown={(event) => event.preventDefault()} onClick={undo}><WriterIcon name="undo" /></button>
      <button className={styles.toolButton} type="button" title="다시 실행" aria-label="다시 실행" disabled={busy || !canRedo} onMouseDown={(event) => event.preventDefault()} onClick={redo}><WriterIcon name="redo" /></button>
    </div>
  );
}
