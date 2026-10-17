import { Button } from '@heroui/react';
import { CheckIcon } from '@phosphor-icons/react';
import { isValidElement, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type CopyButtonProps = Pick<ComponentProps<typeof Button>, 'className' | 'size' | 'variant' | 'isDisabled'> & {
  value: string; identity?: string; label: string; icon: ReactNode; iconOnly?: boolean; vertical?: boolean; errorKey?: string;
};

// 内容身份变化时重建反馈，避免旧请求污染新字体或字符。
export function CopyButton({ identity, ...props }: CopyButtonProps) {
  return <CopyButtonContent key={JSON.stringify([identity, props.value])} {...props} />;
}

function CopyButtonContent({ value, label, icon, iconOnly = false, vertical = false, errorKey = 'desktop.copyFailedClipboard', ...buttonProps }: CopyButtonProps) {
  const { t } = useTranslation();
  const iconStyle = isValidElement<{ className?: string; size?: number | string }>(icon) ? icon.props : {};
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = useRef(false);
  const pending = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; clearTimeout(timer.current); };
  }, []);
  useLayoutEffect(() => {
    if (!iconOnly || !copied) return;
    const place = () => {
      if (!button.current || !hint.current) return;
      const rect = button.current.getBoundingClientRect();
      const tip = hint.current;
      const gap = parseFloat(getComputedStyle(tip).fontSize) / 2;
      tip.style.left = `${Math.max(gap, Math.min(rect.left - tip.offsetWidth - gap, innerWidth - tip.offsetWidth - gap))}px`;
      tip.style.top = `${Math.max(gap, Math.min(rect.top + (rect.height - tip.offsetHeight) / 2, innerHeight - tip.offsetHeight - gap))}px`;
      tip.style.visibility = 'visible';
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (hint.current) observer.observe(hint.current);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [copied, iconOnly, t]);
  async function copy() {
    if (pending.current || buttonProps.isDisabled) return;
    pending.current = true;
    try {
      await navigator.clipboard.writeText(value);
      if (!active.current) return;
      clearTimeout(timer.current);
      setError(''); setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (active.current) { clearTimeout(timer.current); setCopied(false); setError(t(errorKey)); }
    } finally { pending.current = false; }
  }
  return <>
    <Button {...buttonProps} ref={button} isIconOnly={iconOnly} aria-label={copied ? t('common.copied') : label} onPress={() => void copy()}>
      <span className={`copy-feedback${vertical ? ' copy-feedback-vertical' : ''}`} data-copied={copied} aria-hidden="true">
        <span className="copy-feedback-normal">{icon}{!iconOnly && <span>{label}</span>}</span>
        <span className="copy-feedback-success"><CheckIcon className={iconStyle.className} size={iconStyle.size} />{!iconOnly && <span>{t('common.copied')}</span>}</span>
      </span>
    </Button>
    <span className="sr-only" role="status">{copied ? t('common.copied') : ''}</span>
    {error && <span className={iconOnly ? 'sr-only' : 'text-xs text-danger'} role="alert">{error}</span>}
    {iconOnly && createPortal(<span ref={hint} className="copy-feedback-hint" data-copied={copied} aria-hidden="true">{t('common.copied')}</span>, document.body)}
  </>;
}
