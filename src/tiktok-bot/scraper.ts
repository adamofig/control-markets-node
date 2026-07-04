import * as cheerio from 'cheerio';

export interface ScrapedVideoData {
  username: string;
  description: string;
  time: string;
  durationInSeconds?: number;
  likeCount: string;
  commentCount: string;
  favoriteCount: string;
  shareCount: string;
  music: string | undefined;
  userProfile: string | undefined;
}

function timeToSeconds(timeString: string): number {
  if (!timeString || typeof timeString !== 'string') return 0;

  // Extract the part after the "/" if it exists (e.g. "0:12 / 0:30")
  const parts = timeString.split('/');
  const finalPart = parts.length > 1 ? parts[1].trim() : parts[0].trim();

  if (!finalPart) return 0;

  // Split by ":" to get minutes and seconds (or hours, minutes, seconds)
  const timeParts = finalPart.split(':').map(Number);
  
  if (timeParts.some(isNaN)) return 0;

  if (timeParts.length === 2) {
    const [minutes, seconds] = timeParts;
    return minutes * 60 + seconds;
  } else if (timeParts.length === 3) {
    const [hours, minutes, seconds] = timeParts;
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  return 0;
}

export const scrapeVideoData = (html: string): ScrapedVideoData | null => {
  if (!html) return null;

  const $ = cheerio.load(html);

  const usernameSelector = 'div[data-e2e="video-author-uniqueid"]';
  const descriptionSelector = 'span[data-e2e="new-desc-span"]';
  const timeSelector = 'p.css-ffmgpa-StyledTUXText-StyledTimeDisplayText';
  const likeCountSelector = 'strong[data-e2e="like-count"]';
  const commentCountSelector = 'strong[data-e2e="comment-count"]';
  const favoriteCountSelector = 'strong[data-e2e="undefined-count"]';
  const shareCountSelector = 'strong[data-e2e="share-count"]';
  const musicSelector = 'a[data-e2e="video-music"]';
  const userProfileSelector = 'a[data-e2e="video-author-avatar"]';

  const videoData: ScrapedVideoData = {
    username: $(usernameSelector).text(),
    description: $(descriptionSelector).text(),
    time: $(timeSelector).text(),
    likeCount: $(likeCountSelector).text(),
    commentCount: $(commentCountSelector).text(),
    favoriteCount: $(favoriteCountSelector).text(),
    shareCount: $(shareCountSelector).text(),
    music: $(musicSelector).attr('href'),
    userProfile: $(userProfileSelector).attr('href'),
  };

  const durationInSeconds = timeToSeconds(videoData.time);
  videoData.durationInSeconds = durationInSeconds;

  console.log(
    `\n🎥 TikTok Video Data:
                👤 @${videoData.username}
                📝 ${videoData.description || 'No description'}
                ⏰ ${videoData.time} - total seconds: ${videoData.durationInSeconds}

                📸 ${videoData?.userProfile}
                ❤️  ${videoData?.likeCount?.padEnd(10)} 💬 ${videoData?.commentCount}
                ⭐ ${videoData?.favoriteCount?.padEnd(10)} 🔄 ${videoData?.shareCount}
                🎵 ${videoData?.music}
                `
  );
  return videoData;
};
