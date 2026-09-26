// 本文件由 scripts/generate-animated-icons.mjs 生成，请勿手工修改。
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
  "map-pin": [
    { tag: "circle", attrs: { cx: "128", cy: "104", r: "32" } },
    { tag: "path", attrs: { d: "M208,104c0,72-80,128-80,128S48,176,48,104a80,80,0,0,1,160,0Z" } },
  ],
  "funnel-simple": [
    { tag: "line", attrs: { x1: "64", y1: "136", x2: "192", y2: "136" } },
    { tag: "line", attrs: { x1: "24", y1: "88", x2: "232", y2: "88" } },
    { tag: "line", attrs: { x1: "104", y1: "184", x2: "152", y2: "184" } },
  ],
  "text-aa": [
    { tag: "polyline", attrs: { points: "144 192 80 56 16 192" } },
    { tag: "ellipse", attrs: { cx: "200", cy: "164", rx: "32", ry: "28" } },
    { tag: "path", attrs: { d: "M232,192V132c0-15.46-14.33-28-32-28-9.56,0-18.14,2.18-24,8" } },
    { tag: "line", attrs: { x1: "125.18", y1: "152", x2: "34.82", y2: "152" } },
  ],
  "clock-counter-clockwise": [
    { tag: "polyline", attrs: { points: "128 80 128 128 168 152" } },
    { tag: "polyline", attrs: { points: "72 104 32 104 32 64" } },
    { tag: "path", attrs: { d: "M67.6,192A88,88,0,1,0,65.77,65.77C54,77.69,44.28,88.93,32,104" } },
  ],
  "star": [
    { tag: "path", attrs: { d: "M128,189.09l54.72,33.65a8.4,8.4,0,0,0,12.52-9.17l-14.88-62.79,48.7-42A8.46,8.46,0,0,0,224.27,94L160.36,88.8,135.74,29.2a8.36,8.36,0,0,0-15.48,0L95.64,88.8,31.73,94a8.46,8.46,0,0,0-4.79,14.83l48.7,42L60.76,213.57a8.4,8.4,0,0,0,12.52,9.17Z" } },
  ],
  "sparkle": [
    { tag: "path", attrs: { d: "M84.27,171.73l-55.09-20.3a7.92,7.92,0,0,1,0-14.86l55.09-20.3,20.3-55.09a7.92,7.92,0,0,1,14.86,0l20.3,55.09,55.09,20.3a7.92,7.92,0,0,1,0,14.86l-55.09,20.3-20.3,55.09a7.92,7.92,0,0,1-14.86,0Z" } },
    { tag: "line", attrs: { x1: "176", y1: "16", x2: "176", y2: "64" } },
    { tag: "line", attrs: { x1: "224", y1: "72", x2: "224", y2: "104" } },
    { tag: "line", attrs: { x1: "152", y1: "40", x2: "200", y2: "40" } },
    { tag: "line", attrs: { x1: "208", y1: "88", x2: "240", y2: "88" } },
  ],
  "plus": [
    { tag: "line", attrs: { x1: "40", y1: "128", x2: "216", y2: "128" } },
    { tag: "line", attrs: { x1: "128", y1: "40", x2: "128", y2: "216" } },
  ],
  "hard-drives": [
    { tag: "rect", attrs: { x: "40", y: "144", width: "176", height: "64", rx: "8" } },
    { tag: "rect", attrs: { x: "40", y: "48", width: "176", height: "64", rx: "8" } },
  ],
  "globe": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "path", attrs: { d: "M168,128c0,64-40,96-40,96s-40-32-40-96,40-96,40-96S168,64,168,128Z" } },
    { tag: "line", attrs: { x1: "37.46", y1: "96", x2: "218.54", y2: "96" } },
    { tag: "line", attrs: { x1: "37.46", y1: "160", x2: "218.54", y2: "160" } },
  ],
  "stethoscope": [
    { tag: "circle", attrs: { cx: "208", cy: "160", r: "32" } },
    { tag: "path", attrs: { d: "M104,144v48a40,40,0,0,0,40,40h24a40,40,0,0,0,40-40h0" } },
    { tag: "path", attrs: { d: "M136,40h24V87.17c0,30.77-24.48,56.43-55.26,56.83A56,56,0,0,1,48,88V40H72" } },
  ],
  "seal-check": [
    { tag: "path", attrs: { d: "M54.46,201.54c-9.2-9.2-3.1-28.53-7.78-39.85C41.82,150,24,140.5,24,128s17.82-22,22.68-33.69C51.36,83,45.26,63.66,54.46,54.46S83,51.36,94.31,46.68C106.05,41.82,115.5,24,128,24S150,41.82,161.69,46.68c11.32,4.68,30.65-1.42,39.85,7.78s3.1,28.53,7.78,39.85C214.18,106.05,232,115.5,232,128S214.18,150,209.32,161.69c-4.68,11.32,1.42,30.65-7.78,39.85s-28.53,3.1-39.85,7.78C150,214.18,140.5,232,128,232s-22-17.82-33.69-22.68C83,204.64,63.66,210.74,54.46,201.54Z" } },
    { tag: "polyline", attrs: { points: "88 136 112 160 168 104" } },
  ],
  "download-simple": [
    { tag: "line", attrs: { x1: "128", y1: "144", x2: "128", y2: "32" } },
    { tag: "polyline", attrs: { points: "216 144 216 208 40 208 40 144" } },
    { tag: "polyline", attrs: { points: "168 104 128 144 88 104" } },
  ],
  "book": [
    { tag: "path", attrs: { d: "M48,216a24,24,0,0,1,24-24H208V32H72A24,24,0,0,0,48,56Z" } },
    { tag: "polyline", attrs: { points: "48 216 48 224 192 224" } },
  ],
  "file": [
    { tag: "path", attrs: { d: "M200,224H56a8,8,0,0,1-8-8V40a8,8,0,0,1,8-8h96l56,56V216A8,8,0,0,1,200,224Z" } },
    { tag: "polyline", attrs: { points: "152 32 152 88 208 88" } },
  ],
  "laptop": [
    { tag: "path", attrs: { d: "M40,176V72A16,16,0,0,1,56,56H200a16,16,0,0,1,16,16V176" } },
    { tag: "path", attrs: { d: "M24,176H232a0,0,0,0,1,0,0v16a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V176A0,0,0,0,1,24,176Z" } },
    { tag: "line", attrs: { x1: "144", y1: "88", x2: "112", y2: "88" } },
  ],
  "warning": [
    { tag: "path", attrs: { d: "M142.41,40.22l87.46,151.87C236,202.79,228.08,216,215.46,216H40.54C27.92,216,20,202.79,26.13,192.09L113.59,40.22C119.89,29.26,136.11,29.26,142.41,40.22Z" } },
    { tag: "line", attrs: { x1: "128", y1: "144", x2: "128", y2: "104" } },
  ],
  "folder": [
    { tag: "path", attrs: { d: "M216.89,208H39.38A7.4,7.4,0,0,1,32,200.62V80H216a8,8,0,0,1,8,8V200.89A7.11,7.11,0,0,1,216.89,208Z" } },
    { tag: "path", attrs: { d: "M32,80V56a8,8,0,0,1,8-8H92.69a8,8,0,0,1,5.65,2.34L128,80" } },
  ],
  "books": [
    { tag: "rect", attrs: { x: "48", y: "40", width: "64", height: "176", rx: "8" } },
    { tag: "path", attrs: { d: "M217.67,205.77l-46.81,10a8,8,0,0,1-9.5-6.21L128.18,51.8a8.07,8.07,0,0,1,6.15-9.57l46.81-10a8,8,0,0,1,9.5,6.21L223.82,196.2A8.07,8.07,0,0,1,217.67,205.77Z" } },
    { tag: "line", attrs: { x1: "48", y1: "72", x2: "112", y2: "72" } },
    { tag: "line", attrs: { x1: "48", y1: "184", x2: "112", y2: "184" } },
    { tag: "line", attrs: { x1: "133.16", y1: "75.48", x2: "195.61", y2: "62.06" } },
    { tag: "line", attrs: { x1: "139.79", y1: "107.04", x2: "202.25", y2: "93.62" } },
    { tag: "line", attrs: { x1: "156.39", y1: "185.94", x2: "218.84", y2: "172.52" } },
  ],
  "heart": [
    { tag: "path", attrs: { d: "M128,224S24,168,24,102A54,54,0,0,1,78,48c22.59,0,41.94,12.31,50,32,8.06-19.69,27.41-32,50-32a54,54,0,0,1,54,54C232,168,128,224,128,224Z" } },
  ],
  "bookmark-simple": [
    { tag: "path", attrs: { d: "M192,224l-64-40L64,224V48a8,8,0,0,1,8-8H184a8,8,0,0,1,8,8Z" } },
  ],
  "tag": [
    { tag: "path", attrs: { d: "M42.34,138.34A8,8,0,0,1,40,132.69V40h92.69a8,8,0,0,1,5.65,2.34l99.32,99.32a8,8,0,0,1,0,11.31L153,237.66a8,8,0,0,1-11.31,0Z" } },
  ],
  "briefcase": [
    { tag: "rect", attrs: { x: "32", y: "64", width: "192", height: "144", rx: "8" } },
    { tag: "path", attrs: { d: "M168,64V48a16,16,0,0,0-16-16H104A16,16,0,0,0,88,48V64" } },
    { tag: "path", attrs: { d: "M224,118.31A191.09,191.09,0,0,1,128,144a191.14,191.14,0,0,1-96-25.68" } },
    { tag: "line", attrs: { x1: "112", y1: "112", x2: "144", y2: "112" } },
  ],
  "sliders-horizontal": [
    { tag: "circle", attrs: { cx: "104", cy: "80", r: "24" } },
    { tag: "circle", attrs: { cx: "168", cy: "176", r: "24" } },
    { tag: "line", attrs: { x1: "128", y1: "80", x2: "216", y2: "80" } },
    { tag: "line", attrs: { x1: "40", y1: "80", x2: "80", y2: "80" } },
    { tag: "line", attrs: { x1: "192", y1: "176", x2: "216", y2: "176" } },
    { tag: "line", attrs: { x1: "40", y1: "176", x2: "144", y2: "176" } },
  ],
  "signature": [
    { tag: "line", attrs: { x1: "24", y1: "176", x2: "232", y2: "176" } },
    { tag: "path", attrs: { d: "M24,224S139.52,32,77.91,32C32.07,32,31.58,225.11,128,104.19c0,0,8.11,39.44,27.23,39.81,7.72.15,17.25-6.31,28.77-24,0,0,0,24,48,24" } },
  ],
  "archive": [
    { tag: "rect", attrs: { x: "24", y: "56", width: "208", height: "40", rx: "8" } },
    { tag: "path", attrs: { d: "M216,96v96a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V96" } },
    { tag: "line", attrs: { x1: "104", y1: "136", x2: "152", y2: "136" } },
  ],
  "paperclip": [
    { tag: "path", attrs: { d: "M160,80,76.69,164.69a16,16,0,0,0,22.63,22.62L198.63,86.63a32,32,0,0,0-45.26-45.26L54.06,142.06a48,48,0,0,0,67.88,67.88L204,128" } },
  ],
  "package": [
    { tag: "line", attrs: { x1: "128", y1: "129.09", x2: "128", y2: "231.97" } },
    { tag: "polyline", attrs: { points: "32.7 76.92 128 129.08 223.3 76.92" } },
    { tag: "path", attrs: { d: "M219.84,182.84l-88,48.18a8,8,0,0,1-7.68,0l-88-48.18a8,8,0,0,1-4.16-7V80.18a8,8,0,0,1,4.16-7l88-48.18a8,8,0,0,1,7.68,0l88,48.18a8,8,0,0,1,4.16,7v95.64A8,8,0,0,1,219.84,182.84Z" } },
    { tag: "polyline", attrs: { points: "81.56 48.31 176 100 176 152" } },
  ],
  "swatches": [
    { tag: "path", attrs: { d: "M110.84,186.25a35.71,35.71,0,0,1-41.34,29.2h0a36,36,0,0,1-28.95-41.71l25-143.13a8,8,0,0,1,9.19-6.49l54.67,9.73a8,8,0,0,1,6.44,9.26Z" } },
    { tag: "path", attrs: { d: "M232,156.19V208a8,8,0,0,1-8,8H76" } },
    { tag: "path", attrs: { d: "M121.42,125.76l80.79-29.28a8,8,0,0,1,10.22,4.75l19.09,52.21a7.93,7.93,0,0,1-4.77,10.17L88.16,213.84A35.07,35.07,0,0,1,76,216" } },
  ],
  "gift": [
    { tag: "rect", attrs: { x: "32", y: "80", width: "192", height: "48", rx: "8" } },
    { tag: "path", attrs: { d: "M208,128v72a8,8,0,0,1-8,8H56a8,8,0,0,1-8-8V128" } },
    { tag: "line", attrs: { x1: "128", y1: "80", x2: "128", y2: "208" } },
    { tag: "path", attrs: { d: "M176.79,31.21c9.34,9.34,9.89,25.06,0,33.82C159.88,80,128,80,128,80s0-31.88,15-48.79C151.73,21.32,167.45,21.87,176.79,31.21Z" } },
    { tag: "path", attrs: { d: "M79.21,31.21c-9.34,9.34-9.89,25.06,0,33.82C96.12,80,128,80,128,80s0-31.88-15-48.79C104.27,21.32,88.55,21.87,79.21,31.21Z" } },
  ],
  "stack": [
    { tag: "polyline", attrs: { points: "32 176 128 232 224 176" } },
    { tag: "polyline", attrs: { points: "32 128 128 184 224 128" } },
    { tag: "polygon", attrs: { points: "32 80 128 136 224 80 128 24 32 80" } },
  ],
  "number-circle-zero": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "ellipse", attrs: { cx: "128", cy: "128", rx: "36", ry: "48" } },
  ],
  "number-circle-one": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "polyline", attrs: { points: "132 176 132 80 108 96" } },
  ],
  "number-circle-two": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "path", attrs: { d: "M152,176H104l43.17-57.56A24,24,0,1,0,105.37,96" } },
  ],
  "number-circle-three": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "path", attrs: { d: "M104,84h48l-28,40a28,28,0,1,1-20,47.6" } },
  ],
  "number-circle-four": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "polyline", attrs: { points: "160 152 88 152 144 80 144 176" } },
  ],
  "number-circle-five": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "path", attrs: { d: "M152,80H112l-8,48a27.57,27.57,0,0,1,20-8,28,28,0,0,1,0,56,27.57,27.57,0,0,1-20-8" } },
  ],
  "number-circle-six": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "circle", attrs: { cx: "128", cy: "148", r: "28" } },
    { tag: "line", attrs: { x1: "103.75", y1: "134", x2: "136", y2: "80" } },
  ],
  "number-circle-seven": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "polyline", attrs: { points: "104 88 152 88 120 176" } },
  ],
  "number-circle-eight": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "circle", attrs: { cx: "128", cy: "100", r: "24" } },
    { tag: "circle", attrs: { cx: "128", cy: "152", r: "28" } },
  ],
  "number-circle-nine": [
    { tag: "circle", attrs: { cx: "128", cy: "128", r: "96" } },
    { tag: "circle", attrs: { cx: "128", cy: "108", r: "28" } },
    { tag: "line", attrs: { x1: "152.25", y1: "122", x2: "120", y2: "176" } },
  ],
  "number-square-zero": [
    { tag: "ellipse", attrs: { cx: "128", cy: "128", rx: "36", ry: "48" } },
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
  ],
  "number-square-one": [
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
    { tag: "polyline", attrs: { points: "132 176 132 80 108 96" } },
  ],
  "number-square-two": [
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
    { tag: "path", attrs: { d: "M152,176H104l43.17-57.56A24,24,0,1,0,105.37,96" } },
  ],
  "number-square-three": [
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
    { tag: "path", attrs: { d: "M104,80h48l-28,40a28,28,0,1,1-20,47.6" } },
  ],
  "number-square-four": [
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
    { tag: "polyline", attrs: { points: "160 152 88 152 144 80 144 176" } },
  ],
  "number-square-five": [
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
    { tag: "path", attrs: { d: "M152,80H112l-8,48a27.57,27.57,0,0,1,20-8,28,28,0,0,1,0,56,27.57,27.57,0,0,1-20-8" } },
  ],
  "number-square-six": [
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
    { tag: "circle", attrs: { cx: "128", cy: "148", r: "28" } },
    { tag: "line", attrs: { x1: "103.75", y1: "134", x2: "136", y2: "80" } },
  ],
  "number-square-seven": [
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
    { tag: "polyline", attrs: { points: "104 88 152 88 120 176" } },
  ],
  "number-square-eight": [
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
    { tag: "circle", attrs: { cx: "128", cy: "100", r: "24" } },
    { tag: "circle", attrs: { cx: "128", cy: "152", r: "28" } },
  ],
  "number-square-nine": [
    { tag: "rect", attrs: { x: "40", y: "40", width: "176", height: "176", rx: "8" } },
    { tag: "circle", attrs: { cx: "128", cy: "108", r: "28" } },
    { tag: "line", attrs: { x1: "152.25", y1: "122", x2: "120", y2: "176" } },
  ],
} as const satisfies Record<string, readonly AnimatedShape[]>;

export type AnimatedIconName = keyof typeof animatedIconShapes;
