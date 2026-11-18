import {
  LuBold,
  LuLink,
  LuList,
  LuPlus,
  LuCheck,
  LuImage,
  LuRedo2,
  LuUndo2,
  LuItalic,
  LuPencil,
  LuCodeXml,
  LuArrowLeft,
  LuListOrdered,
  LuStrikethrough,
} from "react-icons/lu";

import type { IconBaseProps, IconType } from "react-icons";
import type { WriterIconName } from "../_types/writer";

const icons: Record<WriterIconName, IconType> = {
  bold: LuBold,
  italic: LuItalic,
  strike: LuStrikethrough,
  link: LuLink,
  bullets: LuList,
  numbers: LuListOrdered,
  code: LuCodeXml,
  image: LuImage,
  undo: LuUndo2,
  redo: LuRedo2,
  back: LuArrowLeft,
  check: LuCheck,
  plus: LuPlus,
  edit: LuPencil,
};

// 글쓰기 도구의 선형 아이콘
export function WriterIcon({ name, ...props }: IconBaseProps & { name: WriterIconName }) {
  const Icon = icons[name];

  return <Icon size={20} strokeWidth={1.6} aria-hidden="true" focusable="false" {...props} />;
}
