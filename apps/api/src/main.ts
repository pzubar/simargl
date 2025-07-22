import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { AdminService } from './admin/admin.service';
import { TemplateService } from './admin/template.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // Configure Handlebars as the view engine
  app.setBaseViewsDir(join(__dirname, '..', '..', '..', 'apps', 'api', 'src', 'views'));
  app.setViewEngine('hbs');
  
  // Register Handlebars helpers globally
  const hbs = require('hbs');
  
  // Helper for date formatting
  hbs.registerHelper('formatDate', (date: Date | string) => {
    if (!date) return '—';
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  });
  
  // Helper for number formatting
  hbs.registerHelper('formatNumber', (num: number) => {
    if (!num) return '—';
    return num.toLocaleString();
  });
  
  // Helper for equality check
  hbs.registerHelper('eq', (a: any, b: any) => {
    return a === b;
  });
  
  // Helper for greater than comparison
  hbs.registerHelper('gt', (a: any, b: any) => {
    return a > b;
  });
  
  // Helper for less than comparison
  hbs.registerHelper('lt', (a: any, b: any) => {
    return a < b;
  });
  
  // Helper for array slicing
  hbs.registerHelper('slice', (array: any[], start: number, end?: number) => {
    if (!Array.isArray(array)) return [];
    return array.slice(start, end);
  });
  
  // Helper for checking if value is in array
  hbs.registerHelper('includes', (array: any[], value: any) => {
    if (!Array.isArray(array)) return false;
    return array.includes(value);
  });
  
  // Helper for array length
  hbs.registerHelper('length', (array: any[]) => {
    if (!Array.isArray(array)) return 0;
    return array.length;
  });
  
  console.log('✅ Handlebars helpers registered globally');
  
  // Serve static files
  app.useStaticAssets(join(__dirname, '..', '..', '..', 'apps', 'api', 'src', 'public'), {
    prefix: '/public/',
  });
  
  // Wait a moment for modules to initialize
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Initialize recurring polling for existing channels
  try {
    const adminService = app.get(AdminService);
    const result = await adminService.startAllChannelPolling();
    console.log(`🔄 Started recurring polling for ${result.scheduledChannels} existing YouTube channels`);
  } catch (error) {
    console.warn('⚠️ Could not start recurring polling for existing channels:', error.message);
  }
  
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
