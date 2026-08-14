/**
 * Mueve los renders finales que quedaron guardados en `video_scenes.videoStorage` a su campo
 * propio, `renderStorage`.
 *
 * `videoStorage` es el video **de fondo** de la escena (una entrada del render). Hasta ahora
 * `renderScene()` escribía ahí el MP4 que devuelve `control-render`, con dos consecuencias:
 *   - en escenas `mediaType: 'image'` el formulario nunca lo mostraba (su bloque sólo existe para
 *     `mediaType: 'video'`), así que el render parecía no guardarse;
 *   - en escenas `mediaType: 'video'` pisaba el fondo, y `SceneComposition.tsx` volvía a usar ese
 *     MP4 como fondo del render siguiente.
 *
 * Se reconoce un render por `generationMetadata.provider === 'remotion'` o por la carpeta
 * `rendered-scenes/`. Idempotente: la segunda corrida no encuentra nada. No borra archivos de GCS
 * ni documentos de `storage_assets`; sólo reubica la referencia dentro de la escena.
 *
 *   pnpm migrate:scene-render -- --dry-run   # imprime el plan, no escribe nada
 *   pnpm migrate:scene-render                # aplica
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { VideoSceneEntity, VideoSceneDocument } from '../src/video-scene/schemas/video-scene.schema';
import { isRenderedAsset } from '../src/video-scene/services/video-scene.service';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`\n=== migrate-scene-render-storage ${DRY_RUN ? '(DRY RUN — nothing will be written)' : '(APPLYING CHANGES)'} ===\n`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const sceneModel: Model<VideoSceneDocument> = app.get(getModelToken(VideoSceneEntity.name));

    const scenes = await sceneModel.find({ videoStorage: { $ne: null } }).exec();
    console.log(`Loaded ${scenes.length} scenes with a videoStorage.\n`);

    let moved = 0;
    let skippedBackground = 0;
    let conflicts = 0;

    for (const scene of scenes) {
      const videoStorage = (scene as any).videoStorage;
      if (!isRenderedAsset(videoStorage)) {
        skippedBackground++;
        continue;
      }

      const id = scene._id.toString();
      const alreadyRendered = (scene as any).renderStorage?.storage?.url;

      if (alreadyRendered) {
        // Ya se re-renderizó después del cambio: `renderStorage` es más nuevo, así que el legacy
        // sólo se descuelga del fondo para que no vuelva a entrar al render.
        conflicts++;
        console.log(`~ ${id}  "${scene.name}"  ya tiene renderStorage → sólo se limpia videoStorage`);
        if (!DRY_RUN) {
          await sceneModel.updateOne({ _id: scene._id }, { $set: { videoStorage: null } }).exec();
        }
        continue;
      }

      moved++;
      console.log(`→ ${id}  "${scene.name}"  ${videoStorage.storage.path || videoStorage.storage.url}`);
      if (!DRY_RUN) {
        await sceneModel.updateOne({ _id: scene._id }, { $set: { renderStorage: videoStorage, videoStorage: null } }).exec();
      }
    }

    console.log(`\nRenders movidos a renderStorage: ${moved}`);
    console.log(`Escenas con conflicto (ya tenían render nuevo): ${conflicts}`);
    console.log(`Fondos reales intactos: ${skippedBackground}`);
    if (DRY_RUN) console.log('\nDRY RUN — no se escribió nada. Corré sin --dry-run para aplicar.');
  } finally {
    await app.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
