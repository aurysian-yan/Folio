import { Button, ColorPicker } from "@heroui/react";
import { RectangleIcon, TextAaIcon } from "@phosphor-icons/react";
import { parseColor } from "react-aria-components/ColorArea";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function PreviewColorPicker({ kind, value, onChange, onEditingStart, onEditingEnd }: {
  kind: "background" | "text";
  value: string | null;
  onChange: (value: string | null) => void;
  onEditingStart: () => void;
  onEditingEnd: () => void;
}) {
  const { t } = useTranslation();
  const isText = kind === "text";
  const label = isText ? t("common.text") : t("libraryView.card");
  const trigger = useRef<HTMLButtonElement>(null);
  const editing = useRef(false);
  const [defaultTextColor, setDefaultTextColor] = useState("#000000ff");
  const color = value ?? (isText ? defaultTextColor : "#ffffff00");
  const begin = () => { if (!editing.current) { editing.current = true; onEditingStart(); } };
  const finish = () => { if (editing.current) { editing.current = false; onEditingEnd(); } };
  const finishEvent = useEffectEvent(finish);
  useEffect(() => {
    // 同色点击和取消手势也要结束预览；拾色和拖动本身由库处理。
    const end = () => finishEvent();
    for (const name of ["mouseup", "touchend", "touchcancel", "pointercancel", "blur"]) window.addEventListener(name, end);
    return () => {
      for (const name of ["mouseup", "touchend", "touchcancel", "pointercancel", "blur"]) window.removeEventListener(name, end);
      finishEvent();
    };
  }, []);
  const change = (next: string) => { begin(); onChange(parseColor(next).toString("hexa")); };
  const swatch = value ?? (isText ? "var(--text)" : "transparent");
  return <ColorPicker value={color} className="preview-color-picker">
    <ColorPicker.Trigger ref={trigger} className="preview-color-trigger" aria-label={t("desktop.labelColor", { label })}
      onPress={() => {
        if (isText && !value && trigger.current) setDefaultTextColor(parseColor(getComputedStyle(trigger.current).color).toString("hexa"));
      }}>
      <span className="preview-color-label">{label}</span>
      <span className="preview-color-icon" aria-hidden="true">{isText ? <TextAaIcon /> : <RectangleIcon weight="fill" />}</span>
      <span className="preview-color-well" aria-hidden="true"><span style={{ backgroundColor: swatch }} /></span>
    </ColorPicker.Trigger>
    <ColorPicker.Popover placement="top end" className="preview-color-popover" onOpenChange={(open) => { if (!open) finish(); }}>
      <div role="dialog" aria-label={t("desktop.labelColor", { label })} className="preview-color-controls"
        onPointerDownCapture={(event) => { if ((event.target as HTMLElement).closest(".react-colorful")) begin(); }}
        onKeyDownCapture={(event) => { if (event.key.startsWith("Arrow") && (event.target as HTMLElement).closest(".react-colorful")) begin(); }}
        onKeyUpCapture={(event) => { if (event.key.startsWith("Arrow")) finish(); }}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish(); }}>
        <div className="preview-color-heading">{t("desktop.labelColor", { label })}</div>
        <ColorPanel label={label} color={color} onChange={change} onChangeEnd={finish} />
        <label className="preview-color-field">
          <span>{t("desktop.colorValue")}</span>
          <HexColorInput alpha prefixed color={color} onChange={change} onBlur={finish} aria-label={t("desktop.labelColorValue", { label })} />
        </label>
        <Button variant="ghost" size="sm" className="self-center h-8" onPress={() => { onChange(null); onEditingEnd(); }}>{isText ? t("desktop.resetTextColor") : t("desktop.resetCardColor")}</Button>
      </div>
    </ColorPicker.Popover>
  </ColorPicker>;
}

function ColorPanel({ label, color, onChange, onChangeEnd }: {
  label: string;
  color: string;
  onChange: (color: string) => void;
  onChangeEnd: () => void;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // 库尚未提供本地化接口，只适配读屏标签，不改其布局与交互。
    const labels = { saturation: t("desktop.labelColorSaturation", { label }), hue: t("desktop.hue"), alpha: t("desktop.opacity") };
    for (const [channel, text] of Object.entries(labels)) {
      const control = root.current?.querySelector<HTMLElement>(`.react-colorful__${channel} [role="slider"]`);
      control?.setAttribute("aria-label", text);
      const description = control?.getAttribute("aria-valuetext");
      if (description) control?.setAttribute("aria-valuetext", description.replace("Saturation", t("desktop.saturation")).replace("Brightness", t("desktop.brightness")));
    }
  }, [label, color, t]);
  return <div ref={root}><HexAlphaColorPicker color={color} onChange={onChange} onChangeEnd={onChangeEnd} /></div>;
}
