import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

async function setupAdminJS(app: INestApplication): Promise<boolean> {
  try {
    const AdminJS = require('adminjs');
    const AdminJSExpress = require('@adminjs/express');
    const AdminJSMongoose = require('@adminjs/mongoose');
    
    // Register the mongoose adapter for AdminJS v6
    AdminJS.registerAdapter(AdminJSMongoose);

    // Get the mongoose connection that NestJS is using
    const connection = app.get<Connection>(getConnectionToken());
    
    // Get the channel-poll queue for scheduling tasks
    const channelPollQueue = app.get<Queue>(getQueueToken('channel-poll'));
    
    // Check connection state
    console.log('🔍 MongoDB connection state:', connection.readyState);
    console.log('🔍 Database name:', connection.db?.databaseName);
    
    const availableModels = Object.keys(connection.models);
    console.log('🔍 Available Mongoose models:', availableModels);
    
    if (connection.readyState !== 1) {
      console.warn('⚠️ MongoDB not connected yet, AdminJS setup skipped');
      return false;
    }
    
    if (availableModels.length === 0) {
      console.warn('⚠️ No Mongoose models found, AdminJS setup skipped');
      return false;
    }
    
    const adminJs = new AdminJS({
      rootPath: '/admin',
      resources: [
        {
          resource: connection.models.Channel,
          options: {
            actions: {
              new: {
                after: async (response: any, request: any, context: any) => {
                  // If a YouTube channel was created, schedule the channel poll task
                  if (response.record?.params?.sourceType === 'YOUTUBE') {
                    await channelPollQueue.add('poll-channel', { 
                      channelId: response.record.id 
                    });
                    console.log(`✅ [AdminJS] Scheduled channel poll task for channel: ${response.record.id}`);
                  }
                  return response;
                },
              },
            },
          },
        },
        connection.models.Content,
        {
          resource: connection.models.Prompt, 
          options: {
            properties: {
              promptTemplate: {
                type: 'textarea',
                props: {
                rows: 20,
              },
            },
          },
        }},
      ],
      branding: {
        companyName: 'Simargl Platform',
      },
    });

    // Create AdminJS router using v6 API
    const adminRouter = AdminJSExpress.buildRouter(adminJs);
    
    // Get the underlying Express app and mount AdminJS BEFORE server starts
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(adminJs.options.rootPath, adminRouter);
    
    console.log(`✅ AdminJS mounted at: ${adminJs.options.rootPath}`);
    return true;
  } catch (error) {
    console.warn('⚠️ AdminJS setup failed:', error.message);
    console.error('Full error:', error);
    return false;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Development mode indicator
  if (process.env.NODE_ENV === 'development') {
    console.log('🔥 Running in HOT RELOAD development mode! 🔥');
  }
  
  // Wait a moment for modules to initialize
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Set up AdminJS BEFORE starting the server
  console.log('🔄 Setting up AdminJS...');
  const adminSetup = await setupAdminJS(app);
  
  // Start the application
  await app.listen(process.env.PORT || 3333);
  console.log(`🚀 Application is running on: http://localhost:${process.env.PORT || 3333}`);
  
  if (adminSetup) {
    console.log(`📊 Admin Panel: http://localhost:${process.env.PORT || 3333}/admin`);
  } else {
    console.log('⚠️ Admin Panel not available - setup failed');
    
    // Retry AdminJS setup after more time if it failed initially
    console.log('🔄 Retrying AdminJS setup in 3 seconds...');
    setTimeout(async () => {
      const retrySetup = await setupAdminJS(app);
      if (retrySetup) {
        console.log(`📊 Admin Panel (retry): http://localhost:${process.env.PORT || 3333}/admin`);
      } else {
        console.log('❌ AdminJS setup failed after retry');
      }
    }, 3000);
  }
}
bootstrap();
