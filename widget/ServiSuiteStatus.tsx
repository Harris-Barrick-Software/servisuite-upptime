"use client";

import { useEffect, useState, useCallback } from "react";

// --- Configuration ---
const UPPTIME_OWNER = "Harris-Barrick-Software";
const UPPTIME_REPO = "servisuite-upptime";
const STATUS_PAGE_URL = "https://status.servisuite.com";
const GITHUB_API = "https://api.github.com";

// --- Types ---
type Severity = "critical" | "major" | "minor" | "maintenance";

interface Incident {
  id: number;
  title: string;
  url: string;
  severity: Severity | null;
  createdAt: string;
  latestUpdate: {
    body: string;
    createdAt: string;
  };
}

interface StatusWidgetProps {
  /** Polling interval in ms. Default: 60000 (1 min) */
  pollInterval?: number;
  /** Additional CSS class on the root element */
  className?: string;
}

// --- Severity config ---
const SEVERITY_CONFIG: Record<Severity, { dot: string; badge: string; badgeText: string; icon: string; label: string }> = {
  critical: {
    dot: "bg-red-600",
    badge: "bg-red-100 text-red-700",
    badgeText: "Critical",
    icon: "🔴",
    label: "Critical Outage",
  },
  major: {
    dot: "bg-orange-500",
    badge: "bg-orange-100 text-orange-700",
    badgeText: "Major",
    icon: "🟠",
    label: "Major Disruption",
  },
  minor: {
    dot: "bg-yellow-500",
    badge: "bg-yellow-100 text-yellow-700",
    badgeText: "Minor",
    icon: "🟡",
    label: "Minor Issue",
  },
  maintenance: {
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-700",
    badgeText: "Maintenance",
    icon: "🔧",
    label: "Scheduled Maintenance",
  },
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

function getWorstSeverity(incidents: Incident[]): Severity | null {
  for (const s of SEVERITY_PRIORITY) {
    if (incidents.some((i) => i.severity === s)) return s;
  }
  return null;
}

// --- Component ---
export function ServiSuiteStatus({
  pollInterval = 60_000,
  className,
}: StatusWidgetProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchIncidents = useCallback(async () => {
    try {
      const issuesRes = await fetch(
        `${GITHUB_API}/repos/${UPPTIME_OWNER}/${UPPTIME_REPO}/issues?state=open&sort=created&direction=desc&per_page=10`
      );

      if (!issuesRes.ok) throw new Error("Failed to fetch issues");

      const issues = await issuesRes.json();

      const results: Incident[] = await Promise.all(
        issues
          .filter((issue: any) => !issue.pull_request)
          .map(async (issue: any): Promise<Incident> => {
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

            return {
              id: issue.number,
              title: issue.title,
              url: issue.html_url,
              severity: parseSeverity(issue.labels || []),
              createdAt: issue.created_at,
              latestUpdate,
            };
          })
      );

      setIncidents(results);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIncidents();
    const interval = setInterval(fetchIncidents, pollInterval);
    return () => clearInterval(interval);
  }, [fetchIncidents, pollInterval]);

  const worst = getWorstSeverity(incidents);
  const isOperational = incidents.length === 0;

  if (loading) {
    return (
      <div className={`max-w-sm border border-gray-200 rounded-lg overflow-hidden text-sm ${className ?? ""}`}>
        <div className="px-4 py-3 text-gray-500">Checking status...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`max-w-sm border border-gray-200 rounded-lg overflow-hidden text-sm ${className ?? ""}`}>
        <a
          href={STATUS_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-4 py-3 text-blue-500 no-underline hover:underline"
        >
          View status page
        </a>
      </div>
    );
  }

  const bannerDot = isOperational
    ? "bg-green-500"
    : worst
      ? SEVERITY_CONFIG[worst].dot
      : "bg-red-500";

  const bannerText = isOperational
    ? "All Systems Operational"
    : worst
      ? `${SEVERITY_CONFIG[worst].label} — ${incidents.length} active`
      : `${incidents.length} Active Incident${incidents.length > 1 ? "s" : ""}`;

  return (
    <div className={`max-w-sm border border-gray-200 rounded-lg overflow-hidden text-sm ${className ?? ""}`}>
      {/* Overall status banner */}
      <div className={`flex items-center gap-2 px-4 py-3 ${incidents.length > 0 ? "border-b border-gray-200" : ""}`}>
        <span className={`size-2.5 rounded-full shrink-0 ${bannerDot}`} />
        <span className="font-semibold">{bannerText}</span>
      </div>

      {/* Active incidents */}
      {incidents.map((incident) => {
        const preview = stripMarkdown(incident.latestUpdate.body);
        const sev = incident.severity ? SEVERITY_CONFIG[incident.severity] : null;

        return (
          <div key={incident.id} className="px-4 py-2.5 border-b border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0">
                {sev && (
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 ${sev.badge}`}>
                    {sev.icon} {sev.badgeText}
                  </span>
                )}
                <span className="font-medium text-[13px] truncate">{incident.title}</span>
              </div>
              <span className="text-gray-400 text-xs shrink-0 ml-2">
                {timeAgo(incident.latestUpdate.createdAt)}
              </span>
            </div>
            <div className="text-gray-500 text-xs leading-relaxed">
              {preview.length > 140 ? `${preview.slice(0, 140)}...` : preview}
            </div>
          </div>
        );
      })}

      {/* Link to full status page */}
      <a
        href={STATUS_PAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="block px-4 py-2.5 text-center text-blue-500 text-[13px] no-underline hover:underline border-t border-gray-200"
      >
        View full status page &rarr;
      </a>
    </div>
  );
}

export default ServiSuiteStatus;
