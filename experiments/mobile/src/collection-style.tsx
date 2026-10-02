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
} from './icons';
import i18n from './i18n/instance';

// 收藏夹图标与颜色键沿用桌面契约。
export const collectionIcons = [
  { key: 'folder', label: i18n.t('collectionIcon.folder'), Icon: FolderIcon },
  { key: 'books', label: i18n.t('collectionIcon.books'), Icon: BooksIcon },
  { key: 'type', label: i18n.t('collectionIcon.type'), Icon: TextAaIcon },
  { key: 'star', label: i18n.t('collectionIcon.star'), Icon: StarIcon },
  { key: 'heart', label: i18n.t('collectionIcon.heart'), Icon: HeartIcon },
  { key: 'bookmark', label: i18n.t('collectionIcon.bookmark'), Icon: BookmarkIcon },
  { key: 'tag', label: i18n.t('collectionIcon.tag'), Icon: TagIcon },
  { key: 'briefcase', label: i18n.t('collectionIcon.briefcase'), Icon: BriefcaseIcon },
  { key: 'sparkles', label: i18n.t('collectionIcon.sparkles'), Icon: SparkleIcon },
  { key: 'sliders-horizontal', label: i18n.t('collectionIcon.sliders'), Icon: SlidersHorizontalIcon },
  { key: 'signature', label: i18n.t('collectionIcon.signature'), Icon: SignatureIcon },
  { key: 'archive', label: i18n.t('collectionIcon.archive'), Icon: ArchiveIcon },
  { key: 'book', label: i18n.t('collectionIcon.book'), Icon: BookIcon },
  { key: 'paperclip', label: i18n.t('collectionIcon.paperclip'), Icon: PaperclipIcon },
  { key: 'package', label: i18n.t('collectionIcon.package'), Icon: PackageIcon },
  { key: 'swatches', label: i18n.t('collectionIcon.swatches'), Icon: SwatchesIcon },
  { key: 'gift', label: i18n.t('collectionIcon.gift'), Icon: GiftIcon },
  { key: 'stack', label: i18n.t('collectionIcon.stack'), Icon: StackIcon },
  { key: 'number-circle-0', label: i18n.t('collectionIcon.circleNumber0'), Icon: NumberCircleZeroIcon },
  { key: 'number-circle-1', label: i18n.t('collectionIcon.circleNumber1'), Icon: NumberCircleOneIcon },
  { key: 'number-circle-2', label: i18n.t('collectionIcon.circleNumber2'), Icon: NumberCircleTwoIcon },
  { key: 'number-circle-3', label: i18n.t('collectionIcon.circleNumber3'), Icon: NumberCircleThreeIcon },
  { key: 'number-circle-4', label: i18n.t('collectionIcon.circleNumber4'), Icon: NumberCircleFourIcon },
  { key: 'number-circle-5', label: i18n.t('collectionIcon.circleNumber5'), Icon: NumberCircleFiveIcon },
  { key: 'number-circle-6', label: i18n.t('collectionIcon.circleNumber6'), Icon: NumberCircleSixIcon },
  { key: 'number-circle-7', label: i18n.t('collectionIcon.circleNumber7'), Icon: NumberCircleSevenIcon },
  { key: 'number-circle-8', label: i18n.t('collectionIcon.circleNumber8'), Icon: NumberCircleEightIcon },
  { key: 'number-circle-9', label: i18n.t('collectionIcon.circleNumber9'), Icon: NumberCircleNineIcon },
  { key: 'number-square-0', label: i18n.t('collectionIcon.squareNumber0'), Icon: NumberSquareZeroIcon },
  { key: 'number-square-1', label: i18n.t('collectionIcon.squareNumber1'), Icon: NumberSquareOneIcon },
  { key: 'number-square-2', label: i18n.t('collectionIcon.squareNumber2'), Icon: NumberSquareTwoIcon },
  { key: 'number-square-3', label: i18n.t('collectionIcon.squareNumber3'), Icon: NumberSquareThreeIcon },
  { key: 'number-square-4', label: i18n.t('collectionIcon.squareNumber4'), Icon: NumberSquareFourIcon },
  { key: 'number-square-5', label: i18n.t('collectionIcon.squareNumber5'), Icon: NumberSquareFiveIcon },
  { key: 'number-square-6', label: i18n.t('collectionIcon.squareNumber6'), Icon: NumberSquareSixIcon },
  { key: 'number-square-7', label: i18n.t('collectionIcon.squareNumber7'), Icon: NumberSquareSevenIcon },
  { key: 'number-square-8', label: i18n.t('collectionIcon.squareNumber8'), Icon: NumberSquareEightIcon },
  { key: 'number-square-9', label: i18n.t('collectionIcon.squareNumber9'), Icon: NumberSquareNineIcon },
] as const;

export const collectionColors = [
  { key: 'red', label: i18n.t('color.red') },
  { key: 'orange', label: i18n.t('color.orange') },
  { key: 'yellow', label: i18n.t('color.yellow') },
  { key: 'lime', label: i18n.t('color.lime') },
  { key: 'green', label: i18n.t('color.green') },
  { key: 'cyan', label: i18n.t('color.cyan') },
  { key: 'blue', label: i18n.t('color.blue') },
  { key: 'purple', label: i18n.t('color.purple') },
  { key: 'gray', label: i18n.t('color.gray') },
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
