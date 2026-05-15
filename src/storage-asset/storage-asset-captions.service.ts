import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { StorageAssetService } from '@dataclouder/nest-storage';

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperTranscription {
  text: string;
  language: string;
  duration: number;
  words?: WhisperWord[];
}

@Injectable()
export class StorageAssetCaptionsService {
  private readonly aiServicesHost = process.env.AI_SERVICES_HOST || 'http://localhost:3330';

  constructor(
    private readonly storageAssetService: StorageAssetService,
    private readonly httpService: HttpService,
  ) {}

  async extractCaptions(id: string): Promise<any> {
    const asset = await this.storageAssetService.findOne(id);
    if (!asset) throw new NotFoundException(`StorageAsset ${id} not found`);
    if (asset['type'] !== 'audio') throw new BadRequestException('Caption extraction is only supported for audio assets');

    const url = asset['storage']?.url;
    if (!url) throw new BadRequestException('Asset has no storage URL');

    const { data: transcription } = await firstValueFrom(
      this.httpService.post<WhisperTranscription>(
        `${this.aiServicesHost}/api/ai-services/groq/stt/transcribe`,
        { url },
      ),
    );

    const words: WhisperWord[] = transcription.words || [];

    const captions = {
      tiktokStyle: this.toTikTokCaptions(words),
      remotion: this.toRemotionCaptions(words),
    };

    const existing = (asset['generationMetadata'] as any) || {};
    const updatedGenerationMetadata = { ...existing, transcription, captions };

    return this.storageAssetService.update(id, { generationMetadata: updatedGenerationMetadata });
  }

  private toTikTokCaptions(words: WhisperWord[]) {
    return words.map(({ word, start, end }) => ({ word, start, end }));
  }

  private toRemotionCaptions(words: WhisperWord[], fps = 30) {
    const phrases = [];
    for (let i = 0; i < words.length; i += 4) {
      const chunk = words.slice(i, i + 4);
      const text = chunk.map(w => w.word).join(' ');
      const startFrame = Math.round(chunk[0].start * fps);
      const endFrame = Math.round(chunk[chunk.length - 1].end * fps);
      phrases.push({ text, startFrame, durationInFrames: Math.max(1, endFrame - startFrame) });
    }
    return phrases;
  }
}
