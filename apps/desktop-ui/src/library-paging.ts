import type { LibraryPageDto } from "./types";

export class LibraryPageRequests {
  private key = "";
  private revision = 0;
  private pending = new Map<number, symbol>();

  begin(key: string, offset: number) {
    if (offset === 0) { this.key = key; this.revision += 1; this.pending.clear(); }
    else if (key !== this.key || this.pending.has(0) || this.pending.has(offset)) return null;
    const token = Symbol();
    const revision = this.revision;
    this.pending.set(offset, token);
    return { key, offset, token, revision };
  }

  current(ticket: NonNullable<ReturnType<LibraryPageRequests["begin"]>>) {
    return ticket.key === this.key && ticket.revision === this.revision && this.pending.get(ticket.offset) === ticket.token;
  }

  finish(ticket: NonNullable<ReturnType<LibraryPageRequests["begin"]>>) {
    if (!this.current(ticket)) return false;
    this.pending.delete(ticket.offset);
    return true;
  }
}

export function appendLibraryPage(current: LibraryPageDto, next: LibraryPageDto): LibraryPageDto {
  const existing = new Set(current.families.map((family) => family.id));
  return { ...next, families: [...current.families, ...next.families.filter((family) => !existing.has(family.id))] };
}
