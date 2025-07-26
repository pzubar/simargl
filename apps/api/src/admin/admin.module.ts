import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminService } from './admin.service';
import { TemplateService } from './template.service';
import { componentLoader, Components } from './components';
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
                      { value: 'METADATA_FETCHED', label: 'Metadata Fetched' },
                      { value: 'PROCESSING', label: 'Processing' },
                      { value: 'ANALYZED', label: 'Analyzed' },
                      { value: 'FAILED', label: 'Failed' },
                    ],
                  },
                  title: {
                    isVisible: {
                      list: true,
                      show: true,
                      edit: true,
                      filter: true,
                    },
                  },
                  sourceContentId: {
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                    description: 'YouTube Video ID',
                  },
                  'metadata.viewCount': {
                    type: 'number',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                    description: 'Number of views on YouTube',
                    custom: {
                      format: (value) => {
                        if (!value) return '0';
                        return new Intl.NumberFormat('en-US').format(value);
                      },
                    },
                  },
                  'metadata.duration': {
                    type: 'number',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Video duration in seconds',
                    custom: {
                      format: (value) => {
                        if (!value) return 'Unknown';
                        const hours = Math.floor(value / 3600);
                        const minutes = Math.floor((value % 3600) / 60);
                        const seconds = value % 60;

                        if (hours > 0) {
                          return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} (${value}s)`;
                        } else {
                          return `${minutes}:${seconds.toString().padStart(2, '0')} (${value}s)`;
                        }
                      },
                    },
                  },
                  'metadata.webpageUrl': {
                    type: 'url',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'YouTube video URL',
                  },
                  'metadata.thumbnailUrl': {
                    type: 'url',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Video thumbnail image URL',
                  },
                  'analysis.modelUsed': {
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                    description: 'AI model used for analysis',
                  },
                  'analysis.promptName': {
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Analysis prompt used',
                  },
                  'analysis.promptVersion': {
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Prompt version',
                  },
                                      'analysis.result': {
                      type: 'string',
                      isVisible: {
                        list: false,
                        show: true,
                        edit: false,
                        filter: false,
                      },
                      description: 'Detailed analysis results with visual formatting',
                      components: {
                        show: Components.AnalysisDisplay,
                      },
                    },
                  publishedAt: {
                    type: 'datetime',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: true,
                      filter: true,
                    },
                  },
                  createdAt: {
                    type: 'datetime',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                  },
                  updatedAt: {
                    type: 'datetime',
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
                  // Custom action to watch YouTube video
                  watchVideo: {
                    actionType: 'record',
                    icon: 'Play',
                    label: 'Watch on YouTube',
                    variant: 'info',
                    component: false,
                    handler: async (request, response, context) => {
                      const { record } = context;
                      const videoId = record.param('sourceContentId');
                      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

                      return {
                        notice: {
                          message: `Opening YouTube video: ${videoId}`,
                          type: 'success',
                        },
                        record: record.toJSON(context.currentAdmin),
                        redirectUrl: youtubeUrl,
                      };
                    },
                    showInDrawer: false,
                  },
                  // Single analysis action using gemini-2.5-pro by default
                  triggerAnalysis: {
                    actionType: 'record',
                    icon: 'Brain',
                    label: 'Run Analysis',
                    variant: 'primary',
                    component: false,
                    handler: async (request, response, context) => {
                      const { record } = context;
                      const contentId = record.id();

                      // Use gemini-2.5-pro by default
                      const selectedModel = 'gemini-2.5-pro';

                      try {
                        // Make HTTP request to trigger analysis
                        const apiUrl = `${process.env.API_BASE_URL || 'http://localhost:3333'}/api/test-video-analysis`;
                        const fetch = (await import('node-fetch')).default;

                        const response = await fetch(apiUrl, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            contentId: contentId,
                            model: selectedModel,
                          }),
                        });

                        if (response.ok) {
                          const result = await response.json();
                          return {
                            notice: {
                              message: `Analysis started with ${selectedModel}! Job ID: ${result?.jobId || 'N/A'}`,
                              type: 'success',
                            },
                            record: record.toJSON(context.currentAdmin),
                          };
                        } else {
                          const errorText = await response.text();
                          throw new Error(errorText);
                        }
                      } catch (error) {
                        return {
                          notice: {
                            message: `Error triggering analysis: ${error.message}`,
                            type: 'error',
                          },
                          record: record.toJSON(context.currentAdmin),
                        };
                      }
                    },
                    showInDrawer: false,
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
          componentLoader,
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
  controllers: [
    /* AdminController */
  ], // Disabled to use AdminJS on /admin route
  providers: [AdminService, TemplateService],
  exports: [AdminService],
})
export class AdminModule {}
