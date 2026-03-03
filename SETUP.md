# ServiSuite Upptime — Setup Guide

## 1. Create the GitHub Repository

1. Go to https://github.com/organizations/Harris-Barrick-Software/repositories/new
2. Use the **upptime/upptime** template: https://github.com/upptime/upptime/generate
3. Name the repo `servisuite-upptime`
4. Set it to **Public** (required for GitHub Pages free tier)
5. After creation, replace the generated `.upptimerc.yml` with the one from this project

## 2. Configure Repository Settings

### Enable GitHub Pages
1. Go to **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `gh-pages` / `/ (root)`
4. Save

### Enable GitHub Actions
1. Go to **Settings → Actions → General**
2. Under "Actions permissions," select **Allow all actions and reusable workflows**
3. Under "Workflow permissions," select **Read and write permissions**
4. Check **Allow GitHub Actions to create and approve pull requests**

### Add the Discord Webhook Secret
1. Create a webhook in your Discord server:
   - Server Settings → Integrations → Webhooks → New Webhook
   - Choose the channel for status notifications
   - Copy the webhook URL
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Name: `DISCORD_WEBHOOK_URL`
5. Value: paste the Discord webhook URL

## 3. Configure Custom Domain (status.servisuite.com)

### DNS Setup
Add a **CNAME record** with your DNS provider (wherever servisuite.com is managed):

| Type  | Name   | Value                                            | TTL  |
|-------|--------|--------------------------------------------------|------|
| CNAME | status | harris-barrick-software.github.io.               | 3600 |

### GitHub Pages Custom Domain
1. Go to **Settings → Pages**
2. Under "Custom domain," enter `status.servisuite.com`
3. Click **Save**
4. Wait for DNS check to pass (can take a few minutes)
5. Check **Enforce HTTPS** once available

The `CNAME` file in the repo root ensures this persists across deployments.

## 4. Update Endpoints

Edit `.upptimerc.yml` and replace the placeholder URLs with your actual endpoints:

```yaml
sites:
  - name: ServiSuite App
    url: https://app.servisuite.com      # ← your real app URL
  - name: ServiSuite API
    url: https://api.servisuite.com/health  # ← your health check endpoint
  - name: ServiSuite Marketing Site
    url: https://servisuite.com
```

Update the `SITES` array in `widget/ServiSuiteStatus.tsx` to match any name changes.

## 5. Embed the Status Widget

### Install in your React/Next.js app

Copy `widget/ServiSuiteStatus.tsx` into your project (e.g., `src/components/ServiSuiteStatus.tsx`).

Usage:

```tsx
import { ServiSuiteStatus } from "@/components/ServiSuiteStatus";

// Basic usage
<ServiSuiteStatus />

// Compact — just the overall status banner
<ServiSuiteStatus showDetails={false} />

// Custom poll interval (default: 60s)
<ServiSuiteStatus pollInterval={120_000} />

// With custom styling
<ServiSuiteStatus
  className="my-status-widget"
  style={{ maxWidth: 500 }}
/>
```

The widget fetches data directly from the GitHub raw API — no backend, no API keys, no CORS issues.

## 6. Manual Incidents

To create a custom incident visible on the status page:

1. Go to the repo's **Issues** tab
2. Click **New Issue**
3. Title: describe the incident (e.g., "Scheduled Maintenance: Database Migration")
4. Body: add details, expected duration, affected services
5. Add comments for progress updates — each comment appears as a timeline entry
6. Close the issue when resolved

All incidents (auto-detected and manual) appear on `status.servisuite.com` with full comment history.

## 7. Team Setup

Add GitHub usernames to `.upptimerc.yml` for auto-assignment on incidents:

```yaml
assignees:
  - your-github-username
  - teammate-username
```

## File Overview

```
servisuite-upptime/
├── .upptimerc.yml          # Main Upptime configuration
├── CNAME                   # Custom domain for GitHub Pages
├── SETUP.md                # This file
└── widget/
    └── ServiSuiteStatus.tsx # Embeddable React status widget
```
