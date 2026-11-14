import { WriterIcon } from "./WriterIcon";

import styles from "../Write.module.css";

import type { WriterToolbarProps } from "../_types/writer";

// 본문 서식과 이미지 삽입 도구
export function WriterToolbar({ editor, selection, busy, uploading, editLink, uploadInlineImage }: WriterToolbarProps) {
  const disabled = busy || !editor;
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="본문 편집 도구">
      <select
        className={styles.blockSelect}
        aria-label="본문 문단 스타일"
        value={selection?.level || "paragraph"}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === "paragraph") editor?.chain().focus().setParagraph().run();
          else editor?.chain().focus().toggleHeading({ level: Number(event.target.value) as 2 | 3 }).run();
        }}
      >
        <option value="paragraph">본문</option>
        <option value="2">제목 2</option>
        <option value="3">제목 3</option>
      </select>
      <span className={styles.toolbarSeparator} />
      <button className={styles.toolButton} type="button" title="굵게" aria-label="굵게" aria-pressed={selection?.bold || false} disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()}><WriterIcon name="bold" /></button>
      <button className={styles.toolButton} type="button" title="기울임" aria-label="기울임" aria-pressed={selection?.italic || false} disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()}><WriterIcon name="italic" /></button>
      <button className={styles.toolButton} type="button" title="취소선" aria-label="취소선" aria-pressed={selection?.strike || false} disabled={disabled} onClick={() => editor?.chain().focus().toggleStrike().run()}><WriterIcon name="strike" /></button>
      <button className={styles.toolButton} type="button" title="링크" aria-label="링크" aria-pressed={selection?.link || false} disabled={disabled} onClick={editLink}><WriterIcon name="link" /></button>
      <span className={styles.toolbarSeparator} />
      <button className={styles.toolButton} type="button" title="글머리 목록" aria-label="글머리 목록" aria-pressed={selection?.bulletList || false} disabled={disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()}><WriterIcon name="bullets" /></button>
      <button className={styles.toolButton} type="button" title="번호 목록" aria-label="번호 목록" aria-pressed={selection?.orderedList || false} disabled={disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><WriterIcon name="numbers" /></button>
      <button className={styles.toolButton + " " + styles.quoteButton} type="button" title="인용문" aria-label="인용문" aria-pressed={selection?.blockquote || false} disabled={disabled} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>“</button>
      <button className={styles.toolButton} type="button" title="코드 블록" aria-label="코드 블록" aria-pressed={selection?.codeBlock || false} disabled={disabled} onClick={() => editor?.chain().focus().toggleCodeBlock().run()}><WriterIcon name="code" /></button>
      <label className={styles.toolButton + (disabled || uploading ? " " + styles.disabledTool : "")} title="본문 이미지 추가">
        <input className={styles.srOnly} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="본문 이미지 추가" disabled={disabled || uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadInlineImage(file); event.currentTarget.value = ""; }} />
        <WriterIcon name="image" />
      </label>
      <span className={styles.toolbarEnd} />
      <button className={styles.toolButton} type="button" title="실행 취소" aria-label="실행 취소" disabled={disabled || !selection?.undo} onClick={() => editor?.chain().focus().undo().run()}><WriterIcon name="undo" /></button>
      <button className={styles.toolButton} type="button" title="다시 실행" aria-label="다시 실행" disabled={disabled || !selection?.redo} onClick={() => editor?.chain().focus().redo().run()}><WriterIcon name="redo" /></button>
      {selection?.codeBlock && (
        <select className={styles.languageSelect} aria-label="코드 언어" disabled={disabled} value={String(editor?.getAttributes("codeBlock").language || "text")} onChange={(event) => editor?.chain().focus().updateAttributes("codeBlock", { language: event.target.value }).run()}>
          <option value="text">Text</option><option value="typescript">TypeScript</option><option value="javascript">JavaScript</option><option value="tsx">TSX</option><option value="jsx">JSX</option><option value="html">HTML</option><option value="css">CSS</option><option value="json">JSON</option><option value="bash">Bash</option><option value="python">Python</option><option value="sql">SQL</option>
        </select>
      )}
      {selection?.image && <label className={styles.imageAltField}>이미지 설명<input type="text" aria-label="본문 이미지 설명" maxLength={300} value={selection.imageAlt} disabled={disabled} onChange={(event) => editor?.chain().focus().updateAttributes("image", { alt: event.target.value }).run()} /></label>}
    </div>
  );
}
