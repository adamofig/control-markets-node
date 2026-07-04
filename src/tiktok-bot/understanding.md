# TikTok Bot - Architectural & Operational Guide

This document explains the architecture, execution model, profile persistence mechanism, and anti-detection strategies of the TikTok Bot project.

---

## 1. Project Overview & Flow

The TikTok Bot is designed to automate the process of browsing TikTok, simulating human interactions (like scrolling, watching, and liking videos), and extracting metadata from the feed.

The project structure is broken down into four core files:
1. **[scraper.ts](file:///Users/adamo/Documents/GitHub/control-markets/control-markets-node/src/tiktok-bot/scraper.ts)**: A pure parsing module using **Cheerio**. It accepts raw HTML strings representing a TikTok video's DOM and extracts structured data (username, description, duration, and counts for likes, comments, favorites, and shares). It runs CPU-bound and does not open a browser.
2. **[tiktok-bot-v2.ts](file:///Users/adamo/Documents/GitHub/control-markets/control-markets-node/src/tiktok-bot/tiktok-bot-v2.ts)**: The standalone Playwright-based browser automation script that opens the browser, controls navigation, interacts with page elements, and passes DOM segments to the scraper.
3. **[tiktok-bot.service.ts](file:///Users/adamo/Documents/GitHub/control-markets/control-markets-node/src/tiktok-bot/tiktok-bot.service.ts)**: A NestJS service wrapper that contains the same automation logic as V2 but integrates with the dependency injection system, allows starts/stops, and handles logging via NestJS `Logger`.
4. **[runner.ts](file:///Users/adamo/Documents/GitHub/control-markets/control-markets-node/src/tiktok-bot/runner.ts)**: A lightweight command-line script to invoke the standalone bot (`tiktok-bot-v2.ts`) passing the desired Chrome profile name as an argument.

---

## 2. Reusing Chrome Profiles (Session Persistence)

To bypass login checks and present a consistent digital fingerprint, the bot reuses your existing Google Chrome profiles.

### How it works technically:
Instead of launching a temporary, fresh browser instance via `chromium.launch()`, the bot uses **Playwright's** persistent context API, targeting the root Chrome directory and specifying the desired profile folder via chromium arguments:
```typescript
const userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  channel: 'chrome',
  args: [
    '--disable-blink-features=AutomationControlled',
    `--profile-directory=${profileName}`, // Directs Chrome to open the specific profile
  ],
});
```

### Why this is critical:
* **Cookies & Local Storage:** All sessions, logins (including active TikTok sessions), cookies, and caches are stored directly inside this profile folder.
* **One-Time Manual Login:** By using `--profile-directory` with your real profile folder name, Chrome loads your actual daily-use session instead of creating an empty nested `Default` sub-profile. You only need to log in manually once; subsequent runs will open already logged in.
* **Profile Location (macOS):** `~/Library/Application Support/Google/Chrome/` as the root, opening `<Profile Name>` (e.g. `Default`, `Profile 1`, `Profile 14`).

---

## 3. How It Performs Actions (Likes & Navigation)

The bot interacts with the user interface by querying DOM nodes and triggering clicks.

### A. Liking Videos
To give a "Like," the bot performs the following steps:
1. Queries the page for buttons that represent the Like action using a partial selector matching the aria-labels:
   `button[aria-label*="Like video"][aria-label*="likes"]`
2. Iterates through the matching buttons and inspects the `aria-pressed` attribute:
   * If `aria-pressed` is `false`, it means the video has **not** been liked yet.
   * If `aria-pressed` is `true`, the bot skips to avoid unliking.
3. Calls `.click()` on the unliked button and inserts a randomized delay to simulate a human response time before continuing.

### B. Moving to the Next Video
TikTok desktop layout uses a specific down-arrow button to scroll down the feed. The bot triggers this by locating the button matching the SVG icon path:
```typescript
const nextButton = await page.waitForSelector(
  'button:has(svg > path[d="m24 27.76 13.17-13.17a1 1 0 0 1 1.42 0l2.82 2.82a1 1 0 0 1 0 1.42L25.06 35.18a1.5 1.5 0 0 1-2.12 0L6.59 18.83a1 1 0 0 1 0-1.42L9.4 14.6a1 1 0 0 1 1.42 0L24 27.76Z"])',
  { timeout: 10000 }
);
await nextButton.click();
```

---

## 4. Evading Bot Detection (Antidetect & Human Simulation)

Automated scripts are highly vulnerable to TikTok's anti-bot algorithms. The project implements multiple strategies to hide automation:

### A. Bypassing WebDriver Detection
When standard automation scripts run, the browser exposes a flag `navigator.webdriver = true`. The bot overrides this behavior using a Chromium startup flag:
```typescript
args: ['--disable-blink-features=AutomationControlled']
```
This prevents the website from immediately flagging the browser as automated.

### B. Real Browser Fingerprint
Instead of using Playwright's packaged Chromium binary (which has a generic fingerprint), the bot targets your local, actual Google Chrome installation:
```typescript
channel: 'chrome'
```
This presents real User-Agent strings, WebGL rendering contexts, media codecs, and system architectures indistinguishable from a normal Chrome browser.

### C. Headless is Disabled
Running in headless mode (`headless: true`) is easily detected because certain screen APIs, fonts, and window bindings report abnormal values. The bot runs with:
```typescript
headless: false
```

### D. Probabilistic Action Engine
To prevent repetitive patterns, the bot determines its actions using weighted probabilities:
* **WATCH_FULL_VIDEO (5% probability):** Watches the entire video duration (up to 2 minutes) before skipping.
* **SKIP_VIDEO (20% probability):** Skips the video quickly.
* **WATCH_PARTIAL_VIDEO (75% probability):** Watches a portion of the video for a random duration (between 3,000ms and 11,000ms).
* **LIKE_AFTER_WATCH (15% probability):** Once a video is watched, there is a small chance it will like the video.

### E. Randomized Delays
All delays are dynamically randomized (e.g., `Math.random() * 3000 + 1000`) so that inputs, scrolls, and clicks never happen at uniform intervals, defeating statistical analysis patterns used by firewalls.
