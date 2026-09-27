import {
  LayoutDashboard,
  Video,
  Search,
  UserSearch,
  Users,
  Bell,
  BarChart3,
  Sparkles,
  ScrollText,
  Cctv,
  PlayCircle,
  Settings,
  BookOpen,
  UserCog,
  BellRing,
  Webhook,
  GraduationCap,
  Gauge,
  ShieldCheck,
  CalendarClock,
  Database,
  Archive,
  Footprints,
  Flame,
  Activity,
  Lock,
  TrendingUp,
  Home,
  ScanFace,
  Wrench,
  FlaskConical,
  Radio,
  MonitorPlay,
  ClipboardCheck,
  Boxes,
  LayoutGrid,
  ListTodo,
  HeartPulse,
  SlidersHorizontal,
  Cpu,
  KeyRound,
  UserRoundCheck,
  BriefcaseBusiness,
  ServerCog,
  type LucideIcon,
} from "lucide-react";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Single source of truth for app navigation. Consumed by the sidebar,
 * the app header (breadcrumbs), the mobile tab bar and the ⌘K palette so
 * every surface agrees on labels, icons and role visibility.
 */

export type Role = "admin" | "viewer" | "auditor";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  labelKey: TranslationKey;
  /** Compact label for the phone tab bar (falls back to labelKey). */
  shortLabelKey?: TranslationKey;
  adminOnly?: boolean;
  auditorAllowed?: boolean;
  /** Extra search terms for the command palette. */
  keywords?: string[];
}

export interface NavGroup {
  id: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    labelKey: "nav_group_workspace",
    icon: Home,
    items: [
      { href: "/dashboard", icon: LayoutDashboard, labelKey: "nav_dashboard", shortLabelKey: "tab_dashboard", keywords: ["home", "overview"] },
      { href: "/live", icon: Video, labelKey: "nav_live", shortLabelKey: "tab_live", keywords: ["camera", "record", "webcam"] },
      { href: "/playback", icon: PlayCircle, labelKey: "nav_playback", shortLabelKey: "tab_playback", keywords: ["recording", "video"] },
      { href: "/alerts", icon: Bell, labelKey: "nav_alerts", shortLabelKey: "tab_alerts", adminOnly: true, keywords: ["history", "csv"] },
      { href: "/incidents", icon: BriefcaseBusiness, labelKey: "nav_incidents", adminOnly: true, keywords: ["case", "investigation", "evidence"] },
      { href: "/search", icon: Search, labelKey: "nav_search", adminOnly: true, keywords: ["face", "similarity"] },
      { href: "/analytics", icon: BarChart3, labelKey: "nav_analytics", shortLabelKey: "tab_analytics", keywords: ["charts", "stats"] },
    ],
  },
  {
    id: "monitoring",
    labelKey: "nav_group_monitoring",
    icon: MonitorPlay,
    items: [
      // Viewers watch /grid and /wall read-only; per-camera RLS still applies.
      { href: "/grid", icon: LayoutGrid, labelKey: "nav_grid", keywords: ["multi camera", "2x2", "3x3"] },
      { href: "/wall", icon: MonitorPlay, labelKey: "nav_wall", keywords: ["kiosk", "monitor"] },
      { href: "/cameras", icon: Cctv, labelKey: "nav_cameras", adminOnly: true, keywords: ["rtsp", "usb"] },
      { href: "/edge-agents", icon: ServerCog, labelKey: "nav_edge_agents", adminOnly: true, keywords: ["device", "gateway", "offline queue", "raspberry pi"] },
      { href: "/alerts-live", icon: Bell, labelKey: "nav_alerts_live", adminOnly: true, keywords: ["realtime", "live"] },
      { href: "/review", icon: ClipboardCheck, labelKey: "nav_review", adminOnly: true, keywords: ["label", "queue", "manual"] },
      { href: "/jobs", icon: ListTodo, labelKey: "nav_jobs", keywords: ["queue", "background", "reveal", "upload"] },
    ],
  },
  {
    id: "investigation",
    labelKey: "nav_group_investigation",
    icon: ScanFace,
    items: [
      { href: "/suspects", icon: UserSearch, labelKey: "nav_suspects", adminOnly: true, keywords: ["watchlist"] },
      { href: "/faces", icon: Users, labelKey: "nav_faces", adminOnly: true, keywords: ["gallery", "crops"] },
      { href: "/reid", icon: Footprints, labelKey: "nav_reid", adminOnly: true, keywords: ["trail", "re-identification"] },
      { href: "/clusters", icon: Boxes, labelKey: "nav_clusters", adminOnly: true, keywords: ["dbscan", "grouping"] },
      { href: "/heatmap", icon: Flame, labelKey: "nav_heatmap", adminOnly: true },
      { href: "/ai", icon: Sparkles, labelKey: "nav_ai", adminOnly: true, keywords: ["claude", "chat", "summary", "anomaly"] },
      { href: "/anomaly", icon: TrendingUp, labelKey: "nav_anomaly", adminOnly: true, keywords: ["z-score"] },
    ],
  },
  {
    id: "admin",
    labelKey: "nav_group_admin",
    icon: Wrench,
    items: [
      { href: "/users", icon: UserCog, labelKey: "nav_users", adminOnly: true, keywords: ["roles", "admin", "viewer"] },
      { href: "/reveal-approvals", icon: ShieldCheck, labelKey: "nav_reveal_approvals", adminOnly: true, keywords: ["unblur", "4-eyes", "approve"] },
      { href: "/audit", icon: ScrollText, labelKey: "nav_audit", shortLabelKey: "tab_audit", adminOnly: true, auditorAllowed: true, keywords: ["log", "hash chain"] },
      { href: "/privacy-zones", icon: Lock, labelKey: "nav_zones", adminOnly: true, keywords: ["mask", "zone"] },
      { href: "/alert-rules", icon: BellRing, labelKey: "nav_alert_rules", adminOnly: true, keywords: ["dedup", "quiet hours"] },
      { href: "/retention", icon: CalendarClock, labelKey: "nav_retention", adminOnly: true, keywords: ["purge", "policy"] },
      { href: "/health", icon: HeartPulse, labelKey: "nav_health", adminOnly: true, keywords: ["uptime", "liveness", "status"] },
      { href: "/backup", icon: Archive, labelKey: "nav_backup", adminOnly: true, keywords: ["export", "zip"] },
      { href: "/webhooks", icon: Webhook, labelKey: "nav_webhooks", adminOnly: true, keywords: ["slack", "discord"] },
      { href: "/settings", icon: Settings, labelKey: "nav_settings", adminOnly: true, keywords: ["totp", "passkey", "2fa", "profile"] },
      { href: "/db-monitor", icon: Database, labelKey: "nav_db_monitor", adminOnly: true, keywords: ["slow queries", "postgres"] },
    ],
  },
  {
    id: "ml",
    labelKey: "nav_group_ml",
    icon: FlaskConical,
    items: [
      { href: "/compare", icon: Sparkles, labelKey: "nav_compare", adminOnly: true, keywords: ["mask", "blur", "algorithm"] },
      { href: "/live-rtc", icon: Radio, labelKey: "nav_live_rtc", adminOnly: true, keywords: ["webrtc", "latency"] },
      { href: "/active-learning", icon: GraduationCap, labelKey: "nav_active_learning", adminOnly: true, keywords: ["label", "feedback", "threshold"] },
      { href: "/thresholds", icon: SlidersHorizontal, labelKey: "nav_thresholds", adminOnly: true, keywords: ["tuning", "similarity"] },
      { href: "/eval", icon: FlaskConical, labelKey: "nav_eval", adminOnly: true, keywords: ["roc", "f1", "confusion"] },
      { href: "/ml-lab", icon: Sparkles, labelKey: "nav_ml_lab", adminOnly: true, keywords: ["experiment"] },
      { href: "/benchmarks", icon: Gauge, labelKey: "nav_benchmarks", adminOnly: true, keywords: ["latency", "fps"] },
      { href: "/edge-detect", icon: Cpu, labelKey: "nav_edge_detect", adminOnly: true, keywords: ["onnx", "webgpu", "browser"] },
      { href: "/zk-reveal", icon: KeyRound, labelKey: "nav_zk_reveal", adminOnly: true, keywords: ["zero knowledge", "proof"] },
      // The (ε, δ) research demo. It lives here, with the other lab surfaces,
      // rather than under Resources where it read as a GDPR self-service page.
      { href: "/privacy", icon: UserRoundCheck, labelKey: "nav_privacy_dp", adminOnly: true, keywords: ["differential privacy", "epsilon", "noise"] },
      { href: "/perf-budget", icon: Activity, labelKey: "nav_perf", adminOnly: true, keywords: ["vitals", "performance"] },
    ],
  },
  {
    id: "resources",
    labelKey: "nav_group_resources",
    icon: BookOpen,
    items: [
      // Every role can open this one: /privacy is the admin-only differential-
      // privacy demo, so pointing "Privacy (GDPR)" at it bounced viewers and
      // left nobody but admins able to export or erase their own data.
      // Auditors may open it too (middleware allow-list).
      { href: "/my-data", icon: UserRoundCheck, labelKey: "nav_my_data", auditorAllowed: true, keywords: ["gdpr", "privacy", "export", "erase"] },
      { href: "/docs", icon: BookOpen, labelKey: "nav_docs", adminOnly: true, keywords: ["help", "documentation"] },
    ],
  },
];

/** Primary destinations for the mobile tab bar, in priority order. */
const MOBILE_TAB_HREFS = ["/dashboard", "/live", "/playback", "/alerts", "/analytics", "/audit"];

export function isItemVisible(item: NavItem, role: Role): boolean {
  if (role === "admin") return true;
  if (role === "auditor") return item.auditorAllowed === true;
  return !item.adminOnly;
}

export function visibleNavGroups(role: Role): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((i) => isItemVisible(i, role)),
  })).filter((group) => group.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** Longest-prefix match of the current pathname against the nav tree. */
export function findNavItem(pathname: string): { item: NavItem; group: NavGroup } | null {
  let best: { item: NavItem; group: NavGroup } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (isActivePath(pathname, item.href) && (!best || item.href.length > best.item.href.length)) {
        best = { item, group };
      }
    }
  }
  return best;
}

export function mobileTabs(role: Role, max = 4): NavItem[] {
  const all = NAV_GROUPS.flatMap((g) => g.items);
  const picked: NavItem[] = [];
  for (const href of MOBILE_TAB_HREFS) {
    const item = all.find((i) => i.href === href);
    if (item && isItemVisible(item, role)) picked.push(item);
    if (picked.length >= max) break;
  }
  return picked;
}
