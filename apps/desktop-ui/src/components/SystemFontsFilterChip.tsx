import { CheckIcon } from "@phosphor-icons/react";
import { Tooltip } from "@heroui/react";
import type { ButtonHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

// 隐藏系统字体在 Tauri 端只保留跨端同步状态，外观与筛选标签一致，并通过提示说明 macOS 限制。
export function SystemFontsFilterChip({ isSelected }: { isSelected: boolean }) {
  const { t } = useTranslation();
  const label = t("filters.hideSystemFonts");
  return (
    <div className="facet-group system-fonts-filter">
      <Tooltip>
        <Tooltip.Trigger
          render={(props) => (
            <button
              {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
              type="button"
              className={`facet-chip system-fonts-chip${isSelected ? " selected" : ""}`}
              aria-disabled="true"
              aria-pressed={isSelected}
              aria-label={label}
            >
              {isSelected && (
                <span className="facet-chip-check" aria-hidden="true">
                  <CheckIcon />
                </span>
              )}
              <span className="facet-chip-label">{label}</span>
              <FinderMark />
            </button>
          )}
        />
        <Tooltip.Content>{t("filters.macosOnlyTooltip")}</Tooltip.Content>
      </Tooltip>
    </div>
  );
}

function FinderMark() {
  return (
    <svg
      className="system-fonts-chip-icon"
      viewBox="0 0 490 491"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M350.165 5.32715C394.148 5.32715 427.933 17.0352 450.45 39.5527C473.235 62.2427 484.848 96.1057 484.848 139.934V350.493C484.848 394.32 473.158 428.338 450.45 450.873C428.183 473.14 394.148 485.175 350.165 485.175H139.683C95.6998 485.175 62.0695 473.295 39.4746 450.873C16.6123 428.183 5 394.32 5 350.493V139.934C5 96.1058 16.8623 62.1652 39.4746 39.5527C61.6645 17.5353 95.6998 5.32722 139.683 5.32715H350.165ZM139.683 36.2002C105.66 36.2003 79.377 45.3375 62.3271 62.4824C44.9147 79.7223 35.9502 105.816 35.9502 139.934V350.493C35.9502 384.86 44.9148 410.875 62.3271 428.115C79.5495 445.26 105.66 454.226 139.683 454.226H246.375C242.023 444.948 239.75 433.596 239.75 420.25V399.198C189.407 398.175 139.257 381.708 109.25 350.25C102.25 343 103.75 335 108.25 330C113 325 121.75 323.25 129.75 330C159.158 356.539 199.543 370.271 239.75 371.419V303.75H217C186.5 303.75 164.5 282.25 176.5 240.75L228 55C230.008 47.8489 232.288 41.6108 234.899 36.2002H139.683ZM288.001 36.2002L288 36.25C272.5 36.25 264 45 259 63L207.25 252.75C204.25 263.5 209.25 271 220.25 271H272.5V369.58C305.524 364.89 336.72 351.618 360.5 330C368 323 377 324.75 382 330.25C386.5 335.25 387.75 343.25 380.75 350.25C355.235 376.999 315.156 392.906 272.5 397.699V422.5C272.5 444.118 285.48 453.698 299.975 454.226H350.165C384.36 454.226 410.47 445.088 427.693 428.115C445.105 410.875 454.148 384.86 454.148 350.493V139.934C454.148 105.816 445.105 79.7223 427.693 62.4824C410.298 45.1649 384.36 36.2002 350.165 36.2002H288.001ZM127.25 123C135.25 123 141.25 129.25 141.25 137V184C141.25 191.75 135.25 197.75 127.25 197.75C119.5 197.75 113.5 191.75 113.5 184V137C113.5 129.25 119.5 123 127.25 123ZM350.75 123C358.5 123 364.5 129.25 364.5 137V184C364.5 191.75 358.5 197.75 350.75 197.75C343 197.75 336.75 191.75 336.75 184V137C336.75 129.25 343 123 350.75 123Z"
        fill="currentColor"
        fillOpacity="0.85"
      />
    </svg>
  );
}
