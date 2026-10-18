// 设置控件统一处理标签、说明、数值与行布局。
import { Button, Input, Label, ListBox, Select, Switch, TextField } from "@heroui/react";
import { type HTMLInputTypeAttribute, useId } from "react";
import { useTranslation } from "react-i18next";
import { ClaralightSlider } from "./ClaralightSlider";

type SelectOption = { id: string; label: string };
type SelectProps = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  isDisabled?: boolean;
};

export function OptionSelect({ label, value, options, onChange, isDisabled }: SelectProps) {
  const { t } = useTranslation();
  return (
    <Select.Root className="hero-select" aria-label={label} selectedKey={value} isDisabled={isDisabled}
      onSelectionChange={(key) => { if (key !== null) onChange(String(key)); }}>
      <Select.Trigger className="hero-select-trigger items-center">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox aria-label={t("desktop.labelOptions", { label })}>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>{option.label}</ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select.Root>
  );
}

export function SettingSelect({ label, controlLabel = label, ...props }: SelectProps & { controlLabel?: string }) {
  return (
    <div className="setting-field">
      <span>{label}</span>
      <OptionSelect {...props} label={controlLabel} />
    </div>
  );
}

export function SettingSwitch({ label, description, isSelected, onChange, isDisabled }: {
  label: string;
  description?: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
  isDisabled?: boolean;
}) {
  const descriptionId = useId();
  return (
    <div className="setting-switch">
      <Switch className="setting-toggle" isSelected={isSelected} onChange={onChange} isDisabled={isDisabled}
        aria-describedby={description ? descriptionId : undefined}>
        <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><span className="setting-label">{label}</span></Switch.Content>
      </Switch>
      {description && <p id={descriptionId} className="settings-note">{description}</p>}
    </div>
  );
}

export function SettingSliderField({ label, description, minValue, maxValue, step, value, onChange,
  onChangeStart, onChangeEnd, unit = "px", formatValue, isDisabled }: {
  label: string;
  description?: string;
  minValue: number;
  maxValue: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: () => void;
  unit?: string;
  formatValue?: (value: number) => string;
  isDisabled?: boolean;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const valueText = formatValue ? formatValue(value) : `${value}${unit}`;
  return (
    <div className="setting-slider-field">
      <div className="setting-field setting-field--slider">
        <span id={labelId}>{label}</span>
        <ClaralightSlider autoHeight className="folio-slider settings-slider" aria-labelledby={labelId}
          aria-describedby={description ? descriptionId : undefined} aria-valuetext={valueText}
          min={minValue} max={maxValue} step={step} value={value} disabled={isDisabled}
          onValueChange={onChange} onValueChangeStart={onChangeStart} onValueChangeEnd={onChangeEnd} />
        <output>{valueText}</output>
      </div>
      {description && <p id={descriptionId} className="settings-note">{description}</p>}
    </div>
  );
}

export function SettingTextField({ label, value, onChange, type = "text", autoComplete, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <TextField className="setting-field" value={value} onChange={onChange}>
      <Label>{label}</Label>
      <Input type={type} autoComplete={autoComplete} placeholder={placeholder} />
    </TextField>
  );
}

export function SettingChoiceField({ label, value, options, onChange, isDisabled }: SelectProps) {
  return (
    <div className="setting-field">
      <span>{label}</span>
      <div className="setting-choice-row setting-preset-row" role="group" aria-label={label}>
        {options.map((option) => (
          <Button key={option.id} size="sm" className="h-8" aria-pressed={value === option.id} isDisabled={isDisabled}
            variant={value === option.id ? "primary" : "secondary"} onPress={() => onChange(option.id)}>
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
