import { Button, Card, Input, Label, ListBox, SearchField, Select, Toolbar } from '@heroui/react';
import { CopyIcon, HashIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CharacterMapSession, characterMapError, characterPageSize, characterText, codepointLabel,
  type CharacterEntry, type CharacterGlyph, type CharacterMapInfo, type CharacterPage } from '../../../../shared/character-map';
import { characterMap } from '../api';
import { previewStyles, type PreviewStyle } from '../font-preview';
import type { FamilyDto } from '../types';
import { ClaralightSlider } from './ClaralightSlider';

export function CharacterMap({ family, initialStyle, onClose, onDownload, leftHost, rightHost, toolbarHost, renderInspector }: {
  family: FamilyDto; initialStyle: PreviewStyle; onClose: () => void; onDownload: (fingerprint: string) => void;
  leftHost?: HTMLElement | null; rightHost?: HTMLElement | null; toolbarHost?: HTMLElement | null;
  renderInspector?: (style: PreviewStyle, controls: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation();
  const styles = previewStyles(family);
  const [style, setStyle] = useState(initialStyle);
  const face = family.faces.find((face) => face.id === style.face.id) ?? style.face;
  const sources = face.sources;
  const [sourcePath, setSource] = useState(sources[0]?.path ?? '');
  const source = sourcePath || sources[0]?.path || '';
  const [axes, setAxes] = useState(initialStyle.coordinates);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; session: CharacterMapSession; info: CharacterMapInfo } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const selectionKey = JSON.stringify([style.face.id, face.revisionId, source, retry]);
  const active = loaded?.key === selectionKey ? loaded : null;
  useEffect(() => {
    let current = true;
    const session = new CharacterMapSession(characterMap);
    const opening = !source && face.location?.cloudAvailable ? Promise.reject(new Error('characterMap.error.notDownloaded')) : session.open({ faceId: style.face.id, revisionId: face.revisionId, sourcePath: source });
    opening.then((info) => {
      if (current && info) setLoaded({ key: selectionKey, session, info });
    }).catch((cause) => { if (current) setError({ key: selectionKey, message: characterMapError(cause) }); });
    return () => { current = false; session.close(); };
  }, [selectionKey, style.face.id, face.revisionId, source, face.location?.cloudAvailable]);
  const failure = error?.key === selectionKey ? error.message : null;
  const [count, setCount] = useState<{ handle: string; total: number } | null>(null);
  const controls = <div className="character-map-controls">
          <div className="flex flex-col gap-4">
            <MapSelect label={t('font.styles')} value={style.key} options={styles.map((item) => ({ id: item.key, label: item.name }))} onChange={(key) => {
              const next = styles.find((item) => item.key === key)!;
              setStyle(next); setSource(next.face.sources[0]?.path ?? ''); setAxes(next.coordinates);
            }} />
            {sources.length > 0 && <MapSelect label={t('inspector.source')} value={source} options={sources.map((item) => ({ id: item.path, label: item.path }))} onChange={setSource} />}
          </div>
          {face.variableAxes.length > 0 && <div className="flex flex-col gap-4">
            {face.variableAxes.filter((axis) => axis.maxValue > axis.minValue).map((axis) => <label key={axis.tag} className="flex flex-col gap-2">
              <span>{axis.tag} {axes[axis.tag] ?? axis.defaultValue}</span>
              <ClaralightSlider aria-label={axis.tag} className="flex-1" min={axis.minValue} max={axis.maxValue}
                step={(axis.maxValue - axis.minValue) / 1000} value={axes[axis.tag] ?? axis.defaultValue}
                onValueChange={(value) => setAxes((values) => ({ ...values, [axis.tag]: value }))} />
            </label>)}
          </div>}
  </div>;
  const inspector = renderInspector?.({ ...style, face: { ...face, sources: sources.filter((item) => item.path === source) }, coordinates: axes }, controls) ?? controls;
  const heading = <header className="character-map-heading flex items-center gap-4">
    <Button autoFocus variant="secondary" onPress={onClose}>{t('common.back')}</Button>
    <div className="min-w-0 flex flex-col">
      <h1 className="text-lg font-semibold">{family.displayName}</h1>
      <p className="text-sm text-muted" role="status">{active ? t('characterMap.count', { count: count?.handle === active.info.handle ? count.total : active.info.count }) : t('common.loading')}</p>
    </div>
  </header>;
  return <section className="character-map-page" aria-label={t('characterMap.title')} onKeyDown={(event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="listbox"], [role="menu"]')) { event.preventDefault(); onClose(); }
  }}>
    {toolbarHost ? createPortal(heading, toolbarHost) : heading}
    {leftHost ? createPortal(inspector, leftHost) : inspector}
    {failure ? <div role="alert" className="flex flex-wrap items-center gap-4"><p>{t(failure)}</p>
      <Button onPress={() => setRetry((value) => value + 1)}>{t('common.retry')}</Button>
      {face.location?.files.filter((file) => file.cloudAvailable && !file.localSources.length).map((file) =>
        <Button key={file.fingerprint} onPress={() => onDownload(file.fingerprint)}>{t('fontLocation.download')}</Button>)}
    </div> : active ? <CharacterMapContent key={active.info.handle} session={active.session} info={active.info} axes={axes} rightHost={rightHost} onCountChange={setCount} /> : <p role="status">{t('common.loading')}</p>}
  </section>;
}

function CharacterMapContent({ session, info, axes, rightHost, onCountChange }: { session: CharacterMapSession; info: CharacterMapInfo; axes: Record<string, number>; rightHost?: HTMLElement | null; onCountChange: (value: { handle: string; total: number }) => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [script, setScript] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const queryKey = JSON.stringify([search, script]);
  const requestKey = JSON.stringify([queryKey, offset, retry]);
  const [result, setResult] = useState<{ key: string; page: CharacterPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [selected, setSelected] = useState<CharacterEntry | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [foreground, setForeground] = useState<[number, number, number, number]>([0, 0, 0, 255]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      session.query({ text: search, script: script || null, offset, limit: characterPageSize }).then((page) => {
        if (current) {
          setResult((previous) => ({ key: queryKey, page: { ...page, entries: offset > 0 && previous?.key === queryKey ? [...previous.page.entries.slice(0, offset), ...page.entries] : page.entries } }));
          if (offset === 0) setSelected(page.entries[0] ?? null);
          onCountChange({ handle: info.handle, total: page.total });
        }
      }).catch((cause) => { if (current) setFailure({ key: requestKey, message: characterMapError(cause) }); });
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [session, queryKey, requestKey, search, script, offset, info.handle, onCountChange]);
  useLayoutEffect(() => {
    const measure = () => {
      if (!root.current) return;
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = getComputedStyle(root.current).color; context.fillRect(0, 0, 1, 1);
      const rgba = Array.from(context.getImageData(0, 0, 1, 1).data) as [number, number, number, number];
      setForeground((previous) => previous.every((value, index) => value === rgba[index]) ? previous : rgba);
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    const media = matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', measure);
    return () => { observer.disconnect(); media.removeEventListener('change', measure); };
  }, []);
  const page = result?.key === queryKey ? result.page : null;
  const error = failure?.key === requestKey ? failure.message : null;
  const loading = !page || page.entries.length === offset;
  const loadMore = useCallback(() => {
    if (page && !loading && !error && page.entries.length < page.total) setOffset(page.entries.length);
  }, [page, loading, error]);
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopyStatus(t('common.copied')); }
    catch { setCopyStatus(t('characterMap.error.copyFailed')); }
  }
  const detail = <aside className="character-map-detail flex w-full flex-col gap-4" aria-label={t('characterMap.title')}>
        {selected && page ? <>
          <div className="relative min-h-32 flex-1">
            <GlyphPreview key={`${selected.glyphId}:${JSON.stringify(axes)}:${foreground}`} session={session} entry={selected} axes={axes} foreground={foreground} size={512} />
          </div>
          <footer className="flex shrink-0 flex-col gap-4">
            <dl className="flex min-w-0 flex-col gap-1 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="sr-only">{t('characterMap.codepoint')}</dt><dd className="font-mono">{codepointLabel(selected.codepoint)}</dd>
                <dt className="sr-only">{t('filters.script')}</dt><dd className="min-w-0 break-words text-muted">{selected.script}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                <dt>{t('characterMap.glyphId')}</dt><dd className="font-mono">{selected.glyphId}</dd>
              </div>
            </dl>
            <Toolbar className="grid grid-cols-2 gap-2" aria-label={t('characterMap.title')}>
              <Button size="sm" variant="ghost" className="h-auto min-w-0 flex-col gap-1 py-2 whitespace-normal" onPress={() => void copy(characterText(selected))}>
                <CopyIcon className="size-5" aria-hidden="true" />{t('characterMap.copyCharacter')}
              </Button>
              <Button size="sm" variant="ghost" className="h-auto min-w-0 flex-col gap-1 py-2 whitespace-normal" onPress={() => void copy(codepointLabel(selected.codepoint))}>
                <HashIcon className="size-5" aria-hidden="true" />{t('characterMap.copyCodepoint')}
              </Button>
            </Toolbar>
            <p className="empty:hidden text-xs text-muted" role="status">{copyStatus}</p>
          </footer>
        </> : <p className="flex flex-1 items-center justify-center text-sm text-muted">{t('characterMap.selectCharacter')}</p>}
      </aside>;
  return <div ref={root} className="character-map-content">
    {rightHost && createPortal(detail, rightHost)}
    <div className="flex flex-wrap items-center gap-4">
      <SearchField aria-label={t('characterMap.search')} value={search} onChange={(value) => { setSearch(value); setOffset(0); }}>
        <Input placeholder={t('characterMap.search')} />
      </SearchField>
      <MapSelect label={t('filters.script')} value={script} options={[{ id: '', label: t('characterMap.allScripts') }, ...info.scripts.map((item) => ({ id: item.name, label: `${item.name} (${item.count})` }))]}
        onChange={(value) => { setScript(value); setOffset(0); }} />
    </div>
    {error && <div role="alert" className="flex items-center gap-4"><p>{t(error)}</p><Button onPress={() => setRetry((value) => value + 1)}>{t('common.retry')}</Button></div>}
    <div className="character-map-panels" data-external-details={!!rightHost}>
      {page ? <CharacterGrid key={queryKey} entries={page.entries} selected={selected} onSelect={setSelected} session={session} axes={axes} foreground={foreground} onLoadMore={loadMore} /> : <p role="status">{!error && t('common.loading')}</p>}
      {!rightHost && detail}
    </div>
    {page && loading && !error && <p role="status">{t('common.loading')}</p>}
  </div>;
}

function CharacterGrid({ entries, selected, onSelect, session, axes, foreground, onLoadMore }: {
  entries: CharacterEntry[]; selected: CharacterEntry | null; onSelect: (entry: CharacterEntry) => void;
  session: CharacterMapSession; axes: Record<string, number>; foreground: [number, number, number, number]; onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, top: 0, stride: 96 });
  const { stride } = viewport;
  const columns = Math.max(1, Math.floor(viewport.width / stride));
  useEffect(() => {
    if (viewport.height > 0 && viewport.top + viewport.height + stride * 2 >= Math.ceil(entries.length / columns) * stride) onLoadMore();
  }, [viewport, entries.length, columns, stride, onLoadMore]);
  const first = Math.max(0, Math.floor(viewport.top / stride) - 1);
  const last = Math.min(Math.ceil(entries.length / columns), Math.ceil((viewport.top + viewport.height) / stride) + 1);
  const visible = useMemo(() => entries.slice(first * columns, last * columns), [entries, first, last, columns]);
  const [images, setImages] = useState<{ key: string; values: CharacterGlyph[] } | null>(null);
  const renderKey = JSON.stringify([axes, foreground, visible.map((entry) => entry.glyphId)]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const cell = element.querySelector<HTMLElement>('.character-map-cell');
      setViewport((value) => ({ ...value, width: element.clientWidth, height: element.clientHeight,
        stride: cell ? parseFloat(getComputedStyle(cell).height) || 96 : 96 }));
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let current = true;
    const glyphIds = [...new Set(visible.map((entry) => entry.glyphId))];
    if (!glyphIds.length) return;
    session.render({ glyphIds, axes, foreground, size: 128 }).then((values) => { if (current) setImages({ key: renderKey, values }); })
      .catch((cause) => { if (current) setImages({ key: renderKey, values: glyphIds.map((glyphId) => ({ glyphId, status: 'error', dataUrl: null, error: characterMapError(cause) })) }); });
    return () => { current = false; };
  }, [session, renderKey, axes, foreground, visible]);
  const byGlyph = useMemo(() => new Map((images?.key === renderKey ? images.values : []).map((value) => [value.glyphId, value])), [images, renderKey]);
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const index = entries.findIndex((entry) => entry.codepoint === selected?.codepoint);
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, Home: -entries.length, End: entries.length };
    if (!(event.key in delta) || !entries.length) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(entries.length - 1, index + delta[event.key]!));
    onSelect(entries[next]!);
    const element = root.current;
    if (!element) return;
    const top = Math.floor(next / columns) * stride;
    if (top < element.scrollTop) element.scrollTop = top;
    if (top + stride > element.scrollTop + element.clientHeight) element.scrollTop = top + stride - element.clientHeight;
    setViewport((value) => ({ ...value, top: element.scrollTop }));
    requestAnimationFrame(() => element.querySelector<HTMLElement>(`[data-codepoint="${entries[next]!.codepoint}"]`)?.focus());
  }
  return <div ref={root} className="character-map-grid" role="group" aria-label={t('characterMap.title')} onKeyDown={move}
    onScroll={(event) => { const top = event.currentTarget.scrollTop; setViewport((value) => ({ ...value, top })); }}>
    {!entries.length && <p>{t('characterMap.empty')}</p>}
    <div style={{ height: Math.ceil(entries.length / columns) * stride, position: 'relative' }}>
      <div style={{ position: 'absolute', top: first * stride, width: '100%', display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {visible.map((entry) => {
          const image = byGlyph.get(entry.glyphId);
          return <Card key={entry.codepoint} variant="secondary" data-mode="compact" className={`font-card character-map-cell${selected?.codepoint === entry.codepoint ? ' selected' : ''}`}>
            <Button data-codepoint={entry.codepoint} className="font-card-select" variant="ghost"
              aria-label={t('characterMap.characterLabel', { codepoint: codepointLabel(entry.codepoint), glyphId: entry.glyphId, script: entry.script })}
              aria-pressed={selected?.codepoint === entry.codepoint} excludeFromTabOrder={selected?.codepoint !== entry.codepoint} onPress={() => onSelect(entry)}>
              <span className="sr-only">{codepointLabel(entry.codepoint)}</span>
            </Button>
            <div className="pointer-events-none flex min-h-0 flex-1 flex-col items-center justify-center gap-0">
              {image?.dataUrl && <img src={image.dataUrl} alt="" className="h-16 w-16 min-h-0 object-contain" />}
              <span className="text-xs text-muted">{codepointLabel(entry.codepoint)}</span>
              {image?.status === 'error' && <span className="sr-only">{t(image.error ?? 'characterMap.error.renderFailed')}</span>}
            </div>
          </Card>;
        })}
      </div>
    </div>
  </div>;
}

function GlyphPreview({ session, entry, axes, foreground, size }: { session: CharacterMapSession; entry: CharacterEntry; axes: Record<string, number>; foreground: [number, number, number, number]; size: number }) {
  const { t } = useTranslation();
  const [image, setImage] = useState<CharacterGlyph | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    session.render({ glyphIds: [entry.glyphId], axes, foreground, size }).then((values) => { if (current) setImage(values[0] ?? null); })
      .catch((cause) => { if (current) setImage({ glyphId: entry.glyphId, status: 'error', dataUrl: null, error: characterMapError(cause) }); });
    return () => { current = false; };
  }, [session, entry.glyphId, axes, foreground, size, retry]);
  return <div className="absolute inset-0 flex flex-col items-center justify-center" aria-live="polite">
    {image?.dataUrl && <img src={image.dataUrl} alt={codepointLabel(entry.codepoint)} className="h-full min-h-0 w-full object-contain" />}
    {image?.status === 'empty' && <p>{t('characterMap.blankGlyph')}</p>}
    {image?.status === 'error' && <><p role="alert">{t(image.error ?? 'characterMap.error.renderFailed')}</p><Button variant="secondary" onPress={() => setRetry((value) => value + 1)}>{t('common.retry')}</Button></>}
    {!image && <p>{t('common.loading')}</p>}
  </div>;
}

function MapSelect({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (value: string) => void }) {
  return <Select aria-label={label} selectedKey={value || '__all__'} onSelectionChange={(key) => { if (key != null) onChange(key === '__all__' ? '' : String(key)); }}>
    <Label>{label}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
    <Select.Popover><ListBox>{options.map((option) => <ListBox.Item key={option.id || '__all__'} id={option.id || '__all__'} textValue={option.label}>{option.label}</ListBox.Item>)}</ListBox></Select.Popover>
  </Select>;
}
