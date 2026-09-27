import { Fragment, type CSSProperties, type KeyboardEvent } from "react";

export type SegmentedTabItem<Key extends string> = {
  id: Key;
  title: string;
};

type SegmentedTabsProps<Key extends string> = {
  items: SegmentedTabItem<Key>[];
  selectedKey: Key;
  onSelectionChange: (key: Key) => void;
  panelId: string;
  tabIdPrefix: string;
  ariaLabel: string;
  className?: string;
};

export function SegmentedTabs<Key extends string>({
  items,
  selectedKey,
  onSelectionChange,
  panelId,
  tabIdPrefix,
  ariaLabel,
  className = "",
}: SegmentedTabsProps<Key>) {
  if (items.length === 0) return null;

  const selectedIndex = Math.max(
    0,
    items.findIndex(({ id }) => id === selectedKey),
  );

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const nextIndex =
      event.key === "ArrowRight"
        ? (currentIndex + 1) % items.length
        : event.key === "ArrowLeft"
          ? (currentIndex - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : currentIndex;

    if (nextIndex === currentIndex || !items[nextIndex]) return;

    event.preventDefault();
    onSelectionChange(items[nextIndex].id);
    const nextTab = event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>("[role='tab']")
      .item(nextIndex);
    nextTab?.focus();
  };

  return (
    <div
      className={`view-picker segmented-tabs ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
      style={{ "--segmented-tab-count": items.length } as CSSProperties}
    >
      <span
        className="view-picker-thumb"
        aria-hidden="true"
        style={{ transform: `translateX(${selectedIndex * 100}%)` }}
      />
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index > 0 && (
            <span className="view-picker-divider" aria-hidden="true" />
          )}
          <button
            id={`${tabIdPrefix}-${item.id}`}
            type="button"
            role="tab"
            aria-selected={selectedKey === item.id}
            aria-controls={panelId}
            tabIndex={selectedKey === item.id ? 0 : -1}
            onClick={() => onSelectionChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {item.title}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
