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
                },
                properties: {
                  authorContext: {
                    type: 'textarea',
                    props: {
                      rows: 10,
                    },
                    isVisible: {
                      list: false,
                      show: true,
                      edit: true,
                    },
                  },
                  metadata: {
                    isVisible: {
                      list: false,
                    },
                  },
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
                  fetchLatest: {
                    actionType: 'bulk',
                    icon: 'Download',
                    label: 'Fetch Latest',
                    variant: 'primary',
                    component: false,
                    handler: async (request, response, context) => {
                      const { records, currentAdmin } = context;
                      const fetch = (await import('node-fetch')).default;

                      if (!records || records.length === 0) {
                        return {
                          notice: {
                            message: 'No channels selected.',
                            type: 'error',
                          },
                        };
                      }

                      const results = await Promise.all(
                        records.map(async (record) => {
                          const channelId = record.id();
                          try {
                            const apiUrl = `${process.env.API_BASE_URL || 'http://localhost:3333'}/channels/${channelId}/poll`;
                            const res = await fetch(apiUrl, {
                              method: 'POST',
                            });

                            if (res.ok) {
                              return {
                                success: true,
                                channelId,
                                name: record.params.name,
                              };
                            }
                            const errorText = await res.text();
                            return {
                              success: false,
                              channelId,
                              name: record.params.name,
                              error: errorText,
                            };
                          } catch (error) {
                            return {
                              success: false,
                              channelId,
                              name: record.params.name,
                              error: error.message,
                            };
                          }
                        }),
                      );

                      const successfulPolls = results.filter((r) => r.success);
                      const failedPolls = results.filter((r) => !r.success);

                      return {
                        records: records.map((record) =>
                          record.toJSON(currentAdmin),
                        ),
                        notice: {
                          message: `Triggered poll for ${successfulPolls.length} channels. Failed: ${failedPolls.length}.`,
                          type: failedPolls.length > 0 ? 'warning' : 'success',
                        },
                      };
                    },
                  },
                  pollNow: {
                    actionType: 'record',
                    icon: 'History',
                    label: 'Poll for Content',
                    handler: async (request, response, context) => {
                      const { record, currentAdmin } = context;
                      const channelId = record.id();
                      const fetch = (await import('node-fetch')).default;
                      try {
                        const apiUrl = `${process.env.API_BASE_URL || 'http://localhost:3333'}/channels/${channelId}/poll`;
                        const res = await fetch(apiUrl, { method: 'POST' });

                        if (res.ok) {
                          return {
                            record: record.toJSON(currentAdmin),
                            notice: {
                              message:
                                'Successfully triggered poll for channel.',
                              type: 'success',
                            },
                          };
                        }
                        const errorText = await res.text();
                        return {
                          record: record.toJSON(currentAdmin),
                          notice: {
                            message: `Error: ${errorText}`,
                            type: 'error',
                          },
                        };
                      } catch (error) {
                        return {
                          record: record.toJSON(currentAdmin),
                          notice: {
                            message: `Error: ${error.message}`,
                            type: 'error',
                          },
                        };
                      }
                    },
                    component: false,
                  },
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
                  'metadata.thumbnailUrl': {
                    type: 'string',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: false,
                    },
                    description: 'Thumbnail',
                    components: {
                      list: Components.ThumbnailDisplay,
                      show: Components.ThumbnailDisplay,
                    },
                    position: 1,
                  },
                  title: {
                    isVisible: {
                      list: true,
                      show: true,
                      edit: true,
                      filter: true,
                    },
                    type: 'string',
                    custom: {
                      format: (value) => {
                        if (!value) return '';
                        // Decode HTML entities
                        return value
                          .replace(/&quot;/g, '"')
                          .replace(/&amp;/g, '&')
                          .replace(/&lt;/g, '<')
                          .replace(/&gt;/g, '>')
                          .replace(/&#39;/g, "'");
                      },
                    },
                    position: 2,
                  },
                  channelId: {
                    type: 'reference',
                    reference: 'Channel',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: true,
                      filter: true,
                    },
                    description: 'Associated channel',
                    position: 3,
                  },
                  'metadata.channel': {
                    type: 'string',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                    description: 'Author channel name',
                  },
                  status: {
                    availableValues: [
                      { value: 'PENDING', label: 'Pending' },
                      { value: 'METADATA_FETCHED', label: 'Metadata Fetched' },
                      { value: 'PROCESSING', label: 'Processing' },
                      { value: 'ANALYZED', label: 'Analyzed' },
                      { value: 'FAILED', label: 'Failed' },
                    ],
                    position: 4,
                  },
                  chunkProgress: {
                    components: {
                      show: Components.ChunkProgress,
                    },
                  },
                  'metadata.viewCount': {
                    type: 'number',
                    isVisible: {
                      list: true,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                    description: 'Number of views',
                    custom: {
                      format: (value) => {
                        if (!value) return '0';
                        return new Intl.NumberFormat('en-US').format(value);
                      },
                    },
                    position: 5,
                  },
                  sourceContentId: {
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                    description: 'YouTube Video ID',
                  },
                  description: {
                    type: 'textarea',
                    isVisible: {
                      list: false,
                      show: true,
                      edit: true,
                      filter: false,
                    },
                    description: 'Content description',
                  },
                  _id: {
                    isVisible: {
                      list: false,
                      show: true,
                      edit: false,
                      filter: true,
                    },
                  },
                  'metadata.duration': {
                    type: 'number',
                    isVisible: {
                      list: false,
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
                    description: 'Source URL - Link to original content',
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
                    description:
                      'Detailed analysis results with visual formatting',
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
                    position: 6,
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

                                    // Manual combination trigger
                  triggerCombination: {
                    actionType: 'record',
                    icon: 'Layers',
                    label: 'Combine Chunks',
                    variant: 'success',
                    component: false,
                    handler: async (request, response, context) => {
                      const { record } = context;
                      const contentId = record.id();
                      const fetch = (await import('node-fetch')).default;

                      try {
                        // Check combination status first via API
                        const statusUrl = `${process.env.API_BASE_URL || 'http://localhost:3333'}/api/content/${contentId}/combination-status`;
                        const statusResponse = await fetch(statusUrl);
                        const statusData = await statusResponse.json();
                        
                        if (!statusResponse.ok || !statusData.success) {
                          return {
                            notice: {
                              message: `Error checking status: ${statusData.error || 'Unknown error'}`,
                              type: 'error',
                            },
                            record: record.toJSON(context.currentAdmin),
                          };
                        }

                        if (!statusData.status.canCombine) {
                          return {
                            notice: {
                              message: `Cannot combine chunks: ${statusData.status.reason}`,
                              type: 'error',
                            },
                            record: record.toJSON(context.currentAdmin),
                          };
                        }

                        // Trigger combination via API
                        const combineUrl = `${process.env.API_BASE_URL || 'http://localhost:3333'}/api/content/${contentId}/trigger-combination`;
                        const combineResponse = await fetch(combineUrl, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({}),
                        });
                        const combineData = await combineResponse.json();

                        return {
                          notice: {
                            message: combineData.success
                              ? combineData.message
                              : `Error: ${combineData.error}`,
                            type: combineData.success ? 'success' : 'error',
                          },
                          record: record.toJSON(context.currentAdmin),
                        };
                      } catch (error) {
                        return {
                          notice: {
                            message: `Error triggering combination: ${error.message}`,
                            type: 'error',
                          },
                          record: record.toJSON(context.currentAdmin),
                        };
                      }
                    },
                    showInDrawer: false,
                  },

                  // Reset chunks action
                  resetChunks: {
                    actionType: 'record',
                    icon: 'RotateCcw',
                    label: 'Reset Chunks',
                    variant: 'danger',
                    component: false,
                    handler: async (request, response, context) => {
                      const { record } = context;
                      const contentId = record.id();
                      const fetch = (await import('node-fetch')).default;

                      try {
                        // Reset chunks via API
                        const resetUrl = `${process.env.API_BASE_URL || 'http://localhost:3333'}/api/content/${contentId}/reset-chunks`;
                        const resetResponse = await fetch(resetUrl, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                        });
                        const resetData = await resetResponse.json();

                        return {
                          notice: {
                            message: resetData.success
                              ? resetData.message
                              : `Error: ${resetData.error}`,
                            type: resetData.success ? 'success' : 'error',
                          },
                          record: record.toJSON(context.currentAdmin),
                        };
                      } catch (error) {
                        return {
                          notice: {
                            message: `Error resetting chunks: ${error.message}`,
                            type: 'error',
                          },
                          record: record.toJSON(context.currentAdmin),
                        };
                      }
                    },
                    showInDrawer: false,
                  },

                  // Check combination status action
                  checkCombinationStatus: {
                    actionType: 'record',
                    icon: 'Info',
                    label: 'Check Status',
                    variant: 'light',
                    component: false,
                    handler: async (request, response, context) => {
                      const { record } = context;
                      const contentId = record.id();
                      const fetch = (await import('node-fetch')).default;

                      try {
                        // Check combination status via API
                        const statusUrl = `${process.env.API_BASE_URL || 'http://localhost:3333'}/api/content/${contentId}/combination-status`;
                        const statusResponse = await fetch(statusUrl);
                        const statusData = await statusResponse.json();

                        if (!statusResponse.ok || !statusData.success) {
                          return {
                            notice: {
                              message: `Error checking status: ${statusData.error || 'Unknown error'}`,
                              type: 'error',
                            },
                            record: record.toJSON(context.currentAdmin),
                          };
                        }

                        const status = statusData.status;
                        return {
                          notice: {
                            message: `Status: ${status.status} | ${status.reason} | Chunks: ${status.completedChunks}/${status.expectedChunks} completed${status.failedChunks > 0 ? `, ${status.failedChunks} failed` : ''}`,
                            type: status.canCombine ? 'success' : 'info',
                          },
                          record: record.toJSON(context.currentAdmin),
                        };
                      } catch (error) {
                        return {
                          notice: {
                            message: `Error checking status: ${error.message}`,
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
