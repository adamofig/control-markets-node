import { chromium, Page, Locator, JSHandle, ElementHandle } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import { scrapeVideoData } from './scraper';

const getFirstArticleNode = async (videoNode: ElementHandle): Promise<ElementHandle | null> => {
  if (!videoNode) return null;

  const articleNode = await videoNode.evaluateHandle((node: HTMLElement) => {
    let ancestor = node;
    while (ancestor && ancestor.parentElement) {
      ancestor = ancestor.parentElement;
      if (ancestor.tagName && ancestor.tagName.toLowerCase() === 'article') {
        return ancestor;
      }
    }
    return null;
  });

  return articleNode.asElement();
};

const likeVideo = async (page: Page, profileName: string) => {
  console.log(`[${profileName}] Waiting for like buttons to be available...`);
  const likeButtons = await page.$$('button[aria-label*="Like video"][aria-label*="likes"]');
  console.log(`[${profileName}] Found ${likeButtons.length} like buttons.`);

  for (const button of likeButtons) {
    try {
      const isLiked = await button.getAttribute('aria-pressed');
      if (isLiked === 'false') {
        await button.click();
        console.log(`[${profileName}] Liked a video!`);
        // Wait a random amount of time between likes to appear more human
        await page.waitForTimeout(Math.random() * 3000 + 1000);
        break;
      }
    } catch (error) {
      console.log(`[${profileName}] Could not interact with a like button, skipping.`);
    }
  }
};

const nextTiktok = async (page: Page, profileName: string) => {
  try {
    const nextButton = await page.waitForSelector(
      'button:has(svg > path[d="m24 27.76 13.17-13.17a1 1 0 0 1 1.42 0l2.82 2.82a1 1 0 0 1 0 1.42L25.06 35.18a1.5 1.5 0 0 1-2.12 0L6.59 18.83a1 1 0 0 1 0-1.42L9.4 14.6a1 1 0 0 1 1.42 0L24 27.76Z"])',
      { timeout: 10000 }
    );
    await nextButton.click();
    console.log(`[${profileName}] Clicked the next button.`);
  } catch (error) {
    console.log(`[${profileName}] Could not find the next button, or it was not clickable.`);
  }
};

export const runBot = async (profileName: string) => {
  // Use your default Google Chrome profile
  // NOTE: The path below is for macOS. You may need to update it for your OS:
  // - Windows: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data')
  // - Linux: path.join(os.homedir(), '.config', 'google-chrome')
  // By pointing to a specific profile directory, we avoid conflicts with your main browser session.
  const userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', profileName);

  // Launch the browser with a persistent context
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'], // Helps to avoid detection
  });

  const page = await context.newPage();

  // Go to TikTok
  await page.goto('https://www.tiktok.com/');

  console.log(`[${profileName}] Browser launched. If this is the first run, please log in to TikTok manually.`);
  console.log(`[${profileName}] Your session will be saved for future runs.`);
  console.log(`[${profileName}] The bot will start in 4 seconds...`);

  // Add a delay to allow for manual login if needed
  await page.waitForTimeout(1000);

  // Get and print the HTML of the page
  const pageContent = await page.content();
  console.log(pageContent);

  try {
    // Indefinite loop to scroll and like videos
    while (true) {
      await page.waitForTimeout(2000);

      const videoNodes = await page.$$('video[data-version]');
      console.log(`Found ${videoNodes.length} video nodes.`);
      const firstVideoNode = videoNodes[0];

      if (firstVideoNode) {
        const firstArticleNode: ElementHandle<Node> | null = await getFirstArticleNode(firstVideoNode);
        const html: string = (await firstArticleNode?.innerHTML()) || '';
        console.log('getting html:', html?.slice(0, 100));

        const tagName = await firstArticleNode?.evaluate((node: any) => node.tagName);
        console.log('Tag name:', tagName);

        if (firstArticleNode) {
          const videoData = await scrapeVideoData(html);
          // const videoData = null;
          if (videoData) {
            await likeVideo(page, profileName);
          }
          await nextTiktok(page, profileName);
        } else {
          console.log('No article ancestor found for the video.');
          await nextTiktok(page, profileName); // Try to move to the next video
        }
      } else {
        console.log('No video nodes found on the page.');
      }

      // A longer pause after a batch of likes
      await page.waitForTimeout(1000);
    }
  } catch (error) {
    console.error(`[${profileName}] An error occurred:`, error);
  }
};
