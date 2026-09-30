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
  faces: FontFace[];
}

export interface LibrarySnapshot {
  familyCount: number;
  faceCount: number;
}

export interface LibraryQuery {
  text: string;
  scope: 'all' | 'favorites' | 'recent';
  offset: number;
  limit: number;
}

export interface LibraryPage {
  totalMatches: number;
  families: FontFamily[];
}

export interface LibraryBridge {
  initialize(): Promise<LibrarySnapshot>;
  query(request: LibraryQuery): Promise<LibraryPage>;
  importFont(uri: string): Promise<LibrarySnapshot>;
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
  if (!['all', 'favorites', 'recent'].includes(query.scope)
    || !Number.isSafeInteger(query.offset) || query.offset < 0
    || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) {
    throw new LibraryError('invalid-query', '查询范围无效。');
  }
}

export function createLibraryClient(bridge: LibraryBridge) {
  return {
    initialize: () => bridge.initialize(),
    importFont: (uri: string) => bridge.importFont(uri),
    query(query: LibraryQuery, signal?: AbortSignal): Promise<LibraryPage> {
      validateQuery(query);
      if (signal?.aborted) return Promise.reject(new LibraryError('cancelled', '查询已取消。'));
      return new Promise((resolve, reject) => {
        const abort = () => reject(new LibraryError('cancelled', '查询已取消。'));
        signal?.addEventListener('abort', abort, { once: true });
        // 同步 Rust 查询不能中断；取消后仅丢弃结果，不回写界面。
        Promise.resolve().then(() => {
          if (signal?.aborted) throw new LibraryError('cancelled', '查询已取消。');
          return bridge.query(query);
        }).then((page) => {
          if (!signal?.aborted) resolve(page);
        }, (cause: unknown) => {
          reject(cause instanceof LibraryError ? cause
            : new LibraryError('native', '暂时无法读取字体库，请重试。', { cause }));
        }).finally(() => signal?.removeEventListener('abort', abort));
      });
    },
  };
}
