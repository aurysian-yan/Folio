import { Button, Card, Input, Label, ListBox, SearchField, Select, Toolbar } from '@heroui/react';
import { CaretLeftIcon, CopyIcon, HashIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CharacterMapSession, characterMapError, characterPageSize, characterText, codepointLabel,
  type CharacterEntry, type CharacterGlyph, type CharacterMapInfo, type CharacterPage } from '../../../../shared/character-map';
import { CharacterPreviewRenderer, characterMatchesQuery, firstNonEmptyCharacter, mergeCharacterPage, renderCharacterAxisTransition } from '../../../../shared/character-preview';
import { characterMap } from '../api';
import { previewStyles, type PreviewStyle } from '../font-preview';
import type { FamilyDto } from '../types';
import { CopyButton } from './CopyButton';
import { ClaralightSlider } from './ClaralightSlider';

// 字符网格与 CSS 共用同一组几何参数，虚拟化步长包含行列间距。
const characterCellMinimum = 88;
const characterCellGap = 8;
const characterCellFallback = 96;

export function CharacterMap({ family, initialStyle, onClose, onDownload, leftHost, rightHost, renderInspector, autoSelectFirstNonEmpty = true }: {
  autoSelectFirstNonEmpty?: boolean;
  family: FamilyDto; initialStyle: PreviewStyle; onClose: () => void; onDownload: (fingerprint: string) => void;
  leftHost?: HTMLElement | null; rightHost?: HTMLElement | null;
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
  const [committedAxes, setCommittedAxes] = useState(initialStyle.coordinates);
  const [adjusting, setAdjusting] = useState(false);
  const editing = useRef(false);
  const updateAxes = (next: Record<string, number>) => {
    setAxes(next);
    if (!editing.current) setCommittedAxes(next);
  };
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
    <div className="character-map-control-group">
      <MapSelect label={t('font.styles')} value={style.key} options={styles.map((item) => ({ id: item.key, label: item.name }))} onChange={(key) => {
        const next = styles.find((item) => item.key === key)!;
        setStyle(next); setSource(next.face.sources[0]?.path ?? ''); editing.current = false; setAdjusting(false); updateAxes(next.coordinates);
      }} />
      {sources.length > 0 && <MapSelect label={t('inspector.source')} value={source} options={sources.map((item) => ({ id: item.path, label: item.path }))} onChange={setSource} />}
    </div>
    {face.variableAxes.filter((axis) => axis.maxValue > axis.minValue).length > 0 && <div className="character-map-control-group character-map-axes">
      {face.variableAxes.filter((axis) => axis.maxValue > axis.minValue).map((axis) => <label key={axis.tag} className="character-map-axis">
        <span className="character-map-axis-heading">
          <span>{axis.tag}</span>
          <span>{axes[axis.tag] ?? axis.defaultValue}</span>
        </span>
        <ClaralightSlider aria-label={axis.tag} className="flex-1" min={axis.minValue} max={axis.maxValue}
          step={(axis.maxValue - axis.minValue) / 1000} value={axes[axis.tag] ?? axis.defaultValue}
          onValueChangeStart={() => { editing.current = true; setAdjusting(true); }}
          onValueChangeEnd={(value) => { editing.current = false; setAdjusting(false); setCommittedAxes({ ...axes, [axis.tag]: value }); }}
          onValueChange={(value) => updateAxes({ ...axes, [axis.tag]: value })} />
      </label>)}
    </div>}
  </div>;
  const inspector = renderInspector?.({ ...style, face: { ...face, sources: sources.filter((item) => item.path === source) }, coordinates: axes }, controls) ?? controls;
  const heading = <header className="character-map-header">
    <Button autoFocus isIconOnly variant="tertiary" className="character-map-back" aria-label={t('common.back')} onPress={onClose}>
      <CaretLeftIcon aria-hidden="true" />
    </Button>
    <div className="character-map-heading">
      <h1>{family.displayName}</h1>
      <p role="status">{active ? t('characterMap.count', { count: count?.handle === active.info.handle ? count.total : active.info.count }) : t('common.loading')}</p>
    </div>
  </header>;
  return <section className="character-map-page" aria-label={t('characterMap.title')} onKeyDown={(event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="listbox"], [role="menu"]')) { event.preventDefault(); onClose(); }
  }}>
    {heading}
    {leftHost ? createPortal(inspector, leftHost) : inspector}
    {failure ? <div role="alert" className="flex flex-wrap items-center gap-4"><p>{t(failure)}</p>
      <Button onPress={() => setRetry((value) => value + 1)}>{t('common.retry')}</Button>
      {face.location?.files.filter((file) => file.cloudAvailable && !file.localSources.length).map((file) =>
        <Button key={file.fingerprint} onPress={() => onDownload(file.fingerprint)}>{t('fontLocation.download')}</Button>)}
    </div> : active ? <CharacterMapContent key={active.info.handle} session={active.session} info={active.info} axes={axes} committedAxes={committedAxes} axisDefaults={Object.fromEntries(face.variableAxes.map((axis) => [axis.tag, axis.defaultValue]))} adjusting={adjusting} autoSelectFirstNonEmpty={autoSelectFirstNonEmpty} rightHost={rightHost} onCountChange={setCount} /> : <p role="status">{t('common.loading')}</p>}
  </section>;
}

function CharacterMapContent({ session, info, axes, committedAxes, axisDefaults, adjusting, autoSelectFirstNonEmpty, rightHost, onCountChange }: { committedAxes: Record<string, number>; axisDefaults: Record<string, number>; adjusting: boolean; autoSelectFirstNonEmpty: boolean; session: CharacterMapSession; info: CharacterMapInfo; axes: Record<string, number>; rightHost?: HTMLElement | null; onCountChange: (value: { handle: string; total: number }) => void }) {
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
  const selectedRef = useRef<CharacterEntry | null>(null);
  const autoGeneration = useRef(0);
  const renderer = useMemo(() => new CharacterPreviewRenderer(session), [session]);
  useEffect(() => { renderer.retain(); return () => renderer.release(); }, [renderer]);
  useEffect(() => {
    autoGeneration.current += 1;
    renderer.cancel('auto-select');
    return () => { autoGeneration.current += 1; renderer.cancel('auto-select'); };
  }, [queryKey, autoSelectFirstNonEmpty, renderer]);
  function select(entry: CharacterEntry) {
    autoGeneration.current += 1;
    renderer.cancel('auto-select');
    selectedRef.current = entry;
    setSelected(entry);
  }
  const [foreground, setForeground] = useState<[number, number, number, number]>([0, 0, 0, 255]);
  const root = useRef<HTMLDivElement>(null);
  const initializeSelection = useEffectEvent((page: CharacterPage) => {
    const previous = selectedRef.current;
    if (previous && characterMatchesQuery(previous, search, script)) return;
    selectedRef.current = null;
    setSelected(null);
    const generation = ++autoGeneration.current;
    if (!autoSelectFirstNonEmpty) return;
    const current = () => generation === autoGeneration.current;
    void firstNonEmptyCharacter({ session, renderer, page, text: search, script, axes, foreground, current,
      onPage: (page) => setResult((previous) => previous?.key === queryKey && previous.page.entries.length > page.entries.length ? previous : { key: queryKey, page }),
    }).then((entry) => {
      if (current()) { selectedRef.current = entry; setSelected(entry); }
    }).catch((cause) => { if (current()) setFailure({ key: requestKey, message: characterMapError(cause) }); });
  });
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      session.query({ text: search, script: script || null, offset, limit: characterPageSize }).then((page) => {
        if (current) {
          setResult((previous) => ({ key: queryKey, page: mergeCharacterPage(previous?.key === queryKey ? previous.page : undefined, page, offset) }));
          if (offset === 0) initializeSelection(page);
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
  const detail = <aside className="character-map-detail" aria-label={t('characterMap.title')}>
        {selected && page ? <>
          <div className="character-map-detail-glyph">
            <GlyphPreview key={selected.codepoint} renderer={renderer} channel="detail" priority={3} entry={selected} axes={axes} foreground={foreground} size={512} />
          </div>
          <footer className="character-map-detail-meta">
            <dl className="character-map-character-info">
              <div className="character-map-codepoint">
                <dt className="sr-only">{t('characterMap.codepoint')}</dt><dd>{codepointLabel(selected.codepoint)}</dd>
                <dt className="sr-only">{t('filters.script')}</dt><dd className="character-map-script">{selected.script}</dd>
              </div>
              <div className="character-map-glyph-id">
                <dt>{t('characterMap.glyphId')}</dt><dd>{selected.glyphId}</dd>
              </div>
            </dl>
            <Toolbar className="character-map-copy-actions" aria-label={t('characterMap.title')}>
              <CopyButton size="sm" variant="ghost" vertical className="character-map-copy-button" identity={`${info.handle}:${selected.codepoint}`} value={characterText(selected)} label={t('characterMap.copyCharacter')} icon={<CopyIcon className="size-5" />} errorKey="characterMap.error.copyFailed" />
              <CopyButton size="sm" variant="ghost" vertical className="character-map-copy-button" identity={`${info.handle}:${selected.codepoint}`} value={codepointLabel(selected.codepoint)} label={t('characterMap.copyCodepoint')} icon={<HashIcon className="size-5" />} errorKey="characterMap.error.copyFailed" />
            </Toolbar>
          </footer>
        </> : <p className="character-map-detail-empty">{t('characterMap.selectCharacter')}</p>}
      </aside>;
  return <div ref={root} className="character-map-content">
    {rightHost && createPortal(detail, rightHost)}
    <div className="character-map-filters">
      <SearchField className="character-map-search" aria-label={t('characterMap.search')} value={search} onChange={(value) => { setSearch(value); setOffset(0); }}>
        <Input placeholder={t('characterMap.search')} />
      </SearchField>
      <div className="character-map-script-filter">
        <MapSelect label={t('filters.script')} value={script} options={[{ id: '', label: t('characterMap.allScripts') }, ...info.scripts.map((item) => ({ id: item.name, label: `${item.name} (${item.count})` }))]}
          onChange={(value) => { setScript(value); setOffset(0); }} />
      </div>
    </div>
    {error && <div role="alert" className="flex items-center gap-4"><p>{t(error)}</p><Button onPress={() => setRetry((value) => value + 1)}>{t('common.retry')}</Button></div>}
    <div className="character-map-panels" data-external-details={!!rightHost}>
      {page ? <CharacterGrid key={queryKey} entries={page.entries} selected={selected} onSelect={select} renderer={renderer} axes={axes} committedAxes={committedAxes} axisDefaults={axisDefaults} adjusting={adjusting} foreground={foreground} onLoadMore={loadMore} /> : <p role="status">{!error && t('common.loading')}</p>}
      {!rightHost && detail}
    </div>
    {page && loading && !error && <p role="status">{t('common.loading')}</p>}
  </div>;
}

function CharacterGrid({ entries, selected, onSelect, renderer, axes, committedAxes, axisDefaults, adjusting, foreground, onLoadMore }: {
  entries: CharacterEntry[]; selected: CharacterEntry | null; onSelect: (entry: CharacterEntry) => void;
  renderer: CharacterPreviewRenderer; axes: Record<string, number>; committedAxes: Record<string, number>; axisDefaults: Record<string, number>; adjusting: boolean; foreground: [number, number, number, number]; onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, top: 0, stride: characterCellFallback + characterCellGap });
  const { stride } = viewport;
  const columns = Math.max(1, Math.floor((viewport.width + characterCellGap) / (characterCellMinimum + characterCellGap)));
  useEffect(() => {
    if (viewport.height > 0 && viewport.top + viewport.height + stride * 2 >= Math.ceil(entries.length / columns) * stride) onLoadMore();
  }, [viewport, entries.length, columns, stride, onLoadMore]);
  const first = Math.max(0, Math.floor(viewport.top / stride) - 1);
  const last = Math.min(Math.ceil(entries.length / columns), Math.ceil((viewport.top + viewport.height) / stride) + 1);
  const visible = useMemo(() => entries.slice(first * columns, last * columns), [entries, first, last, columns]);
  const [images, setImages] = useState<Map<number, CharacterGlyph>>(() => new Map());
  const displayedAxes = useRef<Record<string, number> | null>(null);
  const defaults = useRef(axisDefaults);
  useLayoutEffect(() => { defaults.current = axisDefaults; }, [axisDefaults]);
  const [animatedImages, setAnimatedImages] = useState(false);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const columns = Math.max(1, Math.floor((width + characterCellGap) / (characterCellMinimum + characterCellGap)));
      const cellSize = width > 0 ? (width - (columns - 1) * characterCellGap) / columns : characterCellFallback;
      setViewport((value) => ({ ...value, width, height: element.clientHeight, stride: cellSize + characterCellGap }));
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (adjusting) { renderer.cancel('grid'); return; }
    let current = true;
    const glyphIds = [...new Set(visible.map((entry) => entry.glyphId))];
    if (!glyphIds.length) return;
    const accept = (values: CharacterGlyph[], animated = false) => {
      if (!current) return;
      setAnimatedImages(animated);
      setImages((previous) => {
        const next = new Map([...previous].filter(([id]) => glyphIds.includes(id)));
        for (const image of values) next.set(image.glyphId, image.status === 'error' && next.get(image.glyphId)?.dataUrl ? { ...image, dataUrl: next.get(image.glyphId)!.dataUrl } : image);
        return next;
      });
    };
    void renderCharacterAxisTransition(renderer, { glyphIds, axes: committedAxes, foreground, size: 128 }, {
      from: displayedAxes.current, defaults: defaults.current, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, current: () => current,
      onProgress: accept, onAxes: (axes) => { displayedAxes.current = axes; },
    }).catch((cause) => accept(glyphIds.map((glyphId) => ({ glyphId, status: 'error', dataUrl: null, error: characterMapError(cause) }))));
    return () => { current = false; renderer.cancel('grid'); };
  }, [renderer, committedAxes, foreground, visible, adjusting]);
  const selectedImage = useGlyphPreview({ renderer, channel: 'selected-cell', priority: 3, entry: selected, axes, foreground, size: 128 });
  const byGlyph = images;
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
    <div style={{ height: Math.max(0, Math.ceil(entries.length / columns) * stride - characterCellGap), position: 'relative' }}>
      <div className="character-map-grid-rows" style={{ top: first * stride, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {visible.map((entry) => {
          const image = selected?.codepoint === entry.codepoint ? selectedImage.image ?? byGlyph.get(entry.glyphId) : byGlyph.get(entry.glyphId);
          return <Card key={entry.codepoint} variant="secondary" data-mode="compact" className={`font-card character-map-cell${selected?.codepoint === entry.codepoint ? ' selected' : ''}`}>
            <Button data-codepoint={entry.codepoint} className="font-card-select" variant="ghost"
              aria-label={t('characterMap.characterLabel', { codepoint: codepointLabel(entry.codepoint), glyphId: entry.glyphId, script: entry.script })}
              aria-pressed={selected?.codepoint === entry.codepoint} excludeFromTabOrder={selected ? selected.codepoint !== entry.codepoint : visible[0]?.codepoint !== entry.codepoint} onPress={() => onSelect(entry)}>
              <span className="sr-only">{codepointLabel(entry.codepoint)}</span>
            </Button>
            <div className="pointer-events-none flex min-h-0 flex-1 flex-col items-center justify-center gap-0">
              <div className="relative h-16 w-16 min-h-0">
                <StableGlyphImage dataUrl={image?.dataUrl} alt="" animate={animatedImages && !adjusting && selected?.codepoint !== entry.codepoint} />
              </div>
              <span className="text-xs text-muted">{codepointLabel(entry.codepoint)}</span>
              {image?.status === 'error' && <span className="sr-only">{t(image.error ?? 'characterMap.error.renderFailed')}</span>}
            </div>
          </Card>;
        })}
      </div>
    </div>
  </div>;
}

// 新图片加载完成才替换旧图，空白结果显式清除已显示字形。
function StableGlyphImage({ dataUrl, alt, attempt = 0, onError, animate = false }: { animate?: boolean; dataUrl: string | null | undefined; alt: string; attempt?: number; onError?: () => void }) {
  const [decoded, setDecoded] = useState<string | null>(null);
  const [candidate, setCandidate] = useState(dataUrl ?? null);
  const [ready, setReady] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputKey = JSON.stringify([dataUrl, attempt]);
  const [observed, setObserved] = useState(inputKey);
  const latest = useRef(dataUrl);
  const mounted = useRef(false);
  // 解码通道只保留正在加载与最新地址，持续刷新仍能回显完成的中间帧。
  if (observed !== inputKey) {
    setObserved(inputKey);
    if (!candidate || candidate === decoded) { setCandidate(dataUrl && dataUrl !== decoded ? dataUrl : null); setReady(false); }
  }
  useLayoutEffect(() => { latest.current = dataUrl; }, [dataUrl]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (fadeTimer.current) clearTimeout(fadeTimer.current); }; }, []);
  const finish = (success: boolean) => {
    if (!mounted.current) return;
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    setReady(false);
    if (success && latest.current !== null) setDecoded(candidate);
    if (!success && latest.current === candidate) onError?.();
    setCandidate(latest.current && latest.current !== candidate ? latest.current : null);
  };
  const finishCurrentFade = useEffectEvent(() => { if (!animate && ready) finish(true); });
  useEffect(() => { finishCurrentFade(); }, [animate]);
  const previous = dataUrl === null ? null : decoded;
  return <>
    {previous && <img src={previous} alt={alt} className="h-full min-h-0 w-full object-contain" />}
    {candidate && candidate !== previous && <img key={`${candidate}:${attempt}`} src={candidate} alt="" aria-hidden="true"
      className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-75 ease-out motion-reduce:transition-none ${ready ? 'opacity-100' : 'opacity-0'}`} onError={() => finish(false)} onLoad={(event) => {
        const image = event.currentTarget;
        void (image.decode ? image.decode() : Promise.resolve()).then(() => {
          if (animate && previous && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setReady(true);
            fadeTimer.current = setTimeout(() => finish(true), 75);
          } else finish(true);
        }).catch(() => finish(false));
      }} />}
  </>;
}

function useGlyphPreview({ renderer, channel, priority, entry, axes, foreground, size }: {
  renderer: CharacterPreviewRenderer; channel: string; priority: number; entry: CharacterEntry | null; axes: Record<string, number>;
  foreground: [number, number, number, number]; size: number;
}) {
  const [result, setResult] = useState<{ codepoint: number; image: CharacterGlyph } | null>(null);
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const accepted = useRef(0);
  const identity = useRef(entry?.codepoint);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    identity.current = entry?.codepoint;
    renderer.cancel(channel);
  }, [renderer, channel, entry?.codepoint]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; renderer.cancel(channel); };
  }, [renderer, channel]);
  const codepoint = entry?.codepoint;
  const glyphId = entry?.glyphId;
  useEffect(() => {
    if (codepoint == null || glyphId == null) return;
    const request = ++sequence.current;
    const accept = (value: CharacterGlyph | undefined) => {
      if (!value || !mounted.current || identity.current !== codepoint || request < accepted.current) return;
      accepted.current = request;
      setResult((previous) => ({ codepoint, image: value.status === 'error' && previous?.codepoint === codepoint && previous.image.dataUrl ? { ...value, dataUrl: previous.image.dataUrl } : value }));
    };
    renderer.render({ glyphIds: [glyphId], axes, foreground, size }, { channel, priority }).then((values) => accept(values[0]))
      .catch((cause) => accept({ glyphId, status: 'error', dataUrl: null, error: characterMapError(cause) }));
  }, [renderer, channel, priority, glyphId, codepoint, axes, foreground, size, retry]);
  return { image: result?.codepoint === entry?.codepoint ? result?.image ?? null : null, attempt: retry, retry: () => setRetry((value) => value + 1),
    onDecodeError: () => setResult((previous) => previous ? { ...previous, image: { ...previous.image, status: 'error', error: 'characterMap.error.renderFailed' } } : previous) };
}

function GlyphPreview(props: {
  renderer: CharacterPreviewRenderer; channel: string; priority: number; entry: CharacterEntry; axes: Record<string, number>;
  foreground: [number, number, number, number]; size: number; compact?: boolean;
}) {
  const { t } = useTranslation();
  const { image, retry, attempt, onDecodeError } = useGlyphPreview(props);
  const { entry, compact = false } = props;
  return <div className="absolute inset-0 flex flex-col items-center justify-center" aria-live={compact ? 'off' : 'polite'}>
    <StableGlyphImage dataUrl={image?.dataUrl} attempt={attempt} onError={onDecodeError} alt={compact ? '' : codepointLabel(entry.codepoint)} />
    {!compact && image?.status === 'empty' && <p>{t('characterMap.blankGlyph')}</p>}
    {image?.status === 'error' && <><p role={compact ? undefined : 'alert'} className={compact ? 'sr-only' : undefined}>{t(image.error ?? 'characterMap.error.renderFailed')}</p>
      {!compact && <Button variant="secondary" onPress={retry}>{t('common.retry')}</Button>}</>}
    {!compact && !image && <p>{t('common.loading')}</p>}
  </div>;
}

function MapSelect({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (value: string) => void }) {
  return <Select aria-label={label} selectedKey={value || '__all__'} onSelectionChange={(key) => { if (key != null) onChange(key === '__all__' ? '' : String(key)); }}>
    <Label>{label}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
    <Select.Popover><ListBox>{options.map((option) => <ListBox.Item key={option.id || '__all__'} id={option.id || '__all__'} textValue={option.label}>{option.label}</ListBox.Item>)}</ListBox></Select.Popover>
  </Select>;
}
