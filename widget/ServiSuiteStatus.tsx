"use client";

import { useEffect, useState, useCallback } from "react";

// --- Configuration ---
const UPPTIME_OWNER = "Harris-Barrick-Software";
const UPPTIME_REPO = "servisuite-upptime";
const STATUS_PAGE_URL = "https://status.servisuite.com";
const API_BASE = `https://raw.githubusercontent.com/${UPPTIME_OWNER}/${UPPTIME_REPO}/master/api`;

// --- Types ---
interface SiteStatus {
  name: string;
  slug: string;
  status: "up" | "down" | "degraded";
  uptime: string;
  responseTime: string;
}

interface UptimeApiResponse {
  schemaVersion: number;
  label: string;
  message: string;
  color: string;
}

type OverallStatus = "operational" | "degraded" | "down";

interface StatusWidgetProps {
  /** Polling interval in ms. Default: 60000 (1 min) */
  pollInterval?: number;
  /** Show per-service breakdown. Default: true */
  showDetails?: boolean;
  /** Additional CSS class on the root element */
  className?: string;
  /** Inline styles on the root element */
  style?: React.CSSProperties;
}

// --- Helpers ---
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function statusColor(status: OverallStatus | SiteStatus["status"]): string {
  switch (status) {
    case "up":
    case "operational":
      return "#22c55e";
    case "degraded":
      return "#eab308";
    case "down":
      return "#ef4444";
  }
}

function statusLabel(status: OverallStatus): string {
  switch (status) {
    case "operational":
      return "All Systems Operational";
    case "degraded":
      return "Degraded Performance";
    case "down":
      return "Service Disruption";
  }
}

// --- Site names to monitor (must match .upptimerc.yml names) ---
const SITES = ["ServiSuite App", "ServiSuite API", "ServiSuite Marketing Site"];

// --- Component ---
export function ServiSuiteStatus({
  pollInterval = 60_000,
  showDetails = true,
  className,
  style,
}: StatusWidgetProps) {
  const [sites, setSites] = useState<SiteStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const results = await Promise.all(
        SITES.map(async (name): Promise<SiteStatus> => {
          const slug = slugify(name);
          const [uptimeRes, responseTimeRes] = await Promise.all([
            fetch(`${API_BASE}/${slug}/uptime.json`),
            fetch(`${API_BASE}/${slug}/response-time.json`),
          ]);

          const uptimeData: UptimeApiResponse = await uptimeRes.json();
          const responseTimeData: UptimeApiResponse =
            await responseTimeRes.json();

          let status: SiteStatus["status"] = "up";
          if (uptimeData.color === "red") status = "down";
          else if (uptimeData.color === "yellow") status = "degraded";

          return {
            name,
            slug,
            status,
            uptime: uptimeData.message,
            responseTime: responseTimeData.message,
          };
        })
      );

      setSites(results);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  const overall: OverallStatus = sites.some((s) => s.status === "down")
    ? "down"
    : sites.some((s) => s.status === "degraded")
      ? "degraded"
      : "operational";

  if (loading) {
    return (
      <div className={className} style={{ ...styles.root, ...style }}>
        <div style={styles.loading}>Checking status...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className} style={{ ...styles.root, ...style }}>
        <a
          href={STATUS_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.link}
        >
          View status page
        </a>
      </div>
    );
  }

  return (
    <div className={className} style={{ ...styles.root, ...style }}>
      {/* Overall status banner */}
      <div style={styles.banner}>
        <span
          style={{ ...styles.dot, backgroundColor: statusColor(overall) }}
        />
        <span style={styles.bannerText}>{statusLabel(overall)}</span>
      </div>

      {/* Per-service breakdown */}
      {showDetails && (
        <div style={styles.services}>
          {sites.map((site) => (
            <div key={site.slug} style={styles.serviceRow}>
              <div style={styles.serviceName}>
                <span
                  style={{
                    ...styles.dotSmall,
                    backgroundColor: statusColor(site.status),
                  }}
                />
                {site.name}
              </div>
              <div style={styles.serviceMeta}>
                <span style={styles.metaValue}>{site.uptime}</span>
                <span style={styles.metaSeparator}>|</span>
                <span style={styles.metaValue}>{site.responseTime}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Link to full status page */}
      <a
        href={STATUS_PAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={styles.footerLink}
      >
        View full status page &rarr;
      </a>
    </div>
  );
}

// --- Inline styles (no CSS dependency) ---
const styles: Record<string, React.CSSProperties> = {
  root: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
    maxWidth: 400,
  },
  loading: {
    padding: "12px 16px",
    color: "#6b7280",
  },
  link: {
    padding: "12px 16px",
    color: "#3b82f6",
    textDecoration: "none",
    display: "block",
  },
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid #e5e7eb",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
  },
  dotSmall: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
  bannerText: {
    fontWeight: 600,
  },
  services: {
    padding: "4px 0",
  },
  serviceRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
  },
  serviceName: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  serviceMeta: {
    color: "#6b7280",
    fontSize: 12,
    display: "flex",
    gap: 6,
  },
  metaValue: {},
  metaSeparator: {
    color: "#d1d5db",
  },
  footerLink: {
    display: "block",
    padding: "10px 16px",
    textAlign: "center" as const,
    color: "#3b82f6",
    textDecoration: "none",
    fontSize: 13,
    borderTop: "1px solid #e5e7eb",
  },
};

export default ServiSuiteStatus;
