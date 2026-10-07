import { Host, Image, type ImageProps } from '@expo/ui/swift-ui';
import { accessibilityHidden, environment, font } from '@expo/ui/swift-ui/modifiers';
import type { IconProps } from 'phosphor-react-native';
import { View } from 'react-native';

// 保持共享图标接口，符号固定使用英文形态且不重复朗读装饰图形。
function symbol(name: ImageProps['systemName'], filled?: ImageProps['systemName']) {
  return function SystemSymbol({ size = 24, color, weight = 'regular', style, mirrored = false, testID }: IconProps) {
    const points = typeof size === 'number' ? size : Number.parseFloat(size) || 24;
    return <View pointerEvents="none" accessible={false} testID={testID}
      style={[{ width: points, height: points }, style, mirrored && { transform: [{ scaleX: -1 }] }]}>
      <Host pointerEvents="none" ignoreSafeArea="all" style={{ width: points, height: points }}
        modifiers={[accessibilityHidden(), environment('locale', 'en')]}>
        <Image systemName={weight === 'fill' && filled ? filled : name} color={color} modifiers={[
          font({ size: points, weight: weight === 'bold' ? 'semibold' : weight === 'thin' ? 'thin' : weight === 'light' ? 'light' : 'regular' }),
          environment('locale', 'en'),
        ]} />
      </Host>
    </View>;
  };
}

export const ArchiveIcon = symbol('archivebox', 'archivebox.fill');
export const ArrowClockwiseIcon = symbol('arrow.clockwise');
export const ArrowCounterClockwiseIcon = symbol('arrow.counterclockwise');
export const BookmarkIcon = symbol('bookmark', 'bookmark.fill');
export const BookIcon = symbol('book.closed', 'book.closed.fill');
export const BooksIcon = symbol('books.vertical', 'books.vertical.fill');
export const BriefcaseIcon = symbol('briefcase', 'briefcase.fill');
export const CardsIcon = symbol('rectangle.on.rectangle');
export const CaretDownIcon = symbol('chevron.down');
export const CaretLeftIcon = symbol('chevron.left');
export const CaretRightIcon = symbol('chevron.right');
export const CaretUpIcon = symbol('chevron.up');
export const CheckIcon = symbol('checkmark');
export const CircleHalfIcon = symbol('circle.lefthalf.filled');
export const ClockIcon = symbol('clock', 'clock.fill');
export const CloudIcon = symbol('cloud', 'cloud.fill');
export const CloudArrowDownIcon = symbol('icloud.and.arrow.down');
export const CloudArrowUpIcon = symbol('icloud.and.arrow.up');
export const CloudCheckIcon = symbol('checkmark.icloud');
export const HardDrivesIcon = symbol('externaldrive.badge.icloud');
export const LassoIcon = symbol('lasso.badge.sparkles');
export const StethoscopeIcon = symbol('stethoscope');
export const TrayArrowUpIcon = symbol('tray.and.arrow.up');
export const WarningIcon = symbol('exclamationmark.triangle');
export const CopyIcon = symbol('doc.on.doc', 'doc.on.doc.fill');
export const DatabaseIcon = symbol('internaldrive', 'internaldrive.fill');
export const DotsThreeIcon = symbol('ellipsis');
export const DownloadSimpleIcon = symbol('arrow.down.to.line');
export const EyeIcon = symbol('eye', 'eye.fill');
export const EyeSlashIcon = symbol('eye.slash', 'eye.slash.fill');
export const FileTextIcon = symbol('doc.text', 'doc.text.fill');
export const FolderIcon = symbol('folder', 'folder.fill');
export const FolderPlusIcon = symbol('folder.badge.plus');
export const FunnelSimpleIcon = symbol('line.3.horizontal.decrease');
export const GearIcon = symbol('gearshape', 'gearshape.fill');
export const GiftIcon = symbol('gift', 'gift.fill');
export const HeartIcon = symbol('heart', 'heart.fill');
export const InfoIcon = symbol('info.circle', 'info.circle.fill');
export const ListIcon = symbol('list.bullet');
export const MagnifyingGlassIcon = symbol('magnifyingglass');
export const PackageIcon = symbol('shippingbox', 'shippingbox.fill');
export const PaintBrushIcon = symbol('paintbrush', 'paintbrush.fill');
export const PaperclipIcon = symbol('paperclip');
export const PencilSimpleIcon = symbol('pencil');
export const PlusIcon = symbol('plus');
export const SignatureIcon = symbol('signature');
export const SlidersHorizontalIcon = symbol('slider.horizontal.3');
export const SparkleIcon = symbol('sparkles');
export const SquaresFourIcon = symbol('square.grid.2x2', 'square.grid.2x2.fill');
export const StackIcon = symbol('rectangle.stack', 'rectangle.stack.fill');
export const StarIcon = symbol('star', 'star.fill');
export const SwatchesIcon = symbol('swatchpalette', 'swatchpalette.fill');
export const TagIcon = symbol('tag', 'tag.fill');
export const TextAaIcon = symbol('textformat');
export const TrashIcon = symbol('trash', 'trash.fill');
export const UserCircleIcon = symbol('person.crop.circle', 'person.crop.circle.fill');
export const XIcon = symbol('xmark');

export const NumberCircleZeroIcon = symbol('0.circle', '0.circle.fill');
export const NumberCircleOneIcon = symbol('1.circle', '1.circle.fill');
export const NumberCircleTwoIcon = symbol('2.circle', '2.circle.fill');
export const NumberCircleThreeIcon = symbol('3.circle', '3.circle.fill');
export const NumberCircleFourIcon = symbol('4.circle', '4.circle.fill');
export const NumberCircleFiveIcon = symbol('5.circle', '5.circle.fill');
export const NumberCircleSixIcon = symbol('6.circle', '6.circle.fill');
export const NumberCircleSevenIcon = symbol('7.circle', '7.circle.fill');
export const NumberCircleEightIcon = symbol('8.circle', '8.circle.fill');
export const NumberCircleNineIcon = symbol('9.circle', '9.circle.fill');
export const NumberSquareZeroIcon = symbol('0.square', '0.square.fill');
export const NumberSquareOneIcon = symbol('1.square', '1.square.fill');
export const NumberSquareTwoIcon = symbol('2.square', '2.square.fill');
export const NumberSquareThreeIcon = symbol('3.square', '3.square.fill');
export const NumberSquareFourIcon = symbol('4.square', '4.square.fill');
export const NumberSquareFiveIcon = symbol('5.square', '5.square.fill');
export const NumberSquareSixIcon = symbol('6.square', '6.square.fill');
export const NumberSquareSevenIcon = symbol('7.square', '7.square.fill');
export const NumberSquareEightIcon = symbol('8.square', '8.square.fill');
export const NumberSquareNineIcon = symbol('9.square', '9.square.fill');
