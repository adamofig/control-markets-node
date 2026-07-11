import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

async function main() {
  console.log('Iniciando migración de base de datos...');
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const collections = await connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    console.log('Colecciones existentes:', collectionNames);
    if (collectionNames.includes('agent_sources')) {
      if (collectionNames.includes('sources')) {
        console.warn('⚠️ La colección "sources" ya existe. No se puede renombrar de forma directa. Se requiere fusión manual si hay datos en ambas.');
      } else {
        console.log('Renombrando colección de "agent_sources" a "sources"...');
        await connection.db.collection('agent_sources').rename('sources');
        console.log('✅ Colección renombrada exitosamente.');
      }
    } else {
      console.log('ℹ️ La colección "agent_sources" no existe. Es posible que ya haya sido renombrada.');
    }
  } catch (error) {
    console.error('❌ Error durante la migración:', error);
  } finally {
    await app.close();
  }
}
main();
