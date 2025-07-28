import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminService } from './admin.service';
import { TemplateService } from './template.service';
import { componentLoader, Components } from './components';
import { Channel, ChannelSchema } from '../schemas/channel.schema';
import { Content, ContentSchema } from '../schemas/content.schema';
import { Prompt, PromptSchema } from '../schemas/prompt.schema';
import { VideoChunk, VideoChunkSchema } from '../schemas/video-chunk.schema';
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
      { name: VideoChunk.name, schema: VideoChunkSchema },
    ]),
    AdminJSModule.createAdminAsync({
      imports: [
        MongooseModule.forFeature([
          { name: Channel.name, schema: ChannelSchema },
          { name: Content.name, schema: ContentSchema },
          { name: Prompt.name, schema: PromptSchema },
          { name: VideoChunk.name, schema: VideoChunkSchema },
        ]),
      ],
      useFactory: (
        channelModel: Model<Channel>,
        contentModel: Model<Content>,
        promptModel: Model<Prompt>,
        videoChunkModel: Model<VideoChunk>,
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
                      type: 'mixed',
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
                                                  const result = await response.json() as any;
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
            {
              resource: videoChunkModel,
              options: {
                navigation: {
                  name: 'Analysis Details',
                  icon: 'Layers',
                },
                properties: {
                  contentId: {
                    reference: 'Content',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                    description: 'Related content item',
                  },
                  chunkIndex: {
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                    description: 'Chunk sequence number',
                  },
                  startTime: {
                    type: 'number',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Start time in seconds',
                    custom: {
                      format: (value) => {
                        if (!value && value !== 0) return 'Unknown';
                        const minutes = Math.floor(value / 60);
                        const seconds = value % 60;
                        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
                      },
                    },
                  },
                  endTime: {
                    type: 'number',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'End time in seconds',
                    custom: {
                      format: (value) => {
                        if (!value && value !== 0) return 'Unknown';
                        const minutes = Math.floor(value / 60);
                        const seconds = value % 60;
                        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
                      },
                    },
                  },
                  duration: {
                    type: 'number',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Chunk duration in seconds',
                    custom: {
                      format: (value) => {
                        if (!value) return 'Unknown';
                        const minutes = Math.floor(value / 60);
                        const seconds = value % 60;
                        return `${minutes}m ${seconds}s`;
                      },
                    },
                  },
                  status: {
                    availableValues: [
                      { value: 'PENDING', label: 'Pending' },
                      { value: 'PROCESSING', label: 'Processing' },
                      { value: 'ANALYZED', label: 'Analyzed' },
                      { value: 'FAILED', label: 'Failed' },
                      { value: 'OVERLOADED', label: 'Model Overloaded' },
                    ],
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                  },
                  modelUsed: {
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                    description: 'AI model used for this chunk',
                  },
                  processingTime: {
                    type: 'number',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Processing time in milliseconds',
                    custom: {
                      format: (value) => {
                        if (!value) return 'Unknown';
                        return `${value}ms`;
                      },
                    },
                  },
                  analysisResult: {
                    type: 'mixed',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Raw analysis result from AI model',
                    components: {
                      show: Components.AnalysisDisplay,
                    },
                  },
                  error: {
                    type: 'textarea',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Error message if analysis failed',
                  },
                  promptVersionUsed: {
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Prompt version used for analysis',
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
                    isVisible: false, // Chunks are created automatically
                  },
                  edit: {
                    isVisible: false, // Chunks should not be manually edited
                  },
                  delete: {
                    isVisible: true, // Allow deletion for cleanup
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
                VideoChunk: 'Video Chunks',
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
        getModelToken(VideoChunk.name),
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
