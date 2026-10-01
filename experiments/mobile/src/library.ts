import i18n from './i18n/instance.ts';

export interface VariableAxis {
  tag: string;
  name: string;
  minimum: number;
  defaultValue: number;
  maximum: number;
}

export interface FontFace {
  id: string;
  identityId: string;
  revisionId: string;
  styleName: string;
  sourcePath: string | null;
  faceIndex: number;
  axes: VariableAxis[];
}

export interface FontFamily {
  id: string;
  displayName: string;
  isFavorite: boolean;
  identityIds: string[];
  matchedFaceIds: string[];
  faces: FontFace[];
}

export const facetTitles = {
  category: i18n.t('filters.category'), script: i18n.t('filters.script'), foundry: i18n.t('filters.foundry'), license: i18n.t('filters.license'),
  weight: i18n.t('filters.weight'), width: i18n.t('filters.width'), feature: i18n.t('filters.feature'), state: i18n.t('filters.state'), multipleVariants: i18n.t('font.family'),
} as const;

export type FacetKind = keyof typeof facetTitles;
export interface FacetSelection { kind: FacetKind; value: string }
export interface FacetOption extends FacetSelection { label: string; familyCount: number }

export interface CollectionInput { name: string; icon: string; color: string }
export interface FontCollection extends CollectionInput { id: string; memberCount: number }

export type LibraryTarget = { scope: 'all' | 'favorites' | 'recent'; collectionId?: never }
  | { scope: 'collection'; collectionId: string };

export function targetKey(target: LibraryTarget) {
  return target.scope === 'collection' ? `collection:${target.collectionId}` : target.scope;
}

export function normalizeFacets(facets: FacetSelection[]): FacetSelection[] {
  return Array.from(new Map(facets.map(({ kind, value }) => [`${kind}:${value}`, { kind, value }])).values())
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

// 候选来自当前范围，计数来自实时查询；零匹配的已选项仍可取消。
export function mergeFacetOptions(options: FacetOption[], counts: FacetOption[], selected: FacetSelection[]): FacetOption[] {
  const key = (facet: FacetSelection) => `${facet.kind}:${facet.value}`;
  const current = new Map(counts.map((option) => [key(option), option]));
  const available = new Map([...options, ...counts].map((option) => [key(option), option]));
  for (const facet of selected) {
    if (!available.has(key(facet))) available.set(key(facet), { ...facet, label: facet.value, familyCount: 0 });
  }
  return Array.from(available.values()).map((option) => ({ ...option, familyCount: current.get(key(option))?.familyCount ?? 0 }));
}

export interface LibrarySnapshot {
  familyCount: number;
  faceCount: number;
  variableFamilyCount: number;
  recentCount: number;
  damagedCount: number;
  collections: FontCollection[];
}

export type LibraryQuery = LibraryTarget & {
  text: string;
  facets?: FacetSelection[];
  offset: number;
  limit: number;
};

export interface LibraryPage {
  totalMatches: number;
  families: FontFamily[];
  facets: FacetOption[];
  unresolvedScopeItems: number;
}

export interface ImportFile {
  uri: string;
  name: string;
}

export interface ImportItem {
  name: string;
  archiveName: string | null;
  status: 'imported' | 'duplicate' | 'failed';
  message: string | null;
}

export interface ImportReport {
  snapshot: LibrarySnapshot;
  items: ImportItem[];
}

export function summarizeImport(items: ImportItem[]) {
  return items.reduce((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { imported: 0, duplicate: 0, failed: 0 });
}

export interface LibraryBridge {
  initialize(): Promise<LibrarySnapshot>;
  snapshot(): Promise<LibrarySnapshot>;
  query(request: LibraryQuery): Promise<LibraryPage>;
  importFonts(files: ImportFile[]): Promise<ImportReport>;
  setFavorite(identityIds: string[], favorite: boolean): Promise<LibrarySnapshot>;
  createCollection(input: CollectionInput): Promise<LibrarySnapshot>;
  updateCollection(id: string, input: CollectionInput): Promise<LibrarySnapshot>;
  deleteCollection(id: string): Promise<LibrarySnapshot>;
  setCollectionMembers(id: string, identityIds: string[], member: boolean): Promise<LibrarySnapshot>;
}

export type LibraryErrorCode = 'invalid-query' | 'cancelled' | 'native';

export class LibraryError extends Error {
  readonly code: LibraryErrorCode;

  constructor(code: LibraryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LibraryError';
    this.code = code;
  }
}

function validateQuery(query: LibraryQuery) {
  if (!['all', 'favorites', 'recent', 'collection'].includes(query.scope)
    || (query.scope === 'collection' ? !query.collectionId?.trim() : query.collectionId !== undefined)
    || (query.facets !== undefined && (!Array.isArray(query.facets) || query.facets.some((facet) =>
      !facet || !Object.hasOwn(facetTitles, facet.kind) || typeof facet.value !== 'string' || !facet.value.trim())))
    || !Number.isSafeInteger(query.offset) || query.offset < 0
    || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) {
    throw new LibraryError('invalid-query', i18n.t('mobile.errorQueryRange'));
  }
}

export function createLibraryClient(bridge: LibraryBridge) {
  return {
    initialize: () => bridge.initialize(),
    snapshot: () => bridge.snapshot(),
    async importFonts(files: ImportFile[]): Promise<ImportReport> {
      try { return await bridge.importFonts(files); }
      catch (cause: unknown) {
        const rolledBack = typeof cause === 'object' && cause !== null
          && 'code' in cause && cause.code === 'ERR_FOLIO_IMPORT';
        throw new LibraryError('native', rolledBack
          ? i18n.t('mobile.errorUpdate')
          : i18n.t('mobile.errorImport'), { cause });
      }
    },
    setFavorite: (identityIds: string[], favorite: boolean) => bridge.setFavorite(identityIds, favorite),
    createCollection: (input: CollectionInput) => bridge.createCollection(input),
    updateCollection: (id: string, input: CollectionInput) => bridge.updateCollection(id, input),
    deleteCollection: (id: string) => bridge.deleteCollection(id),
    setCollectionMembers: (id: string, identityIds: string[], member: boolean) => bridge.setCollectionMembers(id, identityIds, member),
    query(query: LibraryQuery, signal?: AbortSignal): Promise<LibraryPage> {
      validateQuery(query);
      if (signal?.aborted) return Promise.reject(new LibraryError('cancelled', i18n.t('mobile.errorQueryCancelled')));
      return new Promise((resolve, reject) => {
        const abort = () => reject(new LibraryError('cancelled', i18n.t('mobile.errorQueryCancelled')));
        signal?.addEventListener('abort', abort, { once: true });
        // 同步 Rust 查询不能中断；取消后仅丢弃结果，不回写界面。
        Promise.resolve().then(() => {
          if (signal?.aborted) throw new LibraryError('cancelled', i18n.t('mobile.errorQueryCancelled'));
          return bridge.query(query);
        }).then((page) => {
          if (!signal?.aborted) resolve(page);
        }, (cause: unknown) => {
          reject(cause instanceof LibraryError ? cause
            : new LibraryError('native', i18n.t('mobile.errorLibraryRead'), { cause }));
        }).finally(() => signal?.removeEventListener('abort', abort));
      });
    },
  };
}
