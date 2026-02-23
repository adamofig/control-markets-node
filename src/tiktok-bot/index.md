# TikTok Bot Documentation

## Overview
The TikTok Bot is an automated tool designed to simulate human-like browsing behavior on TikTok. It uses standard Chrome browser automation to scroll through videos, watch content, and perform actions like "Liking" based on configurable probabilities.

## Key Features
- **Human-like Interaction**: Uses random delays and action thresholds to mimic human behavior.
- **Automated Browsing**: Scrolls through the "For You" feed, watches videos, and navigates to the next one automatically.
- **Targeted Engagement**: Programmed to specifically engage with certain accounts (e.g., `polilan_app`).
- **Detection Avoidance**: Leverages `playwright` with a persistent Chrome context and specific flags to bypass bot detection.

## Architecture & Implementation

### 1. Browser Automation (`tiktok-bot.service.ts` & `tiktok-bot-v2.ts`)
- **Playwright**: Used to control a Chromium browser instance.
- **Persistent Context**: The bot uses a real Chrome user profile directory. This allows it to reuse existing login sessions, cookies, and local storage, making it appear as a legitimate user.
- **Automation Flags**: `--disable-blink-features=AutomationControlled` is used to hide the `navigator.webdriver` property.

### 2. Probabilistic Action Engine (`ACTION_THRESHOLDS`)
The bot doesn't perform the same actions every time. It uses weighted probabilities to decide what to do:
- **Watch Full Video**: 5% chance.
- **Skip Video**: 20% chance.
- **Watch Partial Video**: 75% chance (with a random duration up to 11 seconds).
- **Like After Watch**: 15% chance.

### 3. Content Scraping (`scraper.ts`)
Uses `cheerio` to parse the HTML of each video "article". It extracts:
- Username
- Video description
- Like, comment, share, and favorite counts
- Video duration (from the progress bar text)
- Music and profile URLs

### 4. Navigation Logic
- **`getFirstArticleNode`**: Traverses the DOM from a `<video>` tag up to its parent `<article>` tag to ensure all scraped data belongs to the correct video.
- **`nextTiktok`**: Finds and clicks the "Next" button using a specific SVG path selector found in TikTok's UI.

## File Breakdown
- `tiktok-bot.service.ts`: The main NestJS service that orchestrates the bot loop and integrates with the application.
- `scraper.ts`: Contains the logic for extracting data from the page HTML.
- `tiktok-bot.module.ts`: NestJS module definition.
- `utils.ts`: Helper functions for random wait times and probability checks.

## Usage
Currently, the bot is designed to be started via the `startBot(profileName)` method in `TiktokBotService`. It requires a valid Chrome profile name and expects the user to be logged in for full functionality.
