import { Button, Input, Label, Modal, SearchField } from '@heroui/react';
import { ArrowLeftIcon, ArrowUpRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import content from '../../../shared/about/content.json';
import glyphs from '../../../shared/about/glyphs.json';
import licenses from '../../../shared/about/licenses.json';
import { checkForUpdate, WordmarkVariation, type AppInfo, type UpdateResult } from '../../../shared/about/update';
import { getAboutInfo, openAboutLink, requestRelease } from './api';

type LicenseEntry = typeof licenses.entries[number];

// 关于首页与离线许可阅读保持独立的滚动位置。
export function AboutView() {
  const { t, i18n } = useTranslation();
  const [app, setApp] = useState<AppInfo>();
  const [frame, setFrame] = useState(0);
  const [update, setUpdate] = useState<UpdateResult>({ status: 'idle' });
  const [reader, setReader] = useState(false);
  const [selected, setSelected] = useState<LicenseEntry>();
  const [query, setQuery] = useState('');
  const [linkError, setLinkError] = useState(false);
  const variation = useRef<WordmarkVariation | null>(null);
  const request = useRef<AbortController | null>(null);
  const listScroll = useRef<HTMLDivElement | null>(null);
  const listPosition = useRef(0);
  useLayoutEffect(() => {
    if (reader && !selected && listScroll.current) listScroll.current.scrollTop = listPosition.current;
  }, [reader, selected]);
  useEffect(() => {
    const egg = new WordmarkVariation(setFrame, glyphs.length);
    variation.current = egg;
    let active = true;
    void getAboutInfo().then((value) => { if (active) setApp(value); }).catch(() => { if (active) setUpdate({ status: 'failed' }); });
    return () => { active = false; egg.dispose(); request.current?.abort(); variation.current = null; };
  }, []);
  const open = async (url: string) => {
    try { await openAboutLink(url); setLinkError(false); } catch { setLinkError(true); }
  };
  async function check() {
    if (!app || request.current) return;
    const controller = new AbortController(); request.current = controller; setUpdate({ status: 'checking' });
    const result = await checkForUpdate(app, (url) => requestRelease(url), controller.signal);
    if (!controller.signal.aborted) setUpdate(result);
    if (request.current === controller) request.current = null;
  }
  const licenseLabel = (value: string) => value === 'See notices' ? t('about.licenseNotices') : value;
  const entries = licenses.entries.filter((entry) => (!app || entry.platforms.includes(app.platform))
    && `${entry.name} ${entry.version} ${licenseLabel(entry.license)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="about-home">
    <svg className="about-specimen" viewBox="0 0 1024 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {glyphs.map((glyph, index) => <g key={glyph.name} className="about-glyph-layer" opacity={frame === index ? 1 : 0}>
        <g transform={`translate(-740 -150) scale(${2.4 * 1024 / glyph.width})`} fill="none" stroke="currentColor" strokeWidth="0.6">{glyph.paths.map((path, p) => <path key={p} d={path} />)}</g>
        <g transform={`translate(710 560) scale(${1.7 * 1024 / glyph.width})`} fill="none" stroke="currentColor" strokeWidth="0.6">{glyph.paths.map((path, p) => <path key={p} d={path} />)}</g>
      </g>)}
      <path d="M0 144h140 M884 144h140 M0 556h100 M924 556h100 M96 128v32 M928 540v32" fill="none" stroke="currentColor" />
    </svg>
    <div className="relative flex flex-col gap-6">
      <header className="flex flex-col items-center gap-3 py-8 text-center">
        <Button variant="ghost" className="about-wordmark" aria-label={t('about.logoLabel')} aria-description={t('about.logoHint')}
          onPress={() => variation.current?.activate()}>
          {glyphs.map((glyph, index) => <svg key={glyph.name} viewBox={`0 0 ${glyph.width} ${glyph.height}`} aria-hidden="true"
            className="about-glyph-layer absolute inset-0 h-full w-full" opacity={index === frame ? 1 : 0}>
            {glyph.paths.map((path, p) => <path key={p} d={path} fill="currentColor" />)}
          </svg>)}
        </Button>
        <span className="sr-only" role="status">{t('about.logoVariant', { current: frame + 1, total: glyphs.length })}</span>
        <p className="about-tagline">{t('about.tagline')}</p>
        <p className="tabular-nums">{app ? t('macos.versionWithBuild', { version: app.version, build: app.build }) : t('common.unknownVersion')}</p>
        {app && <p>{t('about.platform', { platform: t(`about.platformNames.${app.platform}`), arch: app.arch })}</p>}
        <Button size="sm" variant="secondary" isDisabled={!app || update.status === 'checking'} onPress={() => void check()}>
          {t(update.status === 'checking' ? 'about.checking' : 'about.check')}
        </Button>
        <div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
          {!['idle', 'checking'].includes(update.status) && <p>{t(`about.${update.status}`, { version: update.release?.version })}</p>}
          {update.release && <>
            <p>{t('about.published', { date: new Date(update.release.publishedAt).toLocaleDateString(i18n.language) })}</p>
            <Button size="sm" variant="ghost" onPress={() => void open(update.release!.releaseUrl)}>{t('about.notes')}<ArrowUpRightIcon /></Button>
            {update.artifacts?.map((artifact, index) => <Button key={artifact.format} size="sm" variant={index === 0 ? 'primary' : 'secondary'}
              onPress={() => void open(artifact.url)}>{t('about.download')}{update.artifacts!.length > 1 ? ` · ${artifact.format}` : ''}</Button>)}
          </>}
        </div>
      </header>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2>{t('about.links')}</h2>
          {content.links.map((link) => <Button key={link.key} className="w-full justify-between" variant="secondary" onPress={() => void open(link.url)}>{t(`about.${link.key}`)}<ArrowUpRightIcon /></Button>)}
          <h2 className="mt-3">{t('about.licenses')}</h2>
          <p>{t('about.projectLicense')}</p>
          <Button className="w-full justify-between" variant="secondary" onPress={() => setReader(true)}>{t('about.allLicenses')}<ArrowUpRightIcon /></Button>
          <p>{t('about.licenseSummary')}</p>
        </section>
        <section className="flex flex-col gap-3">
          <h2>{t('about.thanks')}</h2>
          {content.credits.map((credit) => <Button key={credit.key} variant="ghost" className="h-auto w-full justify-between py-2" onPress={() => void open(credit.url)}>
            <span className="flex min-w-0 flex-col items-start gap-1 text-left"><strong>{credit.name}</strong><span className="text-xs text-muted whitespace-normal">{t(`about.${credit.key}`)}</span></span><ArrowUpRightIcon className="shrink-0" />
          </Button>)}
        </section>
      </div>
      {linkError && <p role="alert">{t('about.failed')}</p>}
      <footer className="py-4 text-center text-xs text-muted">{t('about.copyright')}</footer>
    </div>
    <Modal isOpen={reader} onOpenChange={(value) => { setReader(value); if (!value) { setSelected(undefined); setQuery(''); listPosition.current = 0; } }}>
      <Modal.Backdrop><Modal.Container placement="center"><Modal.Dialog className="w-full max-w-2xl" aria-label={t('about.licenses')}>
        <Modal.Header><h2>{t('about.licenses')}</h2></Modal.Header>
        <Modal.Body>
          <div hidden={!!selected} className="flex flex-col gap-4">
            <SearchField value={query} onChange={setQuery}><Label className="sr-only">{t('about.search')}</Label><SearchField.Group><MagnifyingGlassIcon /><Input placeholder={t('about.search')} /><SearchField.ClearButton aria-label={t("mobile.clearSearch")} /></SearchField.Group></SearchField>
            <div ref={listScroll} className="about-license-scroll flex flex-col gap-1">
              {entries.map((entry) => <Button variant="ghost" className="h-auto justify-start py-3 text-left" key={entry.id} onPress={() => { listPosition.current = listScroll.current?.scrollTop ?? 0; setSelected(entry); }}>
                <span className="flex flex-col gap-1"><strong>{entry.name} {entry.version}</strong><span className="text-xs text-muted">{licenseLabel(entry.license)}</span></span>
              </Button>)}
              {!entries.length && <p>{t('about.noResults')}</p>}
            </div>
          </div>
          {selected && <div className="flex flex-col gap-4">
            <Button variant="ghost" className="self-start" onPress={() => setSelected(undefined)}><ArrowLeftIcon />{t('about.back')}</Button>
            <h3>{selected.name} {selected.version}</h3><p>{licenseLabel(selected.license)}</p><p>{t('about.appliesTo', { platforms: selected.platforms.map((platform) => t(`about.platformNames.${platform}`)).join(' · ') })}</p>
            <Button variant="secondary" className="self-start" onPress={() => void open(selected.source)}>{t('about.sourceLink')}<ArrowUpRightIcon /></Button>
            <div key={selected.id} className="about-license-scroll">
              {selected.declarationOnly && <p>{t('about.declaration')}: {licenseLabel(selected.license)}</p>}
              {selected.documents.map((document, index) => <pre className="about-license-text" key={index}>{(licenses.texts as Record<string, string>)[document.text]}</pre>)}
            </div>
          </div>}
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" onPress={() => { setReader(false); setSelected(undefined); setQuery(''); listPosition.current = 0; }}>{t('about.close')}</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container></Modal.Backdrop>
    </Modal>
  </div>;
}
