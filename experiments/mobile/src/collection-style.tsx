import {
  FolderIcon, BooksIcon, TextAaIcon, StarIcon,
  HeartIcon, BookmarkIcon, TagIcon, BriefcaseIcon,
  SparkleIcon, SlidersHorizontalIcon, SignatureIcon, ArchiveIcon,
  BookIcon, PaperclipIcon, PackageIcon, SwatchesIcon,
  GiftIcon, StackIcon, NumberCircleZeroIcon, NumberCircleOneIcon,
  NumberCircleTwoIcon, NumberCircleThreeIcon, NumberCircleFourIcon, NumberCircleFiveIcon,
  NumberCircleSixIcon, NumberCircleSevenIcon, NumberCircleEightIcon, NumberCircleNineIcon,
  NumberSquareZeroIcon, NumberSquareOneIcon, NumberSquareTwoIcon, NumberSquareThreeIcon,
  NumberSquareFourIcon, NumberSquareFiveIcon, NumberSquareSixIcon, NumberSquareSevenIcon,
  NumberSquareEightIcon, NumberSquareNineIcon
} from 'phosphor-react-native';

// 收藏夹图标与颜色键沿用桌面契约。
export const collectionIcons = [
  { key: 'folder', label: '文件夹', Icon: FolderIcon },
  { key: 'books', label: '书籍', Icon: BooksIcon },
  { key: 'type', label: '字体', Icon: TextAaIcon },
  { key: 'star', label: '星标', Icon: StarIcon },
  { key: 'heart', label: '爱心', Icon: HeartIcon },
  { key: 'bookmark', label: '书签', Icon: BookmarkIcon },
  { key: 'tag', label: '标签', Icon: TagIcon },
  { key: 'briefcase', label: '工作', Icon: BriefcaseIcon },
  { key: 'sparkles', label: '灵感', Icon: SparkleIcon },
  { key: 'sliders-horizontal', label: '调节', Icon: SlidersHorizontalIcon },
  { key: 'signature', label: '签名', Icon: SignatureIcon },
  { key: 'archive', label: '归档', Icon: ArchiveIcon },
  { key: 'book', label: '书本', Icon: BookIcon },
  { key: 'paperclip', label: '回形针', Icon: PaperclipIcon },
  { key: 'package', label: '包裹', Icon: PackageIcon },
  { key: 'swatches', label: '色板', Icon: SwatchesIcon },
  { key: 'gift', label: '礼物', Icon: GiftIcon },
  { key: 'stack', label: '叠层', Icon: StackIcon },
  { key: 'number-circle-0', label: '圆形数字 0', Icon: NumberCircleZeroIcon },
  { key: 'number-circle-1', label: '圆形数字 1', Icon: NumberCircleOneIcon },
  { key: 'number-circle-2', label: '圆形数字 2', Icon: NumberCircleTwoIcon },
  { key: 'number-circle-3', label: '圆形数字 3', Icon: NumberCircleThreeIcon },
  { key: 'number-circle-4', label: '圆形数字 4', Icon: NumberCircleFourIcon },
  { key: 'number-circle-5', label: '圆形数字 5', Icon: NumberCircleFiveIcon },
  { key: 'number-circle-6', label: '圆形数字 6', Icon: NumberCircleSixIcon },
  { key: 'number-circle-7', label: '圆形数字 7', Icon: NumberCircleSevenIcon },
  { key: 'number-circle-8', label: '圆形数字 8', Icon: NumberCircleEightIcon },
  { key: 'number-circle-9', label: '圆形数字 9', Icon: NumberCircleNineIcon },
  { key: 'number-square-0', label: '方形数字 0', Icon: NumberSquareZeroIcon },
  { key: 'number-square-1', label: '方形数字 1', Icon: NumberSquareOneIcon },
  { key: 'number-square-2', label: '方形数字 2', Icon: NumberSquareTwoIcon },
  { key: 'number-square-3', label: '方形数字 3', Icon: NumberSquareThreeIcon },
  { key: 'number-square-4', label: '方形数字 4', Icon: NumberSquareFourIcon },
  { key: 'number-square-5', label: '方形数字 5', Icon: NumberSquareFiveIcon },
  { key: 'number-square-6', label: '方形数字 6', Icon: NumberSquareSixIcon },
  { key: 'number-square-7', label: '方形数字 7', Icon: NumberSquareSevenIcon },
  { key: 'number-square-8', label: '方形数字 8', Icon: NumberSquareEightIcon },
  { key: 'number-square-9', label: '方形数字 9', Icon: NumberSquareNineIcon },
] as const;

export const collectionColors = [
  { key: 'red', label: '红色' },
  { key: 'orange', label: '橙色' },
  { key: 'yellow', label: '黄色' },
  { key: 'lime', label: '黄绿色' },
  { key: 'green', label: '绿色' },
  { key: 'cyan', label: '青色' },
  { key: 'blue', label: '蓝色' },
  { key: 'purple', label: '紫色' },
  { key: 'gray', label: '灰色' },
] as const;

// 颜色沿用桌面收藏夹调色板。
const collectionPalette: Record<string, string> = {
  red: 'rgb(219, 56, 64)', orange: 'rgb(232, 99, 31)', yellow: 'rgb(209, 158, 5)',
  lime: 'rgb(125, 176, 41)', green: 'rgb(31, 153, 92)', cyan: 'rgb(0, 150, 161)',
  blue: 'rgb(46, 120, 214)', purple: 'rgb(125, 79, 207)', gray: 'rgb(128, 128, 128)',
};

export function collectionColorValue(color: string) {
  return collectionPalette[color] ?? 'rgb(128, 128, 128)';
}

export function collectionSystemImage(icon: string) {
  const number = /^number-(circle|square)-(\d)$/.exec(icon);
  if (number) return `${number[2]}.${number[1]}`;
  const symbols: Record<string, string> = {
    folder: 'folder', books: 'books.vertical', type: 'textformat', star: 'star', heart: 'heart',
    bookmark: 'bookmark', tag: 'tag', briefcase: 'briefcase', sparkles: 'sparkles',
    'sliders-horizontal': 'slider.horizontal.3', signature: 'signature', archive: 'archivebox',
    book: 'book', paperclip: 'paperclip', package: 'shippingbox', swatches: 'swatchpalette',
    gift: 'gift', stack: 'rectangle.stack',
  };
  return symbols[icon] ?? 'folder';
}

export function CollectionSymbol({ icon, color, size = 20 }: { icon: string; color: string; size?: number }) {
  const Icon = collectionIcons.find((item) => item.key === icon)?.Icon ?? FolderIcon;
  return <Icon size={size} color={color} />;
}
