import { Button, Card, Separator, Toolbar } from "@heroui/react";
import { CaretLeftIcon, CaretRightIcon, CopySimpleIcon, StarIcon } from "@phosphor-icons/react";
import { memo, useEffect, useEffectEvent, useState } from "react";
import { currentPreviewStyle, previewStyles } from "../font-preview";
import type { FamilyDto } from "../types";
import { FontPreview } from "./FontPreview";

export type ViewMode = "compact" | "large" | "list" | "expanded";

export const FontCard = memo(function FontCard({ family, mode, selected, styleKey, previewText, previewSize, textColor, backgroundColor, showMetadata, selectOnHover, hoverDelay, onSelect, onStyleChange, onFavorite, position, total }: {
  family: FamilyDto;
  mode: ViewMode;
  selected: boolean;
  styleKey: string | null;
  previewText: string;
  previewSize: number;
  textColor?: string | null;
  backgroundColor?: string | null;
  showMetadata: boolean;
  selectOnHover: boolean;
  hoverDelay: number;
  onSelect: (family: FamilyDto) => void;
  onStyleChange: (key: string) => void;
  onFavorite: (family: FamilyDto) => void;
  position: number;
  total: number;
}) {
  const styles = previewStyles(family);
  const style = currentPreviewStyle(family, selected ? styleKey : null);
  const index = styles.findIndex((entry) => entry.key === style?.key);
  const [hovered, setHovered] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const selectHoveredCard = useEffectEvent(() => {
    if (hovered && selectOnHover && !selected) onSelect(family);
  });
  // 快速移过、手动选择或更改偏好时取消等待，避免过期回调切换字体。
  useEffect(() => {
    if (!hovered || !selectOnHover || selected) return;
    const timer = window.setTimeout(() => selectHoveredCard(), hoverDelay);
    return () => window.clearTimeout(timer);
  }, [hovered, selectOnHover, selected, hoverDelay]);
  useEffect(() => {
    const cancelHover = () => setHovered(false);
    window.addEventListener("blur", cancelHover);
    return () => window.removeEventListener("blur", cancelHover);
  }, []);
  const moveStyle = (offset: number) => {
    const next = styles[(index + offset + styles.length) % styles.length];
    if (next) onStyleChange(next.key);
  };
  const copyName = async () => {
    try { await navigator.clipboard.writeText(family.displayName); setCopyMessage("已复制字族名"); }
    catch { setCopyMessage("复制失败，请检查剪贴板权限"); }
  };
  const metadata = <Card.Description className="font-card-metadata">
    <span>{styles.length}个样式</span>
    {family.isVariable && <><Separator orientation="vertical" /><span title="可变字体">VF</span></>}
  </Card.Description>;
  const selector = <div className="font-style-selector" role="group" aria-label={`${family.displayName} 预览样式`}>
    <Button isIconOnly size="sm" variant="ghost" className="font-style-step" aria-label="上一个样式" isDisabled={styles.length < 2} onPress={() => moveStyle(-1)}><CaretLeftIcon /></Button>
    <span className="font-style-name" title={style?.name} aria-live="polite">{style?.name ?? "常规"}</span>
    <Button isIconOnly size="sm" variant="ghost" className="font-style-step" aria-label="下一个样式" isDisabled={styles.length < 2} onPress={() => moveStyle(1)}><CaretRightIcon /></Button>
  </div>;
  return <Card className={`font-card${selected ? " selected" : ""}`} variant="secondary" data-mode={mode} data-family-id={family.id}
    style={{ backgroundColor: backgroundColor ?? undefined }}
    role="listitem" aria-posinset={position} aria-setsize={total}
    onPointerEnter={(event) => setHovered(event.pointerType === "mouse")}
    onPointerLeave={() => setHovered(false)}
    onPointerCancel={() => setHovered(false)}
    onPointerDown={() => setHovered(false)}>
    <Button variant="ghost" className="font-card-select" aria-label={`选择 ${family.displayName}`} aria-pressed={selected} onPress={() => { setHovered(false); onSelect(family); }}>
      <span className="sr-only">选择 {family.displayName}</span>
    </Button>
    <div className="font-card-preview-area">
      <FontPreview style={style} text={previewText} size={previewSize} color={textColor} lines={mode === "compact" ? 2 : mode === "large" ? 3 : mode === "list" ? 1 : 6}
        priority={selected ? "selected" : "visible"}
        align={mode === "expanded" ? "top" : mode === "list" ? "left" : "center"} label={`${family.displayName}，${style?.name ?? "常规"} 字体预览`} />
    </div>
    <Card.Content className="font-card-content">
      <Card.Title title={family.displayName}>{family.displayName}</Card.Title>
      {mode === "expanded" ? <div className="font-card-footer-row">{showMetadata && metadata}{selected && selector}</div>
        : selected ? selector : showMetadata && metadata}
    </Card.Content>
    {selected && mode !== "expanded" && <Toolbar className="font-card-actions" aria-label={`${family.displayName} 字体操作`}>
      <Button isIconOnly size="sm" variant="secondary" className="font-card-action" aria-label="复制字族名" onPress={() => void copyName()}><CopySimpleIcon /></Button>
      <Button isIconOnly size="sm" variant="secondary" className={`font-card-action${family.isFavorite ? " is-favorite" : ""}`} aria-label={family.isFavorite ? "取消收藏" : "收藏字体"}
        aria-pressed={family.isFavorite} onPress={() => onFavorite(family)}><StarIcon weight={family.isFavorite ? "fill" : "regular"} /></Button>
    </Toolbar>}
    <span className="sr-only" role="status">{copyMessage}</span>
  </Card>;
});
