import { expect, it } from "vitest";
import { appendLibraryPage, LibraryPageRequests } from "./library-paging";
import { family } from "./test/fixtures";

it("同一分页防连击，新查询使旧分页与旧首屏结果失效", () => {
  const requests = new LibraryPageRequests();
  const first = requests.begin("all", 0)!;
  expect(requests.begin("all", 120)).toBeNull();
  requests.finish(first);
  const page = requests.begin("all", 120)!;
  expect(requests.begin("all", 120)).toBeNull();
  const search = requests.begin("search", 0)!;
  expect(requests.current(page)).toBe(false);
  expect(requests.finish(page)).toBe(false);
  expect(requests.begin("all", 120)).toBeNull();
  expect(requests.current(search)).toBe(true);
});

it("追加去重且保留旧卡片对象，不丢失已加载的字族", () => {
  const a = family("a");
  const page = { families: [a], totalMatches: 3, facets: [], isLoading: false };
  const result = appendLibraryPage(page, { ...page, families: [family("a"), family("b")] });
  expect(result.families.map((item) => item.id)).toEqual(["a", "b"]);
  expect(result.families[0]).toBe(a);
});
