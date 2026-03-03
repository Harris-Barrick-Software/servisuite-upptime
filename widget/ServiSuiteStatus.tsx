"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// --- Configuration ---
const UPPTIME_OWNER = "Harris-Barrick-Software";
const UPPTIME_REPO = "servisuite-upptime";
const STATUS_PAGE_URL = "https://status.servisuite.com";
const GITHUB_API = "https://api.github.com";
const MAINTENANCE_LOOKAHEAD_DAYS = 7;
const DISMISS_KEY = "servisuite-status-dismissed";

// --- Types ---
type Severity = "critical" | "major" | "minor" | "maintenance";
type EventKind = "active" | "scheduled";

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

interface StatusBannerProps {
  /** Polling interval in ms. Default: 60000 (1 min) */
  pollInterval?: number;
  /** Position of the banner. Default: "top" */
  position?: "top" | "bottom";
  /** Additional CSS class on the root element */
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
  { bg: string; border: string; text: string; badge: string; icon: string; label: string }
> = {
  critical: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-800",
    badge: "bg-red-100 text-red-700",
    icon: "🔴",
    label: "Critical Outage",
  },
  major: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-800",
    badge: "bg-orange-100 text-orange-700",
    icon: "🟠",
    label: "Major Disruption",
  },
  minor: {
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    text: "text-yellow-800",
    badge: "bg-yellow-100 text-yellow-700",
    icon: "🟡",
    label: "Minor Issue",
  },
  maintenance: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
    badge: "bg-blue-100 text-blue-700",
    icon: "🔧",
    label: "Maintenance",
  },
};

const SCHEDULED_STYLE = {
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

function parseSeverity(labels: any[]): Severity | null {
  for (const s of SEVERITY_PRIORITY) {
    if (labels.some((l: any) => l.name === s)) return s;
  }
  return null;
}

function isScheduled(labels: any[]): boolean {
  return labels.some((l: any) => l.name === "scheduled");
}

function parseServices(labels: any[]): string[] {
  return labels
    .map((l: any) => SERVICE_LABELS[l.name])
    .filter(Boolean);
}

function getWorstSeverity(incidents: Incident[]): Severity | null {
  // Only consider active (non-scheduled) incidents for worst severity
  const active = incidents.filter((i) => i.kind === "active");
  for (const s of SEVERITY_PRIORITY) {
    if (active.some((i) => i.severity === s)) return s;
  }
  return null;
}

function isWithinLookahead(dateStr: string): boolean {
  const created = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + MAINTENANCE_LOOKAHEAD_DAYS);
  return created <= cutoff;
}

function getDismissedIds(): Set<number> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function setDismissedIds(ids: Set<number>): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]));
  } catch {}
}

// --- Component ---
export function ServiSuiteStatus({
  pollInterval = 60_000,
  position = "top",
  className,
}: StatusBannerProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dismissedIds, setDismissedIdsState] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const initialLoad = useRef(true);

  const fetchIncidents = useCallback(async () => {
    try {
      const issuesRes = await fetch(
        `${GITHUB_API}/repos/${UPPTIME_OWNER}/${UPPTIME_REPO}/issues?state=open&sort=created&direction=desc&per_page=10`
      );

      if (!issuesRes.ok) throw new Error("Failed to fetch issues");

      const issues = await issuesRes.json();

      const filtered = issues
        .filter((issue: any) => !issue.pull_request)
        .filter((issue: any) => {
          // Scheduled events: only show if within 7-day lookahead
          if (isScheduled(issue.labels || [])) {
            return isWithinLookahead(issue.created_at);
          }
          return true;
        });

      const results: Incident[] = await Promise.all(
        filtered.map(async (issue: any): Promise<Incident> => {
          let latestUpdate = {
            body: issue.body || issue.title,
            createdAt: issue.created_at,
          };

          if (issue.comments > 0) {
            const commentsRes = await fetch(
              `${issue.comments_url}?per_page=1&page=${issue.comments}`,
            );
            if (commentsRes.ok) {
              const comments = await commentsRes.json();
              if (comments.length > 0) {
                latestUpdate = {
                  body: comments[0].body,
                  createdAt: comments[0].created_at,
                };
              }
            }
          }

          const labels = issue.labels || [];

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

      // Sort: active incidents first (by severity), then scheduled
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
        setDismissedIds(cleaned);
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

  const visibleIncidents = incidents.filter((i) => !dismissedIds.has(i.id));
  const activeIncidents = visibleIncidents.filter((i) => i.kind === "active");
  const scheduledIncidents = visibleIncidents.filter((i) => i.kind === "scheduled");
  const worst = getWorstSeverity(visibleIncidents);

  const handleDismiss = (id: number) => {
    const next = new Set(dismissedIds);
    next.add(id);
    setDismissedIds(next);
    setDismissedIdsState(next);
  };

  const handleDismissAll = () => {
    const next = new Set(incidents.map((i) => i.id));
    setDismissedIds(next);
    setDismissedIdsState(next);
    setExpanded(false);
  };

  // Nothing to show
  if (loading || error || visibleIncidents.length === 0) {
    return null;
  }

  const positionClasses = position === "top"
    ? "top-0 left-0 right-0"
    : "bottom-0 left-0 right-0";

  // Banner color: based on worst active severity, or slate if only scheduled
  const bannerStyle = worst
    ? SEVERITY_CONFIG[worst]
    : activeIncidents.length > 0
      ? SEVERITY_CONFIG.minor
      : SCHEDULED_STYLE;

  function getIncidentStyle(incident: Incident) {
    if (incident.kind === "scheduled") return SCHEDULED_STYLE;
    if (incident.severity) return SEVERITY_CONFIG[incident.severity];
    return SEVERITY_CONFIG.minor;
  }

  const primary = visibleIncidents[0];
  const primaryStyle = getIncidentStyle(primary);
  const preview = stripMarkdown(primary.latestUpdate.body);

  return (
    <div
      className={`fixed ${positionClasses} z-50 ${className ?? ""}`}
      role="alert"
    >
      <div className={`${bannerStyle.bg} ${bannerStyle.border} border-b shadow-sm`}>
        {/* Primary banner row */}
        <div className="max-w-7xl mx-auto px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Badge */}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium shrink-0 ${primaryStyle.badge}`}>
                {primaryStyle.icon} {primary.kind === "scheduled" ? "Upcoming" : primaryStyle.label}
              </span>

              {/* Title */}
              <span className={`text-sm font-medium truncate ${bannerStyle.text}`}>
                {primary.title}
              </span>

              {/* Services */}
              {primary.services.length > 0 && (
                <div className="hidden sm:flex items-center gap-1">
                  {primary.services.map((service) => (
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
                {timeAgo(primary.latestUpdate.createdAt)}
              </span>

              {visibleIncidents.length > 1 && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className={`text-xs font-medium px-2 py-1 rounded hover:bg-black/5 ${bannerStyle.text}`}
                >
                  {expanded ? "Hide" : `+${visibleIncidents.length - 1} more`}
                </button>
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
                onClick={visibleIncidents.length === 1 ? () => handleDismiss(primary.id) : handleDismissAll}
                className={`p-1 rounded hover:bg-black/5 ${bannerStyle.text}`}
                aria-label="Dismiss"
              >
                <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Latest update preview */}
          <div className={`text-xs mt-1 ${bannerStyle.text} opacity-70`}>
            {preview.length > 200 ? `${preview.slice(0, 200)}...` : preview}
          </div>
        </div>

        {/* Expanded rows */}
        {expanded && visibleIncidents.length > 1 && (
          <div className={`border-t ${bannerStyle.border}`}>
            {visibleIncidents.slice(1).map((incident) => {
              const incStyle = getIncidentStyle(incident);
              const incPreview = stripMarkdown(incident.latestUpdate.body);

              return (
                <div
                  key={incident.id}
                  className={`max-w-7xl mx-auto px-4 py-2 border-b last:border-b-0 ${bannerStyle.border}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 ${incStyle.badge}`}>
                        {incStyle.icon} {incident.kind === "scheduled" ? "Upcoming" : incStyle.label}
                      </span>
                      <span className={`text-sm font-medium truncate ${bannerStyle.text}`}>
                        {incident.title}
                      </span>
                      {incident.services.length > 0 && (
                        <div className="hidden sm:flex items-center gap-1">
                          {incident.services.map((service) => (
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
                        {timeAgo(incident.latestUpdate.createdAt)}
                      </span>
                      <button
                        onClick={() => handleDismiss(incident.id)}
                        className={`p-1 rounded hover:bg-black/5 ${bannerStyle.text}`}
                        aria-label="Dismiss"
                      >
                        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className={`text-xs mt-0.5 ${bannerStyle.text} opacity-70`}>
                    {incPreview.length > 150 ? `${incPreview.slice(0, 150)}...` : incPreview}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ServiSuiteStatus;
