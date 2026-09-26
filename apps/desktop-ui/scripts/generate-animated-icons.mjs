// 生成侧边栏与收藏夹图标所用的描边几何数据。
// 数据源为 Phosphor Icons 的描边原始 SVG（raw/regular），运行：
//   node scripts/generate-animated-icons.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = "https://raw.githubusercontent.com/phosphor-icons/core/main/raw/regular";

// 侧边栏、字体状态与收藏夹图标用到的全部描边图标。
const ICON_NAMES = [
  "map-pin",
  "funnel-simple",
  "text-aa",
  "clock-counter-clockwise",
  "star",
  "sparkle",
  "plus",
  "hard-drives",
  "globe",
  "stethoscope",
  "seal-check",
  "download-simple",
  "book",
  "file",
  "laptop",
  "warning",
  "folder",
  "books",
  "heart",
  "bookmark-simple",
  "tag",
  "briefcase",
  "sliders-horizontal",
  "signature",
  "archive",
  "paperclip",
  "package",
  "swatches",
  "gift",
  "stack",
  "number-circle-zero",
  "number-circle-one",
  "number-circle-two",
  "number-circle-three",
  "number-circle-four",
  "number-circle-five",
  "number-circle-six",
  "number-circle-seven",
  "number-circle-eight",
  "number-circle-nine",
  "number-square-zero",
  "number-square-one",
  "number-square-two",
  "number-square-three",
  "number-square-four",
  "number-square-five",
  "number-square-six",
  "number-square-seven",
  "number-square-eight",
  "number-square-nine",
];

// 每种图形只保留几何属性，描边样式由组件统一设置。
const SHAPE_ATTRS = {
  path: ["d"],
  line: ["x1", "y1", "x2", "y2"],
  polyline: ["points"],
  polygon: ["points"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
};

const SHAPE_RE = /<(path|line|polyline|polygon|circle|ellipse|rect)\b([^>]*?)\/?>/g;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

function parseSvg(name, svg) {
  const shapes = [];
  for (const match of svg.matchAll(SHAPE_RE)) {
    const [, tag, rawAttrs] = match;
    // 跳过无描边的背景占用矩形。
    if (!/\bstroke=/.test(rawAttrs)) continue;
    const parsed = {};
    for (const attr of rawAttrs.matchAll(ATTR_RE)) {
      parsed[attr[1]] = attr[2];
    }
    const attrs = {};
    for (const key of SHAPE_ATTRS[tag]) {
      if (parsed[key] !== undefined) attrs[key] = parsed[key];
    }
    if (Object.keys(attrs).length === 0) continue;
    shapes.push({ tag, attrs });
  }
  if (shapes.length === 0) throw new Error(`${name} 未解析出可绘制图形`);
  return shapes;
}

function serialize(shapes) {
  const body = shapes
    .map(({ tag, attrs }) => {
      const entries = Object.entries(attrs)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(", ");
      return `    { tag: ${JSON.stringify(tag)}, attrs: { ${entries} } },`;
    })
    .join("\n");
  return `[\n${body}\n  ]`;
}

async function main() {
  const entries = [];
  for (const name of ICON_NAMES) {
    const response = await fetch(`${BASE_URL}/${name}.svg`);
    if (!response.ok) throw new Error(`${name} 下载失败：${response.status}`);
    entries.push(`  ${JSON.stringify(name)}: ${serialize(parseSvg(name, await response.text()))},`);
  }

  const output = `// 本文件由 scripts/generate-animated-icons.mjs 生成，请勿手工修改。
// 数据源自 Phosphor Icons 的描边图标，仅保留几何属性。

export type AnimatedShapeTag =
  | "path"
  | "line"
  | "polyline"
  | "polygon"
  | "circle"
  | "ellipse"
  | "rect";

export type AnimatedShape = {
  tag: AnimatedShapeTag;
  attrs: Record<string, string>;
};

export const animatedIconShapes = {
${entries.join("\n")}
} as const satisfies Record<string, readonly AnimatedShape[]>;

export type AnimatedIconName = keyof typeof animatedIconShapes;
`;

  const target = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "animated-icons-data.ts",
  );
  await writeFile(target, output, "utf8");
  console.log(`已生成 ${ICON_NAMES.length} 个图标：${target}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
