import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { VideoInsightService } from './video-insight.service';
import { Content } from '../schemas/content.schema';
import { VideoInsight } from '../schemas/video-insight.schema';
import { ResearchResult } from '../schemas/research-result.schema';
import { Prompt, PromptType } from '../schemas/prompt.schema';
import { Channel } from '../schemas/channel.schema';
import { GenerateContentConfig, GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { EnhancedQuotaManagerService as QuotaManagerService } from './enhanced-quota-manager.service';
import { ChannelsService } from '../channels/channels.service';

/**
 * Replace template variables like {{video.title}}, {{video.description}} with actual values
 */
function replaceTemplateVariables(
  template: string,
  variables: Record<string, any>,
): string {
  return template.replace(/{\{([^}]+)\}\}/g, (match, key) => {
    const keys = key.split('.');
    let value = variables;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return match; // Keep original if variable not found
      }
    }

    return String(value || match);
  });
}

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);
  private genAI: GoogleGenAI;

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    @InjectModel(VideoInsight.name)
    private videoInsightModel: Model<VideoInsight>,
    @InjectModel(ResearchResult.name)
    private researchResultModel: Model<ResearchResult>,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
    private videoInsightService: VideoInsightService,
    private configService: ConfigService,
    private quotaManager: QuotaManagerService,
    private channelsService: ChannelsService,
    @InjectQueue('research-processing') private researchProcessingQueue: Queue,
  ) {
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');

    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY is required for research processing');
    }

    this.genAI = new GoogleGenAI({
      apiKey: geminiApiKey,
    });

    this.logger.log('✅ ResearchService initialized successfully');
  }

  /**
   * Check research status for a specific video and prompt combination
   * Business-focused replacement for getCombinationStatus
   */
  async getResearchStatus(
    contentId: string | Types.ObjectId,
    promptId?: string | Types.ObjectId,
  ): Promise<{
    canProcessResearch: boolean;
    availableInsights: number;
    completedResearch: number;
    failedResearch: number;
    status: string;
    reason?: string;
  }> {
    const content = await this.contentModel.findById(contentId).exec();
    if (!content) {
      return {
        canProcessResearch: false,
        availableInsights: 0,
        completedResearch: 0,
        failedResearch: 0,
        status: 'ERROR',
        reason: 'Content not found',
      };
    }

    // Check if video has gathered insights
    if (content.status !== 'INSIGHTS_GATHERED') {
      return {
        canProcessResearch: false,
        availableInsights: 0,
        completedResearch: 0,
        failedResearch: 0,
        status: 'INSIGHTS_NOT_READY',
        reason: `Video status is ${content.status}, needs to be INSIGHTS_GATHERED`,
      };
    }

    // Count available insights
    const availableInsights = await this.videoInsightModel
      .countDocuments({
        contentId: new Types.ObjectId(contentId),
        status: 'INSIGHTS_GATHERED',
      })
      .exec();

    if (availableInsights === 0) {
      return {
        canProcessResearch: false,
        availableInsights: 0,
        completedResearch: 0,
        failedResearch: 0,
        status: 'NO_INSIGHTS',
        reason: 'No gathered insights found for this video',
      };
    }

    // Count research results
    const researchQuery: any = { contentId: new Types.ObjectId(contentId) };
    if (promptId) {
      researchQuery.promptId = new Types.ObjectId(promptId);
    }

    const [completedResearch, failedResearch] = await Promise.all([
      this.researchResultModel
        .countDocuments({ ...researchQuery, status: 'COMPLETED' })
        .exec(),
      this.researchResultModel
        .countDocuments({ ...researchQuery, status: 'FAILED' })
        .exec(),
    ]);

    return {
      canProcessResearch: true,
      availableInsights,
      completedResearch,
      failedResearch,
      status: 'READY',
    };
  }

  /**
   * Process a specific research prompt against video insights using database IDs
   * Business-focused replacement for combineChunkAnalysesUsingAI
   */
  async processPrompt(
    contentId: string | Types.ObjectId,
    promptId: string | Types.ObjectId,
    forceModel?: string,
  ): Promise<any> {
    const startTime = Date.now();

    this.logger.log(`🔬 Processing research prompt with ID: ${promptId}`);
    this.logger.log(`   📊 Processing content with ID: ${contentId}`);

    try {
      // Load content, prompt, and insights from database
      const [content, prompt, insights] = await Promise.all([
        this.contentModel.findById(contentId).exec(),
        this.promptModel.findById(promptId).exec(),
        this.videoInsightModel
          .find({
            contentId: new Types.ObjectId(contentId),
            status: 'INSIGHTS_GATHERED',
          })
          .exec(),
      ]);

      if (!content) {
        throw new Error(`Content not found: ${contentId}`);
      }
      if (!prompt) {
        throw new Error(`Prompt not found: ${promptId}`);
      }
      if (insights.length === 0) {
        throw new Error(`No insights found for content: ${contentId}`);
      }

      this.logger.log(`📹 Video: ${content.title}`);
      this.logger.log(`🔬 Research prompt: "${prompt.promptName}"`);
      this.logger.log(`📊 Using ${insights.length} video insights`);

      // Select best available model for research processing
      let selectedModel = forceModel;
      if (!selectedModel) {
        const modelResult =
          await this.quotaManager.findBestAvailableModel(30000);
        if (!modelResult.model) {
          throw new Error(
            `No models available for research processing: ${modelResult.reason}`,
          );
        }
        selectedModel = modelResult.model;
      }

      this.logger.log(
        `🤖 Using model: ${selectedModel} for research processing`,
      );

      const channel = await this.channelsService.getChannelById(
        content.channelId,
      );

      // Prepare template variables for dynamic replacement
      const templateVariables = {
        video: {
          title: content.title,
          description: content.description,
          duration: content.metadata?.duration,
          durationMinutes: content.metadata?.duration
            ? Math.round(content.metadata.duration / 60)
            : null,
          publishedAt: content.publishedAt,
          channel,
        },
        insights: {
          count: insights.length,
          totalSegments: insights.length,
        },
        analysis: {
          prompt: prompt.promptName,
          version: prompt.version,
        },
      };

      // Prepare insights summary for research
      const insightsSummary = insights
        .map((insight, index) => {
          return `
Segment ${index + 1} (${insight.startTime}s - ${insight.endTime}s):
${typeof insight.insights === 'string' ? insight.insights : JSON.stringify(insight.insights, null, 2)}
`;
        })
        .join('\n---\n');

      // Apply dynamic template replacement
      const processedPrompt = replaceTemplateVariables(
        prompt.promptTemplate,
        templateVariables,
      );

      this.logger.log(
        `📝 Applied template variables to prompt (${processedPrompt.length} chars)`,
      );

      // Create complete prompt with insights data
      const fullPrompt = `${processedPrompt}<insights>${insightsSummary}</insights>`;

      // Prepare config for Gemini API (following original working pattern)
      const config: GenerateContentConfig = {
        temperature: 0.1,
      };

      // Add structured output if schema is defined in prompt
      if (prompt.responseSchema && prompt.responseMimeType) {
        config.responseMimeType = prompt.responseMimeType;
        config.responseSchema = prompt.responseSchema;
        this.logger.log(
          `📊 Using structured output: ${prompt.responseMimeType}`,
        );
      }

      // Prepare contents in the correct format
      const contents = [
        {
          role: 'user',
          parts: [{ text: fullPrompt }],
        },
      ];

      // Call Gemini for research processing (using correct API pattern)
      this.logger.log(
        `🧠 Sending research processing request to ${selectedModel}...`,
      );

      let responseText = '';

      if (prompt.responseSchema) {
        // Use regular generateContent for structured output
        const result = await this.genAI.models.generateContent({
          model: selectedModel,
          config,
          contents,
        });
        responseText = result.text;
      } else {
        // Use streaming for better performance with unstructured output
        const response = await this.genAI.models.generateContentStream({
          model: selectedModel,
          config,
          contents,
        });

        let chunkCount = 0;
        for await (const streamChunk of response) {
          if (streamChunk.text) {
            responseText += streamChunk.text;
            chunkCount++;

            // Log every 10 chunks to avoid log spam
            if (chunkCount % 10 === 0) {
              this.logger.log(
                `📄 Received ${chunkCount} response chunks (${responseText.length} chars)`,
              );
            }
          }
        }
      }

      this.logger.log(
        `✅ Received research response from ${selectedModel} (${responseText.length} characters)`,
      );

      // Parse the research response
      let researchResult: any;

      // If structured output, try to parse as JSON
      if (
        prompt.responseSchema &&
        prompt.responseMimeType === 'application/json'
      ) {
        try {
          researchResult = JSON.parse(responseText);
          this.logger.log(`📊 Successfully parsed structured JSON response`);
        } catch (parseError) {
          this.logger.warn(
            `⚠️ Failed to parse JSON response, storing as text: ${parseError.message}`,
          );
          researchResult = {
            research_question: prompt.promptName,
            response_type: 'structured_text',
            findings: responseText,
            metadata: {
              prompt_version: prompt.version,
              insights_processed: insights.length,
              model_used: selectedModel,
              processing_time_ms: Date.now() - startTime,
              processed_at: new Date().toISOString(),
            },
          };
        }
      } else {
        // For unstructured output, try to parse as JSON first
        try {
          researchResult = JSON.parse(responseText);
        } catch (parseError) {
          // If not JSON, structure the response
          researchResult = {
            research_question: prompt.promptName,
            response_type: 'structured_text',
            findings: responseText,
            metadata: {
              prompt_version: prompt.version,
              insights_processed: insights.length,
              model_used: selectedModel,
              processing_time_ms: Date.now() - startTime,
              processed_at: new Date().toISOString(),
            },
          };
        }
      }

      // Add metadata if JSON was parsed but missing it
      if (!researchResult.metadata) {
        researchResult.metadata = {
          prompt_version: prompt.version,
          insights_processed: insights.length,
          model_used: selectedModel,
          processing_time_ms: Date.now() - startTime,
          processed_at: new Date().toISOString(),
        };
      }

      // Record quota usage
      const estimatedTokens = Math.min(30000, responseText.length * 1.5);
      await this.quotaManager.recordRequest(selectedModel, estimatedTokens);

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `✅ Research prompt processed successfully in ${processingTime}ms`,
      );

      return researchResult;
    } catch (error) {
      this.logger.error(
        `❌ Error processing research prompt: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * @deprecated
   * Queue research processing for a video-prompt combination
   * Business-focused replacement for triggerCombination
   */
  async queueResearchProcessing(
    contentId: string | Types.ObjectId,
    promptId: string | Types.ObjectId,
    priority: number = 0,
  ): Promise<{
    success: boolean;
    jobId?: string;
    reason?: string;
  }> {
    try {
      this.logger.log(
        `📋 Queueing research processing for content ${contentId} with prompt ${promptId}`,
      );

      // Check if research can be processed
      const status = await this.getResearchStatus(contentId, promptId);
      if (!status.canProcessResearch) {
        return {
          success: false,
          reason: status.reason,
        };
      }

      // Check if research already exists
      const existingResearch = await this.researchResultModel
        .findOne({
          contentId: new Types.ObjectId(contentId),
          promptId: new Types.ObjectId(promptId),
          status: { $in: ['COMPLETED', 'PROCESSING', 'QUEUED'] },
        })
        .exec();

      if (existingResearch) {
        return {
          success: false,
          reason: `Research already ${existingResearch.status.toLowerCase()} for this video-prompt combination`,
        };
      }

      // Verify content and prompt exist
      const content = await this.contentModel.findById(contentId).exec();
      const prompt = await this.promptModel.findById(promptId).exec();

      if (!content || !prompt) {
        return {
          success: false,
          reason: 'Content or prompt not found',
        };
      }

      // Queue the research processing job with just IDs
      const job = await this.researchProcessingQueue.add(
        'process-research-prompt',
        {
          contentId: contentId.toString(),
          promptId: promptId.toString(),
        },
        {
          priority: priority,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: 10,
          removeOnFail: 20,
        },
      );

      // Create research result placeholder
      await this.researchResultModel.create({
        contentId: new Types.ObjectId(contentId),
        promptId: new Types.ObjectId(promptId),
        status: 'QUEUED',
        queuedAt: new Date(),
      });

      this.logger.log(
        `✅ Research processing queued successfully with job ID: ${job.id}`,
      );

      return {
        success: true,
        jobId: job.id,
      };
    } catch (error) {
      this.logger.error(
        `❌ Error queueing research processing: ${error.message}`,
      );
      return {
        success: false,
        reason: error.message,
      };
    }
  }

  /**
   * Reset insights for re-processing (business-focused replacement for resetChunks)
   */
  async resetInsights(contentId: string | Types.ObjectId): Promise<{
    success: boolean;
    deletedInsights: number;
    deletedResearch: number;
    reason?: string;
  }> {
    try {
      this.logger.log(`🔄 Resetting insights for content: ${contentId}`);

      const content = await this.contentModel.findById(contentId).exec();
      if (!content) {
        return {
          success: false,
          deletedInsights: 0,
          deletedResearch: 0,
          reason: 'Content not found',
        };
      }

      // Delete existing insights
      const deletedInsights = await this.videoInsightModel
        .deleteMany({
          contentId: new Types.ObjectId(contentId),
        })
        .exec();

      // Delete existing research results
      const deletedResearch = await this.researchResultModel
        .deleteMany({
          contentId: new Types.ObjectId(contentId),
        })
        .exec();

      // Reset content status to allow re-processing
      await this.contentModel
        .updateOne(
          { _id: new Types.ObjectId(contentId) },
          {
            status: 'METADATA_READY',
            insightJobsQueuedAt: null,
            insightsGatheredAt: null,
          },
        )
        .exec();

      this.logger.log(`✅ Insights reset completed:`);
      this.logger.log(`   🗑️ Deleted ${deletedInsights.deletedCount} insights`);
      this.logger.log(
        `   🗑️ Deleted ${deletedResearch.deletedCount} research results`,
      );
      this.logger.log(`   🔄 Content status reset to METADATA_READY`);

      return {
        success: true,
        deletedInsights: deletedInsights.deletedCount,
        deletedResearch: deletedResearch.deletedCount,
      };
    } catch (error) {
      this.logger.error(`❌ Error resetting insights: ${error.message}`);
      return {
        success: false,
        deletedInsights: 0,
        deletedResearch: 0,
        reason: error.message,
      };
    }
  }
}
