import { Button } from "@heroui/react";
import { ArrowClockwiseIcon, BookmarkIcon, CaretRightIcon, CloudArrowDownIcon, CloudArrowUpIcon, CloudCheckIcon, CloudIcon, HardDrivesIcon, LassoIcon, StethoscopeIcon, TrayArrowUpIcon, WarningIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { HeroAction, HeroKind, HeroPresentation } from "../library-hero";

const heroIcons = {
  normal: LassoIcon,
  damaged: StethoscopeIcon,
  update: TrayArrowUpIcon,
  cloudAhead: CloudArrowDownIcon,
  localUnsynced: CloudArrowUpIcon,
  cloudStorageLow: HardDrivesIcon,
  conflict: BookmarkIcon,
} satisfies Record<HeroKind, typeof LassoIcon>;

export function LibraryHero({ presentation, onAction }: { presentation: HeroPresentation; onAction: (action: HeroAction) => void }) {
  const { t } = useTranslation();
  const Icon = heroIcons[presentation.kind];
  const SyncIcon = presentation.sync.state === "running" || presentation.sync.state === "checking" ? ArrowClockwiseIcon
    : presentation.sync.state === "error" ? WarningIcon
    : presentation.sync.state === "synced" ? CloudCheckIcon : CloudIcon;
  const comma = presentation.kind === "normal" ? presentation.title.indexOf("，") : -1;
  const title = <span>{comma >= 0 ? <>{presentation.title.slice(0, comma + 1)}<span className="library-hero-ready">{presentation.title.slice(comma + 1)}</span></> : presentation.title}</span>;
  const sync = <><span className="library-hero-sync-icon-slot" aria-hidden="true"><SyncIcon className="library-hero-sync-icon" size={16} /></span><span>{presentation.sync.text}</span></>;

  return (
    <div className="library-hero-container w-full max-w-[946px] shrink-0">
      <header className="library-hero flex w-full justify-center p-[10px]" data-kind={presentation.kind}>
        <div className="flex w-full min-w-0 max-w-[648px] flex-col items-start">
          <div className="library-hero-title-row flex w-full items-center gap-[6px] px-[2px]">
            <span className="library-hero-icon-slot"><Icon className="library-hero-icon" size={24} aria-hidden="true" /></span>
            <h1 className="library-hero-heading m-0 min-w-0 text-2xl font-medium leading-8">
              {presentation.action ? (
                <Button variant="tertiary" className="library-hero-action" aria-label={`${presentation.title}，${presentation.actionLabel ?? t("mobile.viewDetails")}`} onPress={() => onAction(presentation.action!)}>
                  {title}<CaretRightIcon className="library-hero-chevron" size={16} aria-hidden="true" />
                </Button>
              ) : title}
            </h1>
          </div>
          <p className="library-hero-subtitle m-0 w-full pl-1 text-2xl font-normal leading-8 text-muted">{presentation.subtitle}</p>
          <div className="library-hero-sync w-full pt-2 pl-1 text-[13px] font-semibold leading-8 text-muted" data-state={presentation.sync.state}>
            {presentation.sync.action ? (
              <Button variant="tertiary" className="library-hero-sync-action" onPress={() => onAction(presentation.sync.action!)}>{sync}</Button>
            ) : <span className="flex items-start gap-1" role="status" aria-live="polite">{sync}</span>}
          </div>
          {presentation.detail && <p className="m-0 flex w-full items-start gap-1 pl-1 text-[13px] font-semibold leading-8 text-muted"><LassoIcon size={16} className="mt-2 shrink-0" aria-hidden="true" /><span>{presentation.detail}</span></p>}
        </div>
      </header>
    </div>
  );
}
