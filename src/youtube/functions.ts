import { YoutubeTranscript } from 'youtube-transcript';

interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export interface YouTubeTranscript {
  text: string;
  segments: TranscriptSegment[];
}

export class YouTubeService {
  private youtube;

  constructor(apiKey: string) {
    // this.youtube = google.youtube({ version: 'v3', auth: apiKey });
  }

  /**
   * Extracts transcription from a YouTube video
   * @param videoUrl The full YouTube video URL or video ID
   * @returns Promise with the transcript text and segments
   */
  async getVideoTranscript(videoUrl: string): Promise<YouTubeTranscript> {
    try {
      // Extract video ID from URL if full URL is provided
      const videoId = this.extractVideoId(videoUrl);

      if (!videoId) {
        throw new Error('Invalid YouTube video URL or ID');
      }

      // First verify if the video exists and is accessible
      //   await this.youtube.videos.list({
      //     part: ['snippet'],
      //     id: [videoId],
      //   });

      // Get transcript using youtube-transcript
      const transcriptResponse = await YoutubeTranscript.fetchTranscript(videoId);

      // Combine all segments into a single text
      const fullText = transcriptResponse.map(segment => segment.text).join(' ');

      return {
        text: fullText,
        segments: transcriptResponse.map(segment => ({
          text: segment.text,
          offset: segment.offset,
          duration: segment.duration,
        })),
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get video transcript: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Extracts video ID from a YouTube URL or returns the ID if already an ID
   * @param videoUrl YouTube URL or video ID
   * @returns Video ID or null if invalid
   */
  private extractVideoId(videoUrl: string): string | null {
    // Regular expression to match YouTube video ID patterns
    const patterns = [/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i, /^[a-zA-Z0-9_-]{11}$/];

    for (const pattern of patterns) {
      const match = videoUrl.match(pattern);
      if (match) return match[1] || match[0];
    }

    return null;
  }
}
