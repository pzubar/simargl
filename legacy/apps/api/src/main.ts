import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { AdminService } from './admin/admin.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve static files
  app.useStaticAssets(
    join(__dirname, '..', '..', '..', 'apps', 'api', 'src', 'public'),
    {
      prefix: '/public/',
    },
  );

  // Wait a moment for modules to initialize
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Initialize recurring polling for existing channels
  try {
    const adminService = app.get(AdminService);
    const result = await adminService.startAllChannelPolling();
    console.log(
      `🔄 Started recurring polling for ${result.scheduledChannels} existing YouTube channels`,
    );
  } catch (error) {
    console.warn(
      '⚠️ Could not start recurring polling for existing channels:',
      error.message,
    );
  }

  // Initialize system-wide periodic processors
  try {
    const adminService = app.get(AdminService);
    const result = await adminService.initializeSystemPeriodicProcessors();
    console.log(
      `🔄 Initialized system processors: VideoReadiness=${result.videoReadinessScheduled}, ResearchScheduler=${result.researchSchedulerScheduled}`,
    );
  } catch (error) {
    console.warn(
      '⚠️ Could not initialize system periodic processors:',
      error.message,
    );
  }

  // Set up AdminJS component watching for development
  if (process.env.NODE_ENV !== 'production') {
    try {
      // Import AdminJS and componentLoader
      const AdminJS = require('adminjs');
      const { componentLoader } = require('./admin/components');
      
      // Create AdminJS instance with the same componentLoader
      const admin = new AdminJS({
        componentLoader,
      });
      
      // Start watching components for changes
      admin.watch().then(() => {
        console.log('✅ AdminJS component watching enabled for development');
      }).catch((err) => {
        console.warn('⚠️ AdminJS component watching setup failed:', err.message);
      });
    } catch (error) {
      console.warn('⚠️ Could not enable AdminJS component watching:', error.message);
    }
  }

  // AdminJS interface is now available at /admin
  console.log('✅ AdminJS interface available at /admin');

  // Start the application
  await app.listen(process.env.PORT || 3333);
  console.log(
    `🚀 Application is running on: http://localhost:${process.env.PORT || 3333}`,
  );

  console.log(
    `📊 AdminJS Panel: http://localhost:${process.env.PORT || 3333}/admin`,
  );
  console.log(
    `📈 Queue Dashboard: http://localhost:${process.env.PORT || 3333}/queues`,
  );
  console.log(
    `🔗 API Endpoints: http://localhost:${process.env.PORT || 3333}/channels`,
  );
}

bootstrap();
