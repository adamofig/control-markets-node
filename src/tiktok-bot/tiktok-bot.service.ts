import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { chromium, Page, ElementHandle, JSHandle } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import { ScrapedVideoData, scrapeVideoData } from './scraper';
import { shouldTakeAction, randomWaitTime } from './utils';

// Action thresholds in percentage
const ACTION_THRESHOLDS = {
  WATCH_FULL_VIDEO: 5,
  SKIP_VIDEO: 20,
  LIKE_AFTER_WATCH: 15,
  WATCH_PARTIAL_VIDEO: 75, // 100 - WATCH_FULL_VIDEO - SKIP_VIDEO
} as const;

@Injectable()
export class TiktokBotService implements OnModuleInit {
  private readonly logger = new Logger(TiktokBotService.name);
  private isRunning = false;

  async onModuleInit() {
    // Auto-start the bot when the module is initialized
    console.log('Auto-starting TikTok bot...');
    // await this.startBot('Profile 14');
  }

  async startBot(profileName: string) {
    if (this.isRunning) {
      this.logger.warn('Bot is already running');
      return;
    }

    this.isRunning = true;
    this.logger.log(`Starting TikTok bot for profile: ${profileName}`);

    try {
      await this.runBot(profileName);
    } catch (error) {
      this.logger.error('Error in TikTok bot:', error);
      this.isRunning = false;
    }
  }

  stopBot() {
    this.isRunning = false;
    this.logger.log('Stopping TikTok bot...');
  }

  private async getFirstArticleNode(videoNode: ElementHandle): Promise<ElementHandle | null> {
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
  }

  private async nextTiktok(page: Page, profileName: string) {
    try {
      // A veces
      const nextButton = await page.waitForSelector(
        'button:has(svg > path[d="m24 27.76 13.17-13.17a1 1 0 0 1 1.42 0l2.82 2.82a1 1 0 0 1 0 1.42L25.06 35.18a1.5 1.5 0 0 1-2.12 0L6.59 18.83a1 1 0 0 1 0-1.42L9.4 14.6a1 1 0 0 1 1.42 0L24 27.76Z"])',
        { timeout: 10000 }
      );
      await nextButton.click();
      this.logger.log(`[${profileName}] Clicked the next button.`);
    } catch (error) {
      this.logger.log(`[${profileName}] Could not find the next button, or it was not clickable.`);
    }
  }

  private async runBot(profileName: string) {
    const userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', profileName);

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const page = await context.newPage();
    await page.goto('https://www.tiktok.com/');

    this.logger.log(`[${profileName}] Browser launched. If this is the first run, please log in to TikTok manually.`);
    this.logger.log(`[${profileName}] Your session will be saved for future runs.`);
    this.logger.log(`[${profileName}] The bot will start in 4 seconds...`);

    await page.waitForTimeout(4000);

    try {
      while (this.isRunning) {
        const videoNodes = await page.$$('video[data-version]');
        this.logger.log(`Found ${videoNodes.length} video nodes.`);
        const firstVideoNode = videoNodes[0];

        if (firstVideoNode) {
          const firstArticleNode = await this.getFirstArticleNode(firstVideoNode);
          const html: string = (await firstArticleNode?.innerHTML()) || '';
          this.logger.debug('Getting article HTML');

          const tagName = await firstArticleNode?.evaluate((node: any) => node.tagName);
          this.logger.debug(`Article tag name: ${tagName}`);

          if (firstArticleNode) {
            const videoData = await scrapeVideoData(html);
            if (videoData) {
              if (videoData.username === 'polilan_app') {
                console.log('POLILAN 🦩Ver todo el video 🦩🦩🦩🦩🦩');
                await this.watchAllVideo(page, videoData);

                await this.likeVideo(page, profileName);
                await page.waitForTimeout(2400);
              }

              if (shouldTakeAction(ACTION_THRESHOLDS.WATCH_FULL_VIDEO)) {
                console.log(`${ACTION_THRESHOLDS.WATCH_FULL_VIDEO}% de chance -> Ver todo el video`);
                await this.watchAllVideo(page, videoData);
              } else if (shouldTakeAction(ACTION_THRESHOLDS.SKIP_VIDEO)) {
                console.log(`${ACTION_THRESHOLDS.SKIP_VIDEO}% de chance -> de simplemente pasar`);
                // await page.waitForTimeout(500);
              } else {
                const waitTime = randomWaitTime();
                console.log(`${ACTION_THRESHOLDS.WATCH_PARTIAL_VIDEO}% Solo ver un poco : ${waitTime} milisegundos`);
                await page.waitForTimeout(waitTime);
              }

              if (shouldTakeAction(ACTION_THRESHOLDS.LIKE_AFTER_WATCH)) {
                console.log(' 15% de chance -> Me gusta');
                await this.likeVideo(page, profileName);
              } else {
                console.log('OK NO HAY ME GUSTA, CONTINUAR. ');
              }
            }
            await this.nextTiktok(page, profileName);
          } else {
            this.logger.log('No article ancestor found for the video.');
            await this.nextTiktok(page, profileName);
          }
        } else {
          this.logger.log('No video nodes found on the page.');
        }

        await page.waitForTimeout(1000);
      }
    } catch (error) {
      this.logger.error(`[${profileName}] An error occurred:`, error);
    } finally {
      await context.close();
      this.isRunning = false;
    }
  }

  private async watchAllVideo(page: Page, videoData: ScrapedVideoData) {
    const milisegundos = videoData.durationInSeconds * 1000;
    console.log('Duración del video en milisegundos: ' + milisegundos);
    if (milisegundos > 120000) {
      console.log('El video es muy largo viendo solo 2 minutos');
      await page.waitForTimeout(120000);
    } else {
      console.log('Viendo todo el video');
      await page.waitForTimeout(milisegundos);
    }
  }

  private async likeVideo(page: Page, profileName: string) {
    // Al igual  que el next, tiene un problema, que no hay garantias de tener el ultimo video para darle like.
    this.logger.log(`[${profileName}] Waiting for like buttons to be available...`);
    const likeButtons = await page.$$('button[aria-label*="Like video"][aria-label*="likes"]');
    this.logger.log(`[${profileName}] Found ${likeButtons.length} like buttons.`);

    for (const button of likeButtons) {
      try {
        const isLiked = await button.getAttribute('aria-pressed');
        if (isLiked === 'false') {
          await button.click();
          this.logger.log(`[${profileName}] Liked a video!`);
          await page.waitForTimeout(Math.random() * 3000 + 1000);
          break;
        }
      } catch (error) {
        this.logger.log(`[${profileName}] Could not interact with a like button, skipping.`);
      }
    }
  }
}
