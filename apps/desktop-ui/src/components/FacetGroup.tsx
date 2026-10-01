import { CaretDownIcon, CaretUpIcon, CheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FacetOptionDto } from "../types";

// 筛选分组卡片对应 macOS 的 FacetDisclosureGroupView：标题栏可折叠，选项以可换行的标签流展示。
export function FacetGroup({
  title,
  options,
  selected,
  defaultOpen = false,
  onToggle,
}: {
  title: string;
  options: FacetOptionDto[];
  selected: string[];
  defaultOpen?: boolean;
  onToggle: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultOpen);
  return (
    <div className="facet-group">
      <button
        type="button"
        className="facet-group-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="facet-group-title">{title}</span>
        <span className="facet-group-chevron" aria-hidden="true">
          {expanded ? <CaretUpIcon /> : <CaretDownIcon />}
        </span>
      </button>
      {expanded && (
        <div className="facet-chips">
          {options.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`facet-chip${isSelected ? " selected" : ""}`}
                aria-pressed={isSelected}
                aria-label={t("filters.facetOption", { name: option.label, count: option.familyCount })}
                title={option.label}
                onClick={() => onToggle(option.value)}
              >
                {isSelected && (
                  <span className="facet-chip-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                )}
                <span className="facet-chip-label">{option.label}</span>
                <span className="facet-chip-count">{option.familyCount}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
