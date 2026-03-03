import { useEffect, useState, useCallback, useRef, useMemo } from "react";

// --- Configuration ---
const UPPTIME_OWNER = "Harris-Barrick-Software";
const UPPTIME_REPO = "servisuite-upptime";
const STATUS_PAGE_URL = "https://status.servisuite.com";
const GITHUB_API = "https://api.github.com";
const DISMISS_KEY = "servisuite-status-dismissed";

// --- Types ---
type Severity = "critical" | "major" | "minor" | "maintenance";
type EventKind = "active" | "scheduled";

interface GitHubLabel {
  name: string;
}

interface GitHubIssue {
  pull_request?: unknown;
  labels: GitHubLabel[];
  created_at: string;
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  comments: number;
  comments_url: string;
}

interface GitHubComment {
  body: string;
  created_at: string;
}

interface Incident {
  id: number;
  title: string;
  url: string;
  severity: Severity | null;
  kind: EventKind;
  services: string[];
  createdAt: string;
  latestUpdate: {
    body: string;
    createdAt: string;
  };
}

interface StatusDotProps {
  pollInterval?: number;
  className?: string;
}

const SERVICE_LABELS: Record<string, string> = {
  "service:app": "App",
  "service:api": "API",
  "service:marketing-site": "Marketing Site",
};

// --- Severity config ---
const SEVERITY_CONFIG: Record<
  Severity,
  { dot: string; bg: string; border: string; text: string; badge: string; icon: string; label: string }
> = {
  critical: {
    dot: "bg-red-500",
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-800",
    badge: "bg-red-100 text-red-700",
    icon: "🔴",
    label: "Critical Outage",
  },
  major: {
    dot: "bg-orange-500",
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-800",
    badge: "bg-orange-100 text-orange-700",
    icon: "🟠",
    label: "Major Disruption",
  },
  minor: {
    dot: "bg-yellow-500",
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    text: "text-yellow-800",
    badge: "bg-yellow-100 text-yellow-700",
    icon: "🟡",
    label: "Minor Issue",
  },
  maintenance: {
    dot: "bg-blue-500",
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
    badge: "bg-blue-100 text-blue-700",
    icon: "🔧",
    label: "Maintenance",
  },
};

const SCHEDULED_STYLE = {
  dot: "bg-slate-400",
  bg: "bg-slate-50",
  border: "border-slate-200",
  text: "text-slate-700",
  badge: "bg-slate-100 text-slate-600",
  icon: "📅",
  label: "Upcoming",
};

const SEVERITY_PRIORITY: Severity[] = ["critical", "major", "minor", "maintenance"];

// --- Helpers ---
function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/[#*_~`>\[\]()!]/g, "")
    .replace(/\n+/g, " ")
    .trim();
}

function parseSeverity(labels: GitHubLabel[]): Severity | null {
  for (const s of SEVERITY_PRIORITY) {
    if (labels.some((l) => l.name === s)) return s;
  }
  return null;
}

function isScheduled(labels: GitHubLabel[]): boolean {
  return labels.some((l) => l.name === "scheduled");
}

function parseServices(labels: GitHubLabel[]): string[] {
  return labels
    .map((l) => SERVICE_LABELS[l.name])
    .filter(Boolean);
}

function getWorstSeverity(incidents: Incident[]): Severity | null {
  const active = incidents.filter((i) => i.kind === "active");
  for (const s of SEVERITY_PRIORITY) {
    if (active.some((i) => i.severity === s)) return s;
  }
  return null;
}

function getDismissedIds(): Set<number> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function persistDismissedIds(ids: Set<number>): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]));
  } catch {}
}

function getIncidentStyle(incident: Incident) {
  if (incident.kind === "scheduled") return SCHEDULED_STYLE;
  if (incident.severity) return SEVERITY_CONFIG[incident.severity];
  return SEVERITY_CONFIG.minor;
}

// --- Hook: shared data fetching ---
function useStatusData(pollInterval: number) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dismissedIds, setDismissedIdsState] = useState<Set<number>>(new Set());
  const initialLoad = useRef(true);

  const setDismissed = useCallback((ids: Set<number>) => {
    persistDismissedIds(ids);
    setDismissedIdsState(ids);
  }, []);

  const fetchIncidents = useCallback(async () => {
    try {
      const issuesRes = await fetch(
        `${GITHUB_API}/repos/${UPPTIME_OWNER}/${UPPTIME_REPO}/issues?state=open&sort=created&direction=desc&per_page=10`
      );
      if (!issuesRes.ok) throw new Error("Failed to fetch issues");

      const issues = await issuesRes.json();

      const filtered = (issues as GitHubIssue[])
        .filter((issue) => !issue.pull_request);

      const results: Incident[] = await Promise.all(
        filtered.map(async (issue): Promise<Incident> => {
          let latestUpdate = {
            body: issue.body || issue.title,
            createdAt: issue.created_at,
          };

          if (issue.comments > 0) {
            const commentsRes = await fetch(
              `${issue.comments_url}?per_page=1&page=${issue.comments}`,
            );
            if (commentsRes.ok) {
              const comments = (await commentsRes.json()) as GitHubComment[];
              if (comments.length > 0) {
                latestUpdate = {
                  body: comments[0].body,
                  createdAt: comments[0].created_at,
                };
              }
            }
          }

          const labels = issue.labels;
          return {
            id: issue.number,
            title: issue.title,
            url: issue.html_url,
            severity: parseSeverity(labels),
            kind: isScheduled(labels) ? "scheduled" : "active",
            services: parseServices(labels),
            createdAt: issue.created_at,
            latestUpdate,
          };
        })
      );

      results.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "active" ? -1 : 1;
        const aIdx = a.severity ? SEVERITY_PRIORITY.indexOf(a.severity) : 99;
        const bIdx = b.severity ? SEVERITY_PRIORITY.indexOf(b.severity) : 99;
        return aIdx - bIdx;
      });

      setIncidents(results);
      setError(false);

      if (!initialLoad.current) {
        const currentDismissed = getDismissedIds();
        const activeIds = results.map((i) => i.id);
        const cleaned = new Set([...currentDismissed].filter((id) => activeIds.includes(id)));
        persistDismissedIds(cleaned);
        setDismissedIdsState(cleaned);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      initialLoad.current = false;
    }
  }, []);

  useEffect(() => {
    setDismissedIdsState(getDismissedIds());
    fetchIncidents();
    const interval = setInterval(fetchIncidents, pollInterval);
    return () => clearInterval(interval);
  }, [fetchIncidents, pollInterval]);

  return { incidents, loading, error, dismissedIds, setDismissed };
}

// --- Main Component ---
export function ServiSuiteStatus({
  pollInterval = 60_000,
  className,
}: StatusDotProps) {
  const { incidents, loading, error, dismissedIds, setDismissed } = useStatusData(pollInterval);
  const [panelOpen, setPanelOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLButtonElement>(null);

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        dotRef.current &&
        !dotRef.current.contains(e.target as Node)
      ) {
        setPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [panelOpen]);

  const undismissedIncidents = useMemo(
    () => incidents.filter((i) => !dismissedIds.has(i.id)),
    [incidents, dismissedIds]
  );
  const worst = getWorstSeverity(incidents);
  const hasIncidents = incidents.length > 0;
  const hasUndismissed = undismissedIncidents.length > 0;

  // Auto-show banner when new undismissed incidents appear
  const prevUndismissedIdsRef = useRef<string>("");
  useEffect(() => {
    const key = undismissedIncidents.map((i) => i.id).join(",");
    const prev = prevUndismissedIdsRef.current;
    if (prev !== "" && key !== prev && undismissedIncidents.length > 0) {
      setBannerDismissed(false);
    }
    prevUndismissedIdsRef.current = key;
  }, [undismissedIncidents]);

  const handleDismissBanner = () => {
    const next = new Set([...dismissedIds, ...undismissedIncidents.map((i) => i.id)]);
    setDismissed(next);
    setBannerDismissed(true);
  };

  // --- Dot color ---
  const dotColor = loading || error
    ? "bg-gray-400"
    : !hasIncidents
      ? "bg-green-500"
      : worst
        ? SEVERITY_CONFIG[worst].dot
        : incidents.some((i) => i.kind === "scheduled")
          ? SCHEDULED_STYLE.dot
          : "bg-green-500";

  const dotPulse = hasUndismissed && !bannerDismissed && !!worst && ["critical", "major"].includes(worst);

  // --- Tooltip text ---
  const tooltipText = loading
    ? "Checking status..."
    : error
      ? "Unable to check status"
      : !hasIncidents
        ? "All systems operational"
        : `${incidents.length} event${incidents.length > 1 ? "s" : ""}`;

  // --- Banner data ---
  const bannerPrimary = hasUndismissed ? undismissedIncidents[0] : null;
  const bannerStyle = bannerPrimary ? getIncidentStyle(bannerPrimary) : SCHEDULED_STYLE;

  return (
    <>
      {/* Sidebar dot */}
      <div className={`relative ${className ?? ""}`}>
        <button
          ref={dotRef}
          onClick={() => setPanelOpen(!panelOpen)}
          className="group relative flex items-center justify-center p-1.5 rounded-md hover:bg-gray-100 transition-colors"
          aria-label="System Status"
        >
          <span className={`size-2.5 rounded-full ${dotColor} ${dotPulse ? "animate-pulse" : ""}`} />

          {hasIncidents && (
            <span className="absolute -top-0.5 -right-0.5 size-3.5 flex items-center justify-center rounded-full bg-gray-700 text-white text-[9px] font-bold">
              {incidents.length}
            </span>
          )}

          {/* Tooltip */}
          <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-gray-900 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[1300]">
            {tooltipText}
          </span>
        </button>

        {/* Panel popover */}
        {panelOpen && (
          <div
            ref={panelRef}
            className="absolute left-full ml-2 top-0 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-[1300] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-900">System Status</span>
              <a
                href={STATUS_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 no-underline hover:underline"
              >
                Full status page
              </a>
            </div>

            {/* Content */}
            {!hasIncidents ? (
              <div className="px-3 py-6 text-center">
                <span className="inline-block size-3 rounded-full bg-green-500 mb-2" />
                <p className="text-sm text-gray-600">All systems operational</p>
                <p className="text-xs text-gray-400 mt-1">No active incidents</p>
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {incidents.map((incident) => {
                  const style = getIncidentStyle(incident);
                  const preview = stripMarkdown(incident.latestUpdate.body);

                  return (
                    <a
                      key={incident.id}
                      href={incident.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`block px-3 py-2.5 border-b border-gray-50 last:border-b-0 no-underline hover:brightness-95 transition-all ${style.bg}`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${style.badge}`}>
                          {style.icon} {incident.kind === "scheduled" ? "Upcoming" : style.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {timeAgo(incident.latestUpdate.createdAt)}
                        </span>
                      </div>
                      <p className={`text-sm font-medium ${style.text} mb-0.5`}>
                        {incident.title}
                      </p>
                      {incident.services.length > 0 && (
                        <div className="flex items-center gap-1 mb-1">
                          {incident.services.map((service) => (
                            <span
                              key={service}
                              className="inline-flex items-center px-1 py-0.5 rounded bg-white/80 text-[10px] font-medium text-gray-500"
                            >
                              {service}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-gray-500 leading-relaxed">
                        {preview.length > 120 ? `${preview.slice(0, 120)}...` : preview}
                      </p>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating banner — auto-shows for undismissed incidents */}
      {bannerPrimary && !bannerDismissed && (
        <div className="fixed top-0 left-0 right-0 z-[1400]" role="alert">
          <div className={`${bannerStyle.bg} ${bannerStyle.border} border-b shadow-sm`}>
            <div className="max-w-7xl mx-auto px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium shrink-0 ${bannerStyle.badge}`}>
                    {bannerStyle.icon} {bannerPrimary.kind === "scheduled" ? "Upcoming" : bannerStyle.label}
                  </span>
                  <span className={`text-sm font-medium truncate ${bannerStyle.text}`}>
                    {bannerPrimary.title}
                  </span>
                  {bannerPrimary.services.length > 0 && (
                    <div className="hidden sm:flex items-center gap-1">
                      {bannerPrimary.services.map((service) => (
                        <span
                          key={service}
                          className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/60 text-[11px] font-medium text-gray-600"
                        >
                          {service}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs ${bannerStyle.text} opacity-70`}>
                    {timeAgo(bannerPrimary.latestUpdate.createdAt)}
                  </span>
                  {undismissedIncidents.length > 1 && (
                    <span className={`text-xs font-medium ${bannerStyle.text}`}>
                      +{undismissedIncidents.length - 1} more
                    </span>
                  )}
                  <a
                    href={STATUS_PAGE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs font-medium px-2 py-1 rounded hover:bg-black/5 no-underline ${bannerStyle.text}`}
                  >
                    Details
                  </a>
                  <button
                    onClick={handleDismissBanner}
                    className={`p-1 rounded hover:bg-black/5 ${bannerStyle.text}`}
                    aria-label="Dismiss"
                  >
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className={`text-xs mt-1 ${bannerStyle.text} opacity-70`}>
                {(() => {
                  const p = stripMarkdown(bannerPrimary.latestUpdate.body);
                  return p.length > 200 ? `${p.slice(0, 200)}...` : p;
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ServiSuiteStatus;
