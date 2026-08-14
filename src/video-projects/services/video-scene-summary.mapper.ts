import { IVideoSceneSummary } from '../models/video-project.models';

/**
 * `$size` throws when the target is missing or is not an array, which is the
 * common case here (captions only exist once the TTS step ran).
 */
const safeSize = (path: string) => ({
  $cond: [{ $isArray: path }, { $size: path }, 0],
});

/**
 * `$project` stage that reduces a `video_scenes` document to the handful of
 * fields the project view needs. Captions are counted inside Mongo so the
 * (potentially per-word) arrays never travel over the wire.
 */
export const VIDEO_SCENE_SUMMARY_PROJECTION = {
  name: 1,
  description: 1,
  status: 1,
  durationSec: 1,
  mediaType: 1,
  aspectRatio: 1,
  updatedAt: 1,
  imageUrl: '$imageStorage.storage.url',
  videoUrl: '$videoStorage.storage.url',
  /** MP4 final de `control-render`; `videoUrl` es sólo el fondo. Ver `renderStorage` en la escena. */
  renderUrl: '$renderStorage.storage.url',
  speechUrl: '$speechStorage.storage.url',
  speechDurationSec: '$speechStorage.generationMetadata.transcription.duration',
  captionsCount: {
    $add: [
      safeSize('$speechStorage.generationMetadata.captions.remotion'),
      safeSize('$speechStorage.generationMetadata.captions.tiktokStyle'),
    ],
  },
};

/**
 * Builds the read-only summary the frontend renders. `raw` is undefined when the
 * scene was deleted or belongs to another organization — the reference is kept
 * so the user can see the gap and unlink it, instead of the row vanishing.
 */
export function toVideoSceneSummary(id: string, raw?: any): IVideoSceneSummary {
  if (!raw) {
    return { id, missing: true };
  }

  const imageUrl: string | undefined = raw.imageUrl || undefined;
  const videoUrl: string | undefined = raw.videoUrl || undefined;
  const renderUrl: string | undefined = raw.renderUrl || undefined;
  const speechUrl: string | undefined = raw.speechUrl || undefined;

  return {
    id,
    name: raw.name,
    description: raw.description,
    status: raw.status,
    durationSec: raw.durationSec,
    mediaType: raw.mediaType,
    aspectRatio: raw.aspectRatio,

    thumbnailUrl: imageUrl || videoUrl,
    hasImage: !!imageUrl,
    hasVideo: !!videoUrl,
    videoUrl,

    hasRender: !!renderUrl,
    renderUrl,

    hasSpeech: !!speechUrl,
    speechUrl,
    speechDurationSec: typeof raw.speechDurationSec === 'number' ? raw.speechDurationSec : undefined,
    hasCaptions: (raw.captionsCount ?? 0) > 0,

    updatedAt: raw.updatedAt,
  };
}
