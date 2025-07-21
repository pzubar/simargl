import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Wait a moment for modules to initialize
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Admin interface is now available via AdminModule at /admin
  console.log('✅ Admin interface available via AdminModule');
  
  // Start the application
  await app.listen(process.env.PORT || 3333);
  console.log(`🚀 Application is running on: http://localhost:${process.env.PORT || 3333}`);
  
  console.log(`📊 Admin Panel: http://localhost:${process.env.PORT || 3333}/admin`);
  console.log(`📈 Queue Dashboard: http://localhost:${process.env.PORT || 3333}/queues`);
  console.log(`🔗 API Endpoints: http://localhost:${process.env.PORT || 3333}/channels`);
}

bootstrap();
