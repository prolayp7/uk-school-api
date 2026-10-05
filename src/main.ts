import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService);
  const requestIdMiddleware = new RequestIdMiddleware();

  app.setGlobalPrefix("api/v1");
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("UK School API")
    .setDescription(
      "Versioned API for school ERP operations and public website projections.",
    )
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true });

  await app.listen(config.get<number>("PORT", 3000), "0.0.0.0");
}

void bootstrap();
