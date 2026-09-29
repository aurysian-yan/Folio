import { Button, ColorPicker } from "@heroui/react";
import { RectangleIcon, TextAaIcon } from "@phosphor-icons/react";
import { parseColor } from "react-aria-components/ColorArea";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

export function PreviewColorPicker({ kind, value, onChange, onEditingStart, onEditingEnd }: {
  kind: "background" | "text";
  value: string | null;
  onChange: (value: string | null) => void;
  onEditingStart: () => void;
  onEditingEnd: () => void;
}) {
  const isText = kind === "text";
  const label = isText ? "文字" : "卡片";
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
    <ColorPicker.Trigger ref={trigger} className="preview-color-trigger" aria-label={`${label}颜色`}
      onPress={() => {
        if (isText && !value && trigger.current) setDefaultTextColor(parseColor(getComputedStyle(trigger.current).color).toString("hexa"));
      }}>
      <span className="preview-color-label">{label}</span>
      <span className="preview-color-icon" aria-hidden="true">{isText ? <TextAaIcon /> : <RectangleIcon weight="fill" />}</span>
      <span className="preview-color-well" aria-hidden="true"><span style={{ backgroundColor: swatch }} /></span>
    </ColorPicker.Trigger>
    <ColorPicker.Popover placement="top end" className="preview-color-popover" onOpenChange={(open) => { if (!open) finish(); }}>
      <div role="dialog" aria-label={`${label}颜色`} className="preview-color-controls"
        onPointerDownCapture={(event) => { if ((event.target as HTMLElement).closest(".react-colorful")) begin(); }}
        onKeyDownCapture={(event) => { if (event.key.startsWith("Arrow") && (event.target as HTMLElement).closest(".react-colorful")) begin(); }}
        onKeyUpCapture={(event) => { if (event.key.startsWith("Arrow")) finish(); }}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish(); }}>
        <div className="preview-color-heading">{label}颜色</div>
        <ColorPanel label={label} color={color} onChange={change} onChangeEnd={finish} />
        <label className="preview-color-field">
          <span>色值</span>
          <HexColorInput alpha prefixed color={color} onChange={change} onBlur={finish} aria-label={`${label}颜色色值`} />
        </label>
        <Button variant="ghost" size="sm" onPress={() => { onChange(null); onEditingEnd(); }}>恢复默认{label}颜色</Button>
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
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // 库尚未提供本地化接口，只适配读屏标签，不改其布局与交互。
    const labels = { saturation: `${label}颜色饱和度和亮度`, hue: "色相", alpha: "透明度" };
    for (const [channel, text] of Object.entries(labels)) {
      const control = root.current?.querySelector<HTMLElement>(`.react-colorful__${channel} [role="slider"]`);
      control?.setAttribute("aria-label", text);
      const description = control?.getAttribute("aria-valuetext");
      if (description) control?.setAttribute("aria-valuetext", description.replace("Saturation", "饱和度").replace("Brightness", "亮度"));
    }
  }, [label, color]);
  return <div ref={root}><HexAlphaColorPicker color={color} onChange={onChange} onChangeEnd={onChangeEnd} /></div>;
}
