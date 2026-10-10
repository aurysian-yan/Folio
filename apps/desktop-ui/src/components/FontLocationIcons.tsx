import { CloudIcon, DesktopIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export function FontLocationIcons({ local, cloud }: { local: boolean; cloud: boolean }) {
  const { t } = useTranslation();
  return <span className="font-location-icons">
    {local && <span role="img" aria-label={t("fontLocation.local")} title={t("fontLocation.local")}><DesktopIcon weight="fill" aria-hidden="true" /></span>}
    {cloud && <span role="img" aria-label={t("navigation.cloud")} title={t("navigation.cloud")}><CloudIcon weight="fill" aria-hidden="true" /></span>}
  </span>;
}
