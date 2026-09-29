import { Dropdown } from "@heroui/react";
import { TextAlignLeftIcon } from "@phosphor-icons/react";

const presets = [
  { id: "pangram", label: "全字母句", text: "Sphinx of black quartz, judge my vow." },
  { id: "alphabet", label: "英文字母", text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz" },
  { id: "numbers", label: "数字", text: "0123456789" },
  { id: "loremIpsum", label: "段落样例", text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit." },
  { id: "custom", label: "自定义" },
];

export function PreviewPresetMenu({ value, onChange }: { value: string; onChange: (mode: string, text?: string) => void }) {
  return <Dropdown>
    <Dropdown.Trigger className="preview-preset-trigger" aria-label="预览文字类型" aria-description="选择预览文字类型">
      <TextAlignLeftIcon aria-hidden="true" weight="bold" />
    </Dropdown.Trigger>
    <Dropdown.Popover placement="top start" className="preview-preset-popover">
      <Dropdown.Menu aria-label="预览文字类型" selectionMode="single" disallowEmptySelection selectedKeys={[value]}
        onAction={(key) => {
          const preset = presets.find((entry) => entry.id === key);
          if (preset) onChange(preset.id, preset.text);
        }}>
        {presets.map((preset) => <Dropdown.Item key={preset.id} id={preset.id} textValue={preset.label}>
          <Dropdown.ItemIndicator />
          <span>{preset.label}</span>
        </Dropdown.Item>)}
      </Dropdown.Menu>
    </Dropdown.Popover>
  </Dropdown>;
}
