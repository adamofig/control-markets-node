import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { VideoSceneEntity } from '../schemas/video-scene.schema';

/**
 * Referencia suave a un asset, con la misma forma que guardan `speechStorage` / `imageStorage` /
 * `videoStorage` cuando el usuario genera media desde el formulario de la escena.
 */
export interface ISceneAssetSnapshot {
  id: string;
  storage: any;
  generationMetadata: any;
}

/**
 * Genera media para una escena llamando al **endpoint unificado** de `ai-services`
 * (`POST /api/ai-services/adapter/generate`) con exactamente el mismo payload que manda el
 * frontend: `{ type, generationMetadata, data: { orgId }, options: { mode: 'sync', returnType: 'storage' } }`.
 *
 * Usar el mismo contrato es deliberado: `returnType: 'storage'` deja el archivo en GCS y el
 * documento en `storage_assets` igual que una generación hecha a mano, así que el asset aparece en
 * el listado de Storage Assets y la escena queda con la misma forma de referencia. No se usa
 * `AiServicesSdkClient` porque sus métodos apuntan a los endpoints por-adaptador viejos, que
 * devuelven bytes o respuestas de adapter en vez del `IStorageAsset` ya persistido.
 */
@Injectable()
export class SceneMediaService {
  private readonly logger = new Logger(SceneMediaService.name);
  private readonly aiServicesHost = process.env.AI_SERVICES_HOST || 'http://localhost:3330';
  private readonly apiKey = process.env.AI_SERVICES_API_KEY || '';

  constructor(private readonly httpService: HttpService) {}

  /** Voz en off. Con `agentCard` usa fish-audio (voz clonada del personaje); sin ella, Gemini TTS. */
  async generateSpeech(scene: VideoSceneEntity, orgId?: string): Promise<ISceneAssetSnapshot> {
    const text = (scene.speechPrompt || scene.dialog?.content || '').trim();
    const agentCard: any = scene.agentCard;
    const referenceId = agentCard?.voice?.main?.voice || agentCard?.voiceCloning?.main?.voice || agentCard?.voice?.cloning?.main?.voice || '';

    return this.generate('audio', {
      text,
      provider: agentCard ? 'fish-audio' : 'gemini',
      ...(referenceId ? { referenceId } : {}),
      ...(agentCard ? { agentCard } : {}),
    }, orgId);
  }

  /** Imagen de fondo. Las `imageRefs` de la escena viajan como referencias image-to-image. */
  async generateImage(scene: VideoSceneEntity, orgId?: string): Promise<ISceneAssetSnapshot> {
    const referenceImageUrls = this.collectReferenceUrls(scene);

    return this.generate('image', {
      prompt: (scene.imagePrompt || '').trim(),
      provider: 'nano-banana',
      aspectRatio: scene.aspectRatio || '1:1',
      ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
    }, orgId);
  }

  /** Video de fondo (Veo). Sólo para escenas `mediaType: 'video'`. */
  async generateVideo(scene: VideoSceneEntity, orgId?: string): Promise<ISceneAssetSnapshot> {
    return this.generate('video', {
      prompt: (scene.videoPrompt || '').trim(),
      provider: 'vertex',
    }, orgId);
  }

  private collectReferenceUrls(scene: VideoSceneEntity): string[] {
    const refs: any[] = (scene as any).imageRefs || [];
    const urls = refs.map(ref => ref?.asset?.storage?.url).filter(Boolean);
    if (urls.length) return urls;
    const legacy = (scene as any).imageRef?.storage?.url;
    return legacy ? [legacy] : [];
  }

  private async generate(type: 'audio' | 'image' | 'video', generationMetadata: Record<string, any>, orgId?: string): Promise<ISceneAssetSnapshot> {
    const url = `${this.aiServicesHost}/api/ai-services/adapter/generate`;
    this.logger.log(`Generating ${type} via ${url}`);

    const { data: asset } = await firstValueFrom(
      this.httpService.post<any>(
        url,
        {
          type,
          generationMetadata,
          data: { orgId },
          options: { mode: 'sync', returnType: 'storage' },
        },
        { headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {} },
      ),
    );

    const id = asset?._id?.toString?.() || asset?._id || asset?.id;
    if (!asset?.storage?.url) {
      throw new Error(`ai-services returned no storage url for ${type} (asset ${id ?? 'sin id'})`);
    }

    return { id, storage: asset.storage, generationMetadata: asset.generationMetadata };
  }
}
