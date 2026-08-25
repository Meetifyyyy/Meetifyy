import { forwardRef } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowTurnForwardIcon,
  ArrowUp01Icon,
  BarChartIcon,
  Bookmark02Icon,
  Calendar03Icon,
  CalendarAdd01Icon,
  CalendarClockIcon,
  CalendarRangeIcon,
  CalendarRemove01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Comment01Icon,
  CommentAdd01Icon,
  Compass01Icon,
  Pacman02Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  File02Icon,
  FileImageIcon,
  FileRemoveIcon,
  Flag02Icon,
  GlobalIcon,
  GraduationCapIcon,
  GridIcon,
  HelpCircleIcon,
  Image01Icon,
  ImageAdd01Icon,
  ImageNotFound01Icon,
  InformationCircleIcon,
  Link01Icon,
  LinkSquare02Icon,
  ListViewIcon,
  Loading03Icon,
  Location01Icon,
  LockIcon,
  Logout01Icon,
  Mail01Icon,
  MailValidation01Icon,
  Megaphone01Icon,
  Menu01Icon,
  Mic01Icon,
  Moon02Icon,
  MoreVerticalIcon,
  Notification03Icon,
  NotificationOff03Icon,
  PinIcon,
  PlayIcon,
  RefreshIcon,
  ReplyIcon,
  School01Icon,
  Search01Icon,
  Sent02Icon,
  Settings02Icon,
  Shield01Icon,
  ShieldMinusIcon,
  ShieldOffIcon,
  ShieldPlusIcon,
  SparklesIcon,
  StickerIcon,
  Sun03Icon,
  Tick02Icon,
  TickDouble02Icon,
  UndoIcon,
  UnfoldMoreIcon,
  Upload03Icon,
  UserAdd02Icon,
  UserBlock01Icon,
  UserCheck01Icon,
  UserGroupIcon,
  UserIcon,
  UserRemove01Icon,
  Video01Icon,
  ViewIcon,
  ViewOffSlashIcon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';

/**
 * The application's icon vocabulary.
 *
 * Every icon that used to come from `lucide-react` is served from here as a
 * Hugeicons glyph. Having one table instead of 70-odd scattered import lines is
 * what actually enforces the consistency rule: an action can only ever have one
 * glyph, because there is only one place that says which glyph it is. Changing
 * the icon for "delete" is a one-line edit that lands everywhere at once.
 *
 * Hugeicons ships a single `<HugeiconsIcon icon={glyph} />` component rather
 * than one component per icon, so each entry below is wrapped into a component
 * of its own. That keeps every call site exactly as it was written --
 * `<Trash2 size={16} className="x" />` -- so this migration changes which
 * glyphs are drawn and nothing else about the markup, props, sizing or
 * behaviour around them.
 *
 * The exported names are deliberately the ones the call sites already use. They
 * are not always what you would pick from scratch (`Trash2`, `Loader2` and
 * `Globe2` are Lucide-isms), but renaming ~700 references by text would have
 * meant rewriting identifiers that also appear inside strings and prop values,
 * and the risk of that is not worth the tidier vocabulary. Renaming them is a
 * safe, separate, mechanical follow-up.
 *
 * Note on stroke weight: Hugeicons glyphs are drawn at stroke-width 1.5 where
 * Lucide's were 2. The native weight is kept rather than forced to 2, so the
 * set looks like what it is; call sites that pass an explicit `strokeWidth`
 * still win, exactly as before.
 */
const icon = (glyph, name) => {
  const Icon = forwardRef((props, ref) => <HugeiconsIcon ref={ref} icon={glyph} {...props} />);
  Icon.displayName = name;
  return Icon;
};

const GLYPHS = {
  // Grouped by meaning: entries sharing a glyph are the SAME action in the UI.
  // -- Directional: chevrons stay chevron-weight (Arrow*01), travel arrows keep
  //    their shaft (Arrow*02). Same distinction the Lucide set drew.
  ChevronDown: ArrowDown01Icon,
  ChevronUp: ArrowUp01Icon,
  ChevronLeft: ArrowLeft01Icon,
  ChevronRight: ArrowRight01Icon,
  ArrowLeft: ArrowLeft02Icon,
  ArrowRight: ArrowRight02Icon,
  ChevronsUpDown: UnfoldMoreIcon,

  // -- Close / dismiss
  X: Cancel01Icon,
  XCircle: CancelCircleIcon,

  // -- Confirm
  Check: Tick02Icon,
  CheckCheck: TickDouble02Icon,
  CheckCircle2: CheckmarkCircle02Icon,

  // -- Status / feedback
  AlertCircle: AlertCircleIcon,
  AlertTriangle: Alert02Icon,
  Info: InformationCircleIcon,
  HelpCircle: HelpCircleIcon,
  Loader2: Loading03Icon,
  RefreshCw: RefreshIcon,
  WifiOff: WifiDisconnected01Icon,
  Sparkles: SparklesIcon,

  // -- Chrome
  Menu: Menu01Icon,
  MoreVertical: MoreVerticalIcon,
  Search: Search01Icon,
  Settings: Settings02Icon,
  Plus: Add01Icon,
  Compass: Compass01Icon,
  // The Activities/Crew filter chip on the search page, by explicit request.
  // Note this is deliberately NOT the compass the sidebar and bottom nav use
  // for Crew, so the two surfaces name the same thing with different glyphs.
  Activity: Pacman02Icon,
  ExternalLink: LinkSquare02Icon,
  Grid: GridIcon,
  List: ListViewIcon,
  Sun: Sun03Icon,
  Moon: Moon02Icon,

  // -- Messaging. MessageCircle and MessageSquare were two glyphs for one
  //    meaning ("a comment"); they collapse to one here.
  MessageCircle: Comment01Icon,
  MessageSquare: Comment01Icon,
  MessageSquarePlus: CommentAdd01Icon,
  Send: Sent02Icon,
  Reply: ReplyIcon,
  Forward: ArrowTurnForwardIcon,
  Undo2: UndoIcon,
  Copy: Copy01Icon,
  Pin: PinIcon,
  Mic: Mic01Icon,
  Sticker: StickerIcon,

  // -- Notifications.
  //    `Bell` is the standing "Notifications" label (a settings row, a nav
  //    entry) -- not a control.
  //    NotificationOn/NotificationOff are the mute toggle, and they are the
  //    ONLY pair any mute control may use. Muting used to be drawn four
  //    different ways depending on where you found it: BellRing/BellOff in the
  //    chat headers and context menus, a VolumeX speaker on the conversation
  //    rows, and a hand-inlined bell/bell-with-slash pair in the community
  //    header. Those are gone; every one of those places renders this pair now,
  //    so a muted chat and a muted community look like the same thing.
  Bell: Notification03Icon,
  NotificationOn: Notification03Icon,
  NotificationOff: NotificationOff03Icon,
  Megaphone: Megaphone01Icon,

  // -- People / moderation
  User: UserIcon,
  Users: UserGroupIcon,
  UserCheck: UserCheck01Icon,
  UserPlus: UserAdd02Icon,
  UserX: UserRemove01Icon,
  Ban: UserBlock01Icon,
  Flag: Flag02Icon,
  Shield: Shield01Icon,
  ShieldOff: ShieldOffIcon,
  ShieldPlus: ShieldPlusIcon,
  ShieldMinus: ShieldMinusIcon,
  Lock: LockIcon,
  LogOut: Logout01Icon,
  School: School01Icon,
  GraduationCap: GraduationCapIcon,

  // -- Dates & time
  Calendar: Calendar03Icon,
  CalendarDays: Calendar03Icon,
  CalendarClock: CalendarClockIcon,
  CalendarPlus: CalendarAdd01Icon,
  CalendarRange: CalendarRangeIcon,
  CalendarX: CalendarRemove01Icon,
  Clock: Clock01Icon,

  // -- Media & files
  Image: Image01Icon,
  ImageIcon: Image01Icon,
  ImageOff: ImageNotFound01Icon,
  ImagePlus: ImageAdd01Icon,
  FileImage: FileImageIcon,
  FileText: File02Icon,
  FileX: FileRemoveIcon,
  Video: Video01Icon,
  Play: PlayIcon,
  Upload: Upload03Icon,
  BarChart2: BarChartIcon,

  // -- Content
  Bookmark: Bookmark02Icon,
  Trash2: Delete02Icon,
  Pencil: Edit02Icon,
  Eye: ViewIcon,
  EyeOff: ViewOffSlashIcon,
  Mail: Mail01Icon,
  MailCheck: MailValidation01Icon,
  MapPin: Location01Icon,
  Globe2: GlobalIcon,
  // Link and Link2 are both "a URL".
  Link: Link01Icon,
  Link2: Link01Icon
};

export const ChevronDown = /*#__PURE__*/ icon(GLYPHS.ChevronDown, 'ChevronDown');
export const ChevronUp = /*#__PURE__*/ icon(GLYPHS.ChevronUp, 'ChevronUp');
export const ChevronLeft = /*#__PURE__*/ icon(GLYPHS.ChevronLeft, 'ChevronLeft');
export const ChevronRight = /*#__PURE__*/ icon(GLYPHS.ChevronRight, 'ChevronRight');
export const ArrowLeft = /*#__PURE__*/ icon(GLYPHS.ArrowLeft, 'ArrowLeft');
export const ArrowRight = /*#__PURE__*/ icon(GLYPHS.ArrowRight, 'ArrowRight');
export const ChevronsUpDown = /*#__PURE__*/ icon(GLYPHS.ChevronsUpDown, 'ChevronsUpDown');
export const X = /*#__PURE__*/ icon(GLYPHS.X, 'X');
export const XCircle = /*#__PURE__*/ icon(GLYPHS.XCircle, 'XCircle');
export const CircleX = XCircle;
export const CircleXIcon = XCircle;
export const CancelCircle = XCircle;
export const Check = /*#__PURE__*/ icon(GLYPHS.Check, 'Check');
export const CheckCheck = /*#__PURE__*/ icon(GLYPHS.CheckCheck, 'CheckCheck');
export const CheckCircle2 = /*#__PURE__*/ icon(GLYPHS.CheckCircle2, 'CheckCircle2');
export const AlertCircle = /*#__PURE__*/ icon(GLYPHS.AlertCircle, 'AlertCircle');
export const AlertTriangle = /*#__PURE__*/ icon(GLYPHS.AlertTriangle, 'AlertTriangle');
export const Info = /*#__PURE__*/ icon(GLYPHS.Info, 'Info');
export const HelpCircle = /*#__PURE__*/ icon(GLYPHS.HelpCircle, 'HelpCircle');
export const Loader2 = /*#__PURE__*/ icon(GLYPHS.Loader2, 'Loader2');
export const RefreshCw = /*#__PURE__*/ icon(GLYPHS.RefreshCw, 'RefreshCw');
export const WifiOff = /*#__PURE__*/ icon(GLYPHS.WifiOff, 'WifiOff');
export const Sparkles = /*#__PURE__*/ icon(GLYPHS.Sparkles, 'Sparkles');
export const Menu = /*#__PURE__*/ icon(GLYPHS.Menu, 'Menu');
export const MoreVertical = /*#__PURE__*/ icon(GLYPHS.MoreVertical, 'MoreVertical');
export const Search = /*#__PURE__*/ icon(GLYPHS.Search, 'Search');
export const Settings = /*#__PURE__*/ icon(GLYPHS.Settings, 'Settings');
export const Plus = /*#__PURE__*/ icon(GLYPHS.Plus, 'Plus');
export const Compass = /*#__PURE__*/ icon(GLYPHS.Compass, 'Compass');
export const Activity = /*#__PURE__*/ icon(GLYPHS.Activity, 'Activity');
export const ExternalLink = /*#__PURE__*/ icon(GLYPHS.ExternalLink, 'ExternalLink');
export const Grid = /*#__PURE__*/ icon(GLYPHS.Grid, 'Grid');
export const List = /*#__PURE__*/ icon(GLYPHS.List, 'List');
export const Sun = /*#__PURE__*/ icon(GLYPHS.Sun, 'Sun');
export const Moon = /*#__PURE__*/ icon(GLYPHS.Moon, 'Moon');
export const MessageCircle = /*#__PURE__*/ icon(GLYPHS.MessageCircle, 'MessageCircle');
export const MessageSquare = /*#__PURE__*/ icon(GLYPHS.MessageSquare, 'MessageSquare');
export const MessageSquarePlus = /*#__PURE__*/ icon(GLYPHS.MessageSquarePlus, 'MessageSquarePlus');
export const Send = /*#__PURE__*/ icon(GLYPHS.Send, 'Send');
export const Reply = /*#__PURE__*/ icon(GLYPHS.Reply, 'Reply');
export const Forward = /*#__PURE__*/ icon(GLYPHS.Forward, 'Forward');
export const Undo2 = /*#__PURE__*/ icon(GLYPHS.Undo2, 'Undo2');
export const Copy = /*#__PURE__*/ icon(GLYPHS.Copy, 'Copy');
export const Pin = /*#__PURE__*/ icon(GLYPHS.Pin, 'Pin');
export const Mic = /*#__PURE__*/ icon(GLYPHS.Mic, 'Mic');
export const Sticker = /*#__PURE__*/ icon(GLYPHS.Sticker, 'Sticker');
export const Bell = /*#__PURE__*/ icon(GLYPHS.Bell, 'Bell');
export const NotificationOn = /*#__PURE__*/ icon(GLYPHS.NotificationOn, 'NotificationOn');
export const NotificationOff = /*#__PURE__*/ icon(GLYPHS.NotificationOff, 'NotificationOff');
export const Megaphone = /*#__PURE__*/ icon(GLYPHS.Megaphone, 'Megaphone');
export const User = /*#__PURE__*/ icon(GLYPHS.User, 'User');
export const Users = /*#__PURE__*/ icon(GLYPHS.Users, 'Users');
export const UserCheck = /*#__PURE__*/ icon(GLYPHS.UserCheck, 'UserCheck');
export const UserPlus = /*#__PURE__*/ icon(GLYPHS.UserPlus, 'UserPlus');
export const UserAdd = UserPlus;
export const UserX = /*#__PURE__*/ icon(GLYPHS.UserX, 'UserX');
export const Ban = /*#__PURE__*/ icon(GLYPHS.Ban, 'Ban');
export const Flag = /*#__PURE__*/ icon(GLYPHS.Flag, 'Flag');
export const Shield = /*#__PURE__*/ icon(GLYPHS.Shield, 'Shield');
export const ShieldOff = /*#__PURE__*/ icon(GLYPHS.ShieldOff, 'ShieldOff');
export const ShieldPlus = /*#__PURE__*/ icon(GLYPHS.ShieldPlus, 'ShieldPlus');
export const ShieldMinus = /*#__PURE__*/ icon(GLYPHS.ShieldMinus, 'ShieldMinus');
export const Lock = /*#__PURE__*/ icon(GLYPHS.Lock, 'Lock');
export const LogOut = /*#__PURE__*/ icon(GLYPHS.LogOut, 'LogOut');
export const School = /*#__PURE__*/ icon(GLYPHS.School, 'School');
export const GraduationCap = /*#__PURE__*/ icon(GLYPHS.GraduationCap, 'GraduationCap');
export const Calendar = /*#__PURE__*/ icon(GLYPHS.Calendar, 'Calendar');
export const CalendarDays = /*#__PURE__*/ icon(GLYPHS.CalendarDays, 'CalendarDays');
export const CalendarClock = /*#__PURE__*/ icon(GLYPHS.CalendarClock, 'CalendarClock');
export const CalendarPlus = /*#__PURE__*/ icon(GLYPHS.CalendarPlus, 'CalendarPlus');
export const CalendarRange = /*#__PURE__*/ icon(GLYPHS.CalendarRange, 'CalendarRange');
export const CalendarX = /*#__PURE__*/ icon(GLYPHS.CalendarX, 'CalendarX');
export const Clock = /*#__PURE__*/ icon(GLYPHS.Clock, 'Clock');
export const Image = /*#__PURE__*/ icon(GLYPHS.Image, 'Image');
export const ImageIcon = /*#__PURE__*/ icon(GLYPHS.ImageIcon, 'ImageIcon');
export const ImageOff = /*#__PURE__*/ icon(GLYPHS.ImageOff, 'ImageOff');
export const ImagePlus = /*#__PURE__*/ icon(GLYPHS.ImagePlus, 'ImagePlus');
export const FileImage = /*#__PURE__*/ icon(GLYPHS.FileImage, 'FileImage');
export const FileText = /*#__PURE__*/ icon(GLYPHS.FileText, 'FileText');
export const FileX = /*#__PURE__*/ icon(GLYPHS.FileX, 'FileX');
export const Video = /*#__PURE__*/ icon(GLYPHS.Video, 'Video');
export const Play = /*#__PURE__*/ icon(GLYPHS.Play, 'Play');
export const Upload = /*#__PURE__*/ icon(GLYPHS.Upload, 'Upload');
export const BarChart2 = /*#__PURE__*/ icon(GLYPHS.BarChart2, 'BarChart2');
export const Bookmark = /*#__PURE__*/ icon(GLYPHS.Bookmark, 'Bookmark');
export const Trash2 = /*#__PURE__*/ icon(GLYPHS.Trash2, 'Trash2');
export const Pencil = /*#__PURE__*/ icon(GLYPHS.Pencil, 'Pencil');
export const Eye = /*#__PURE__*/ icon(GLYPHS.Eye, 'Eye');
export const EyeOff = /*#__PURE__*/ icon(GLYPHS.EyeOff, 'EyeOff');
export const Mail = /*#__PURE__*/ icon(GLYPHS.Mail, 'Mail');
export const MailCheck = /*#__PURE__*/ icon(GLYPHS.MailCheck, 'MailCheck');
export const MapPin = /*#__PURE__*/ icon(GLYPHS.MapPin, 'MapPin');
export const Globe2 = /*#__PURE__*/ icon(GLYPHS.Globe2, 'Globe2');
export const Link = /*#__PURE__*/ icon(GLYPHS.Link, 'Link');
export const Link2 = /*#__PURE__*/ icon(GLYPHS.Link2, 'Link2');
