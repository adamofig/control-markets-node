import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AllExceptionsHandler } from './common/exception-hanlder.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConsoleLogger } from '@nestjs/common';

import multipart from '@fastify/multipart'; // Import the multipart plugin

function printEnvironmentVariables() {
  console.log('--- Environment Variables ---');
  console.log('ENV -> ' + process.env.ENV);
  console.log('GROQ_API_KEY -> ' + process.env.GROQ_API_KEY);
  console.log('MONGO_USER -> ' + process.env.MONGO_USER);
  console.log('MONGO_PASS -> ' + process.env.MONGO_PASS);
  console.log('MONGO_HOST -> ' + process.env.MONGO_HOST);
  console.log('MONGO_DB -> ' + process.env.MONGO_DB);
  console.log('GOOGLE_CLOUD_PROJECT_ID -> ' + process.env.GOOGLE_CLOUD_PROJECT_ID);
  console.log('GOOGLE_APPLICATION_CREDENTIALS -> ' + process.env.GOOGLE_APPLICATION_CREDENTIALS);
  console.log('OPENAI_API_KEY -> ' + process.env.OPENAI_API_KEY);
  console.log('STORAGE_BUCKET -> ' + process.env.STORAGE_BUCKET);
  console.log('PROJECT_ID -> ' + process.env.PROJECT_ID);
  console.log('PYTHON_SERVER_URL -> ' + process.env.PYTHON_SERVER_URL);
  console.log('GEMINI_API_KEY -> ' + process.env.GEMINI_API_KEY);
  console.log('KEY_BALANCER_HOST -> ' + process.env.KEY_BALANCER_HOST);
  console.log('CHATWOOT_API_KEY -> ' + process.env.CHATWOOT_API_KEY);
  console.log('AI_SERVICES_HOST -> ' + process.env.AI_SERVICES_HOST);
  console.log('---------------------------');
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    rawBody: true,
    logger: new ConsoleLogger({ json: false, colors: true }),
  });
  app.useGlobalFilters(new AllExceptionsHandler());

  app.enableCors({
    origin: true, // Or specify your frontend origin like 'http://localhost:4200'
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const config = new DocumentBuilder().setTitle('Control Markets API').setDescription('The Control Markets API description').setVersion('1.0').addTag('Control Markets Tags').addBearerAuth().build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document);

  const port = 8121;
  await app.listen(port, '0.0.0.0');
  printEnvironmentVariables();
  console.log(`Server is running on port ${port} http://0.0.0.0:${port}`);
}

bootstrap();
