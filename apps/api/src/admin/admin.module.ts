import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
// import { AdminController } from './admin.controller'; // Disabled to use AdminJS on /admin route
import { AdminService } from './admin.service';
import { TemplateService } from './template.service';
import { Channel, ChannelSchema } from '../schemas/channel.schema';
import { Content, ContentSchema } from '../schemas/content.schema';
import { Prompt, PromptSchema } from '../schemas/prompt.schema';
import { AdminModule as AdminJSModule } from '@adminjs/nestjs';
import AdminJS from 'adminjs';
import { Database, Resource } from '@adminjs/mongoose';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';

AdminJS.registerAdapter({ Database, Resource });

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Channel.name, schema: ChannelSchema },
      { name: Content.name, schema: ContentSchema },
      { name: Prompt.name, schema: PromptSchema },
    ]),
    AdminJSModule.createAdminAsync({
      imports: [
        MongooseModule.forFeature([
          { name: Channel.name, schema: ChannelSchema },
          { name: Content.name, schema: ContentSchema },
          { name: Prompt.name, schema: PromptSchema },
        ]),
      ],
      useFactory: (
        channelModel: Model<Channel>,
        contentModel: Model<Content>,
        promptModel: Model<Prompt>,
      ) => ({
        adminJsOptions: {
          rootPath: '/admin',
          resources: [
            {
              resource: channelModel,
              options: {
                navigation: {
                  name: 'Content Management',
                  icon: 'Tv',
                },
                properties: {
                  sourceType: {
                    availableValues: [
                      { value: 'YOUTUBE', label: 'YouTube' },
                      { value: 'RSS', label: 'RSS Feed' },
                      { value: 'API', label: 'API Source' },
                    ],
                  },
                  cronPattern: {
                    description:
                      'Cron pattern for automatic content fetching (e.g., 0 */6 * * * for every 6 hours)',
                  },
                  fetchLastN: {
                    description: 'Number of latest items to fetch each time',
                  },
                },
                actions: {
                  new: {
                    before: async (request) => {
                      if (request.payload) {
                        request.payload.createdAt = new Date();
                        request.payload.updatedAt = new Date();
                      }
                      return request;
                    },
                  },
                  edit: {
                    before: async (request) => {
                      if (request.payload) {
                        request.payload.updatedAt = new Date();
                      }
                      return request;
                    },
                  },
                },
              },
            },
            {
              resource: contentModel,
              options: {
                navigation: {
                  name: 'Content Management',
                  icon: 'FileText',
                },
                properties: {
                  status: {
                    availableValues: [
                      { value: 'PENDING', label: 'Pending' },
                      { value: 'PROCESSING', label: 'Processing' },
                      { value: 'ANALYZED', label: 'Analyzed' },
                      { value: 'FAILED', label: 'Failed' },
                    ],
                  },
                  'metadata.viewCount': {
                    type: 'number',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                  },
                  'metadata.duration': {
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                  },
                  'metadata.thumbnailUrl': {
                    type: 'string',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: true,
                      filter: false,
                    },
                  },
                  'analysis.result': {
                    type: 'richtext',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                  },
                },
                actions: {
                  new: {
                    before: async (request) => {
                      if (request.payload) {
                        request.payload.createdAt = new Date();
                        request.payload.updatedAt = new Date();
                        if (!request.payload.status) {
                          request.payload.status = 'PENDING';
                        }
                      }
                      return request;
                    },
                  },
                  edit: {
                    before: async (request) => {
                      if (request.payload) {
                        request.payload.updatedAt = new Date();
                      }
                      return request;
                    },
                  },
                },
              },
            },
            {
              resource: promptModel,
              options: {
                navigation: {
                  name: 'AI Configuration',
                  icon: 'MessageSquare',
                },
                properties: {
                  promptTemplate: {
                    type: 'textarea',
                    props: {
                      rows: 10,
                    },
                  },
                  isDefault: {
                    type: 'boolean',
                    description: 'Set as the default prompt for analysis',
                  },
                },
                actions: {
                  new: {
                    before: async (request) => {
                      if (request.payload) {
                        request.payload.createdAt = new Date();
                        request.payload.updatedAt = new Date();
                        request.payload.version = '1.0';
                      }
                      return request;
                    },
                  },
                  edit: {
                    before: async (request) => {
                      if (request.payload) {
                        request.payload.updatedAt = new Date();
                      }
                      return request;
                    },
                  },
                },
              },
            },
          ],
          branding: {
            companyName: 'Simargl',
            softwareBrothers: false,
            logo: false,
            favicon:
              'https://softwarebrothers.co/assets/images/software-brothers-logo.svg',
          },
          locale: {
            language: 'en',
            translations: {
              labels: {
                Channel: 'Channels',
                Content: 'Content Items',
                Prompt: 'AI Prompts',
              },
              buttons: {
                save: 'Save Changes',
                cancel: 'Cancel',
                delete: 'Delete',
              },
            },
          },
        },
      }),
      inject: [
        getModelToken(Channel.name),
        getModelToken(Content.name),
        getModelToken(Prompt.name),
      ],
    }),
    BullModule.registerQueue({ name: 'channel-poll' }),
  ],
  controllers: [/* AdminController */], // Disabled to use AdminJS on /admin route
  providers: [AdminService, TemplateService],
  exports: [AdminService],
})
export class AdminModule {}
