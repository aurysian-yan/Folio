import { Button, Card, Separator, Toolbar } from "@heroui/react";
import { CaretLeftIcon, CaretRightIcon, CopySimpleIcon, StarIcon } from "@phosphor-icons/react";
import { memo, useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
    try { await navigator.clipboard.writeText(family.displayName); setCopyMessage(t("inspector.copiedFamilyName")); }
    catch { setCopyMessage(t("desktop.copyFailedClipboard")); }
  };
  const metadata = <Card.Description className="font-card-metadata">
    <span>{t("macos.stylesCount", { count: styles.length })}</span>
    {family.isVariable && <><Separator orientation="vertical" /><span title={t("font.variable")}>VF</span></>}
  </Card.Description>;
  const selector = <div className="font-style-selector" role="group" aria-label={t("desktop.previewOf", { name: family.displayName })}>
    <Button isIconOnly size="sm" variant="ghost" className="font-style-step" aria-label={t("desktop.prevStyle")} isDisabled={styles.length < 2} onPress={() => moveStyle(-1)}><CaretLeftIcon /></Button>
    <span className="font-style-name" title={style?.name} aria-live="polite">{style?.name ?? t("font.regular")}</span>
    <Button isIconOnly size="sm" variant="ghost" className="font-style-step" aria-label={t("desktop.nextStyle")} isDisabled={styles.length < 2} onPress={() => moveStyle(1)}><CaretRightIcon /></Button>
  </div>;
  return <Card className={`font-card${selected ? " selected" : ""}`} variant="secondary" data-mode={mode} data-family-id={family.id}
    style={{ backgroundColor: backgroundColor ?? undefined }}
    role="listitem" aria-posinset={position} aria-setsize={total}
    onPointerEnter={(event) => setHovered(event.pointerType === "mouse")}
    onPointerLeave={() => setHovered(false)}
    onPointerCancel={() => setHovered(false)}
    onPointerDown={() => setHovered(false)}>
    <Button variant="ghost" className="font-card-select" aria-label={t("desktop.selectFamily", { name: family.displayName })} aria-pressed={selected} onPress={() => { setHovered(false); onSelect(family); }}>
      <span className="sr-only">{t("desktop.selectFamily", { name: family.displayName })}</span>
    </Button>
    <div className="font-card-preview-area">
      <FontPreview style={style} text={previewText} size={previewSize} color={textColor} lines={mode === "compact" ? 2 : mode === "large" ? 3 : mode === "list" ? 1 : 6}
        priority={selected ? "selected" : "visible"}
        align={mode === "expanded" ? "top" : mode === "list" ? "left" : "center"} label={t("desktop.previewLabel", { name: family.displayName, style: style?.name ?? t("font.regular") })} />
    </div>
    <Card.Content className="font-card-content">
      <Card.Title title={family.displayName}>{family.displayName}</Card.Title>
      {mode === "expanded" ? <div className="font-card-footer-row">{showMetadata && metadata}{selector}</div>
        : selected ? selector : showMetadata && metadata}
    </Card.Content>
    {selected && mode !== "expanded" && <Toolbar className="font-card-actions" aria-label={t("desktop.fontOf", { name: family.displayName })}>
      <Button isIconOnly size="sm" variant="secondary" className="font-card-action" aria-label={t("inspector.copyFamilyName")} onPress={() => void copyName()}><CopySimpleIcon /></Button>
      <Button isIconOnly size="sm" variant="secondary" className={`font-card-action${family.isFavorite ? " is-favorite" : ""}`} aria-label={family.isFavorite ? t("collection.unfavorite") : t("collection.favorite")}
        aria-pressed={family.isFavorite} onPress={() => onFavorite(family)}><StarIcon weight={family.isFavorite ? "fill" : "regular"} /></Button>
    </Toolbar>}
    <span className="sr-only" role="status">{copyMessage}</span>
  </Card>;
});
