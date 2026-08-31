import { forwardRef } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import {
  Activity03Icon,
  Add01Icon,
  Alert02Icon,
  AlertCircleIcon,
  Archive02Icon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUp02Icon,
  Attachment01Icon,
  BookOpen01Icon,
  Building02Icon,
  Cancel01Icon,
  CancelCircleIcon,
  ChartUpIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  ComputerIcon,
  DashboardSquare01Icon,
  Delete02Icon,
  File02Icon,
  FilterHorizontalIcon,
  FlashIcon,
  FloppyDiskIcon,
  GlobalIcon,
  HelpCircleIcon,
  InboxIcon,
  Key01Icon,
  Key02Icon,
  LinkSquare02Icon,
  ListViewIcon,
  Loading03Icon,
  LockIcon,
  Logout01Icon,
  Mail01Icon,
  MailRemove01Icon,
  Megaphone01Icon,
  Menu01Icon,
  RefreshIcon,
  Search01Icon,
  Sent02Icon,
  ServerIcon,
  Settings02Icon,
  Shield01Icon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  TextBoldIcon,
  TextItalicIcon,
  Tick02Icon,
  Timer02Icon,
  UserCheck01Icon,
  UserGroupIcon,
  UserIcon,
  ViewIcon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons';

/**
 * The admin panel's icon vocabulary.
 *
 * Every icon that used to come from `lucide-react` is served from here as a
 * Hugeicons glyph, mirroring `frontend/src/shared/components/icons` so the two
 * apps draw the same action the same way. One table instead of 21 scattered
 * import lines is what enforces that: an action can only have one glyph,
 * because only one place says which glyph it is.
 *
 * Hugeicons ships a single `<HugeiconsIcon icon={glyph} />` component rather
 * than one component per icon, so each entry below is wrapped into a component
 * of its own. That keeps every call site exactly as written --
 * `<Trash2 size={16} color="..." />` -- so this migration changes which glyphs
 * are drawn and nothing else about the markup, props, sizing or behaviour.
 * `size`, `color`, `className`, `strokeWidth` and `fill` all forward through to
 * the SVG unchanged, which is why no call site needed editing beyond its import.
 *
 * The exported names are deliberately the ones the call sites already use, even
 * where they are Lucide-isms (`Trash2`, `Loader2`, `Building2`). Renaming ~200
 * references was avoidable churn against a migration that is meant to be
 * behaviour-neutral.
 *
 * Stroke weight: Hugeicons glyphs are drawn at 1.5 where Lucide's were 2. The
 * native weight is kept rather than forced, matching the main frontend; call
 * sites passing an explicit `strokeWidth` still win, exactly as before.
 */

type IconProps = React.ComponentProps<typeof HugeiconsIcon>;
/** Call sites supply the glyph, so `icon` is fixed by the wrapper. */
export type AdminIconProps = Omit<IconProps, 'icon'>;

const icon = (
  glyph: IconSvgElement,
  name: string,
  defaultProps: Partial<AdminIconProps> = {},
) => {
  const Icon = forwardRef<SVGSVGElement, AdminIconProps>((props, ref) => (
    <HugeiconsIcon ref={ref} icon={glyph} {...defaultProps} {...props} />
  ));
  Icon.displayName = name;
  return Icon;
};

// -- Directional. Chevrons keep chevron weight (Arrow*01); the travel arrows in
//    the sort controls keep their shaft (Arrow*02), the same distinction the
//    Lucide set drew.
export const ChevronDown = /*#__PURE__*/ icon(ArrowDown01Icon, 'ChevronDown');
export const ChevronLeft = /*#__PURE__*/ icon(ArrowLeft01Icon, 'ChevronLeft', { strokeWidth: 2.25 });
export const ChevronRight = /*#__PURE__*/ icon(ArrowRight01Icon, 'ChevronRight', { strokeWidth: 2.25 });
export const ArrowRight = /*#__PURE__*/ icon(ArrowRight02Icon, 'ArrowRight', { strokeWidth: 2.25 });
export const ArrowUp = /*#__PURE__*/ icon(ArrowUp02Icon, 'ArrowUp');
export const ArrowDown = /*#__PURE__*/ icon(ArrowDown02Icon, 'ArrowDown');

// -- Close / dismiss / confirm
export const X = /*#__PURE__*/ icon(Cancel01Icon, 'X');
export const XCircle = /*#__PURE__*/ icon(CancelCircleIcon, 'XCircle');
export const Check = /*#__PURE__*/ icon(Tick02Icon, 'Check');
export const CheckCircle = /*#__PURE__*/ icon(CheckmarkCircle02Icon, 'CheckCircle');

// -- Status / feedback
export const AlertCircle = /*#__PURE__*/ icon(AlertCircleIcon, 'AlertCircle');
export const AlertTriangle = /*#__PURE__*/ icon(Alert02Icon, 'AlertTriangle');
export const HelpCircle = /*#__PURE__*/ icon(HelpCircleIcon, 'HelpCircle');
export const Loader2 = /*#__PURE__*/ icon(Loading03Icon, 'Loader2');
export const RefreshCw = /*#__PURE__*/ icon(RefreshIcon, 'RefreshCw');
export const Sparkles = /*#__PURE__*/ icon(SparklesIcon, 'Sparkles');
export const Clock = /*#__PURE__*/ icon(Clock01Icon, 'Clock');
export const Timer = /*#__PURE__*/ icon(Timer02Icon, 'Timer');
// Service health and the live-metrics heading. A pulse trace, not the Crew
// glyph the main app uses for its own unrelated "Activity" filter.
export const Activity = /*#__PURE__*/ icon(Activity03Icon, 'Activity');

// -- Chrome / navigation
export const Menu = /*#__PURE__*/ icon(Menu01Icon, 'Menu');
export const Search = /*#__PURE__*/ icon(Search01Icon, 'Search');
export const Settings = /*#__PURE__*/ icon(Settings02Icon, 'Settings');
export const Plus = /*#__PURE__*/ icon(Add01Icon, 'Plus');
export const LayoutDashboard = /*#__PURE__*/ icon(DashboardSquare01Icon, 'LayoutDashboard');
export const ExternalLink = /*#__PURE__*/ icon(LinkSquare02Icon, 'ExternalLink');
export const List = /*#__PURE__*/ icon(ListViewIcon, 'List');
export const SlidersHorizontal = /*#__PURE__*/ icon(FilterHorizontalIcon, 'SlidersHorizontal');
export const Building2 = /*#__PURE__*/ icon(Building02Icon, 'Building2');
/** Public, student-facing traffic — the counterpart to the admin portal. */
export const Globe = /*#__PURE__*/ icon(GlobalIcon, 'Globe');
export const BookOpen = /*#__PURE__*/ icon(BookOpen01Icon, 'BookOpen');
export const Archive = /*#__PURE__*/ icon(Archive02Icon, 'Archive');
export const Star = /*#__PURE__*/ icon(StarIcon, 'Star');
export const TrendingUp = /*#__PURE__*/ icon(ChartUpIcon, 'TrendingUp');
export const Zap = /*#__PURE__*/ icon(FlashIcon, 'Zap');
export const Save = /*#__PURE__*/ icon(FloppyDiskIcon, 'Save');

// -- Mail / support
export const Mail = /*#__PURE__*/ icon(Mail01Icon, 'Mail');
/** Delivery failed — a message that did not arrive, not merely a warning. */
export const MailWarning = /*#__PURE__*/ icon(MailRemove01Icon, 'MailWarning');
export const Inbox = /*#__PURE__*/ icon(InboxIcon, 'Inbox');
export const Send = /*#__PURE__*/ icon(Sent02Icon, 'Send');
export const Paperclip = /*#__PURE__*/ icon(Attachment01Icon, 'Paperclip');
export const Megaphone = /*#__PURE__*/ icon(Megaphone01Icon, 'Megaphone');

// -- People / security
export const User = /*#__PURE__*/ icon(UserIcon, 'User');
export const Users = /*#__PURE__*/ icon(UserGroupIcon, 'Users');
export const UserCheck = /*#__PURE__*/ icon(UserCheck01Icon, 'UserCheck');
export const Shield = /*#__PURE__*/ icon(Shield01Icon, 'Shield');
export const ShieldAlert = /*#__PURE__*/ icon(ShieldAlertIcon, 'ShieldAlert');
export const ShieldCheck = /*#__PURE__*/ icon(ShieldCheckIcon, 'ShieldCheck');
export const Lock = /*#__PURE__*/ icon(LockIcon, 'Lock');
export const LogOut = /*#__PURE__*/ icon(Logout01Icon, 'LogOut');
export const Key = /*#__PURE__*/ icon(Key01Icon, 'Key');
export const KeyRound = /*#__PURE__*/ icon(Key02Icon, 'KeyRound');

// -- Content / data
export const FileText = /*#__PURE__*/ icon(File02Icon, 'FileText');
export const Eye = /*#__PURE__*/ icon(ViewIcon, 'Eye');
export const EyeOff = /*#__PURE__*/ icon(ViewOffSlashIcon, 'EyeOff');
export const Trash2 = /*#__PURE__*/ icon(Delete02Icon, 'Trash2');
export const Server = /*#__PURE__*/ icon(ServerIcon, 'Server');
export const Monitor = /*#__PURE__*/ icon(ComputerIcon, 'Monitor');

// -- Rich-text controls in the reply composer
export const Bold = /*#__PURE__*/ icon(TextBoldIcon, 'Bold');
export const Italic = /*#__PURE__*/ icon(TextItalicIcon, 'Italic');
