import { Dropdown } from "@heroui/react";
import { TextAlignLeftIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

const presets = [
  { id: "pangram", labelKey: "preview.pangram", text: "Sphinx of black quartz, judge my vow." },
  { id: "alphabet", labelKey: "preview.alphabet", text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz" },
  { id: "numbers", labelKey: "preview.numbers", text: "0123456789" },
  { id: "loremIpsum", labelKey: "preview.paragraph", text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit." },
  { id: "custom", labelKey: "common.custom" },
];

export function PreviewPresetMenu({ value, onChange }: { value: string; onChange: (mode: string, text?: string) => void }) {
  const { t } = useTranslation();
  return <Dropdown>
    <Dropdown.Trigger className="preview-preset-trigger" aria-label={t("preview.textType")} aria-description={t("desktop.selectPreviewTextType")}>
      <TextAlignLeftIcon aria-hidden="true" weight="bold" />
    </Dropdown.Trigger>
    <Dropdown.Popover placement="top start" className="preview-preset-popover">
      <Dropdown.Menu aria-label={t("preview.textType")} selectionMode="single" disallowEmptySelection selectedKeys={[value]}
        onAction={(key) => {
          const preset = presets.find((entry) => entry.id === key);
          if (preset) onChange(preset.id, preset.text);
        }}>
        {presets.map((preset) => <Dropdown.Item key={preset.id} id={preset.id} textValue={t(preset.labelKey)}>
          <Dropdown.ItemIndicator />
          <span>{t(preset.labelKey)}</span>
        </Dropdown.Item>)}
      </Dropdown.Menu>
    </Dropdown.Popover>
  </Dropdown>;
}
