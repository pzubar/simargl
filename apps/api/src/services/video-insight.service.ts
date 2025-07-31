import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { Prompt, PromptType } from '../schemas/prompt.schema';
import { VideoInsight as VideoInsightModel } from '../schemas/video-insight.schema';
import { GoogleGenAI } from '@google/genai';
import { EnhancedQuotaManagerService as QuotaManagerService } from './enhanced-quota-manager.service';
import {
  VideoAnalysisResponseSchema,
  VideoAnalysisResponse,
} from '../schemas/video-analysis-response.schema';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Content } from '../schemas/content.schema';
import { Channel } from '../schemas/channel.schema';

export interface VideoMetadata {
  duration: number;
  viewCount: number;
  channel: string;
  thumbnailUrl: string;
  webpageUrl: string;
  fetchedAt: Date;
  lastUpdatedAt: Date;
}

export interface VideoChunk {
  startTime: number; // in seconds
  endTime: number; // in seconds
  duration: number; // in seconds
  chunkIndex: number;
  totalChunks: number;
}

export interface ChunkInsightResult {
  chunk: VideoChunk;
  insights: string; // Raw markdown insights extracted from this video segment
  processingTime: number;
  success: boolean;
  error?: string;
  modelUsed?: string; // Track which model was used for insight gathering
  isModelOverloaded?: boolean; // Track overload situations
}

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

export interface VideoInsightSummary {
  metadata: {
    primary_language: string;
    hosts_or_speakers: string[];
    video_type: string;
    main_topics: string[];
    target_audience: string;
    estimated_duration_minutes: number;
  };
  key_insights: {
    summary: string;
    main_points: string[];
    key_quotes: string[];
    technical_details: string[];
    actionable_takeaways: string[];
  };
  business_intelligence: {
    market_trends: string[];
    opportunities: string[];
    challenges: string[];
    competitive_insights: string[];
    innovation_highlights: string[];
  };
  content_analysis: {
    structure_breakdown: string[];
    engagement_factors: string[];
    content_quality_assessment: string;
    accessibility_notes: string[];
  };
  research_value: {
    relevance_score: number;
    information_density: number;
    unique_insights: string[];
    research_applications: string[];
  };
}

@Injectable()
export class VideoInsightService {
  private readonly logger = new Logger(VideoInsightService.name);
  private genAI: GoogleGenAI;
  private youtube: any;

  constructor(
    @InjectModel(VideoInsightModel.name)
    private videoInsightModel: Model<VideoInsightModel>,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    private configService: ConfigService,
    private quotaManager: QuotaManagerService,
  ) {
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
    const youtubeApiKey = this.configService.get<string>('YOUTUBE_API_KEY');

    this.logger.log('🔧 Initializing VideoInsightService...');

    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }

    this.genAI = new GoogleGenAI({
      apiKey: geminiApiKey,
    });

    // Initialize YouTube API if key is available
    if (youtubeApiKey) {
      this.youtube = google.youtube({
        version: 'v3',
        auth: youtubeApiKey,
      });
      this.logger.log('✅ YouTube Data API initialized');
    } else {
      this.logger.warn(
        '⚠️ YouTube Data API key not provided - fallback will be limited',
      );
    }

    this.logger.log('✅ VideoInsightService initialized successfully');
  }

  /**
   * Extract YouTube video ID from URL
   */
  private extractVideoId(url: string): string | null {
    const regex =
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Parse ISO 8601 duration (e.g., PT4M13S) to seconds
   */
  private parseISO8601Duration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Validate YouTube URL and get video info using Google YouTube Data API
   */
  async validateAndGetVideoInfo(
    youtubeUrl: string,
  ): Promise<{ videoId: string; info: any; duration: number }> {
    const videoId = this.extractVideoId(youtubeUrl);
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    this.logger.log(`🔍 Fetching video info for: ${youtubeUrl}`);
    this.logger.log(`📹 Video ID: ${videoId}`);

    if (!this.youtube) {
      throw new Error(
        'YouTube Data API is not available - YOUTUBE_API_KEY required',
      );
    }

    try {
      this.logger.log('🚀 Fetching video info using YouTube Data API...');

      const response = await this.youtube.videos.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        id: [videoId],
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('Video not found via YouTube Data API');
      }

      const videoData = response.data.items[0];
      const durationISO = videoData.contentDetails.duration;
      const duration = this.parseISO8601Duration(durationISO);
      const title = videoData.snippet.title;
      const description = videoData.snippet.description;
      const channel = videoData.snippet.channelTitle;

      this.logger.log(
        `✅ Successfully retrieved video info via YouTube Data API:`,
      );
      this.logger.log(`   📝 Title: ${title}`);
      this.logger.log(`   👤 Channel: ${channel}`);
      this.logger.log(
        `   ⏱️ Duration: ${Math.round(duration / 60)}m ${duration % 60}s`,
      );
      this.logger.log(
        `   👀 View count: ${videoData.statistics.viewCount || 'N/A'}`,
      );
      this.logger.log(`   📅 Published: ${videoData.snippet.publishedAt}`);

      return {
        videoId,
        info: videoData,
        duration,
      };
    } catch (error) {
      this.logger.error(`❌ Error fetching video info: ${error.message}`);
      throw new Error(`Failed to fetch video info: ${error.message}`);
    }
  }

  /**
   * Gather insights from a specific video chunk/segment
   * This is the business-focused replacement for analyzeVideoChunkDirect
   */
  async gatherChunkInsights(
    youtubeUrl: string,
    videoInfo: any,
    chunkData: { chunkIndex: number; startTime: number; endTime: number },
    forceModel?: string,
  ): Promise<ChunkInsightResult> {
    const startTime = Date.now();

    this.logger.log(
      `🔍 Gathering insights from video chunk ${chunkData.chunkIndex + 1}`,
    );
    this.logger.log(`   📹 URL: ${youtubeUrl}`);
    this.logger.log(
      `   ⏰ Time range: ${chunkData.startTime}s - ${chunkData.endTime}s`,
    );

    try {
      // Get current active prompt for insight gathering
      // Get active insight gathering prompt from database
      const prompt = await this.promptModel
        .findOne({ promptType: PromptType.INSIGHT_GATHERING })
        .sort({ version: -1 })
        .exec();
      if (!prompt) {
        throw new Error('No active insight gathering prompt found');
      }

      // Select best available model for insight gathering
      let selectedModel = forceModel;
      if (!selectedModel) {
        const modelResult =
          await this.quotaManager.findBestAvailableModel(15000);
        if (!modelResult.model) {
          this.logger.warn(
            `⚠️ No models available for insight gathering: ${modelResult.reason}`,
          );
          return {
            chunk: {
              startTime: chunkData.startTime,
              endTime: chunkData.endTime,
              duration: chunkData.endTime - chunkData.startTime,
              chunkIndex: chunkData.chunkIndex,
              totalChunks: 1,
            },
            insights: '',
            processingTime: Date.now() - startTime,
            success: false,
            error: `No models available: ${modelResult.reason}`,
            isModelOverloaded: true,
          };
        }
        selectedModel = modelResult.model;
      }

      this.logger.log(`🤖 Using model: ${selectedModel} for insight gathering`);

      // Prepare template variables for dynamic replacement
      const templateVariables = {
        video: {
          title: videoInfo.title,
          channel: videoInfo.channel,
          duration: videoInfo.duration,
          durationMinutes: Math.round(videoInfo.duration / 60),
          publishedAt: videoInfo.publishedAt,
          description: videoInfo.description,
          descriptionShort: videoInfo.description?.substring(0, 500) + '...',
        },
        chunk: {
          index: chunkData.chunkIndex + 1,
          startTime: chunkData.startTime,
          endTime: chunkData.endTime,
          duration: chunkData.endTime - chunkData.startTime,
        },
      };

      // Apply dynamic template replacement
      const processedPrompt = replaceTemplateVariables(
        prompt.promptTemplate,
        templateVariables,
      );

      this.logger.log(
        `📝 Applied template variables to prompt (${processedPrompt.length} chars)`,
      );

      // Prepare config for Gemini API (following original working pattern)
      const config: any = {
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

      // Prepare contents in the correct format (following original pattern)
      const contents = [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: youtubeUrl,
                mimeType: 'video/*',
              },
              videoMetadata: {
                startOffset: `${chunkData.startTime}s`,
                endOffset: `${chunkData.endTime}s`,
              },
            },
            {
              text: processedPrompt,
            },
          ],
        },
      ];

      // Call Gemini for insight gathering (using correct API pattern)
      this.logger.log(
        `🧠 Sending insight gathering request to ${selectedModel}...`,
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
        `✅ Received insights from ${selectedModel} (${responseText.length} characters)`,
      );

      // Store insights (structured JSON or unstructured markdown)
      let insights: any = responseText;

      // If structured output, try to parse as JSON
      if (
        prompt.responseSchema &&
        prompt.responseMimeType === 'application/json'
      ) {
        try {
          insights = JSON.parse(responseText);
          this.logger.log(`📊 Successfully parsed structured JSON response`);
        } catch (error) {
          this.logger.warn(
            `⚠️ Failed to parse JSON response, storing as text: ${error.message}`,
          );
          insights = responseText; // Fallback to raw text
        }
      }

      // Record quota usage
      await this.quotaManager.recordRequest(selectedModel, 15000); // Estimated tokens

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `✅ Insights gathered successfully in ${processingTime}ms`,
      );

      return {
        chunk: {
          startTime: chunkData.startTime,
          endTime: chunkData.endTime,
          duration: chunkData.endTime - chunkData.startTime,
          chunkIndex: chunkData.chunkIndex,
          totalChunks: 1,
        },
        insights: insights,
        processingTime: processingTime,
        success: true,
        modelUsed: selectedModel,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `❌ Error gathering insights from chunk ${chunkData.chunkIndex + 1}: ${error.message}`,
      );

      return {
        chunk: {
          startTime: chunkData.startTime,
          endTime: chunkData.endTime,
          duration: chunkData.endTime - chunkData.startTime,
          chunkIndex: chunkData.chunkIndex,
          totalChunks: 1,
        },
        insights: '',
        processingTime: processingTime,
        success: false,
        error: error.message,
        modelUsed: forceModel,
      };
    }
  }

  /**
   * Fetch video metadata for business intelligence purposes
   * This method remains unchanged as it already has clear business purpose
   */
  async fetchVideoMetadata(youtubeUrl: string): Promise<{
    metadata: VideoMetadata;
    success: boolean;
    error?: string;
  }> {
    try {
      this.logger.log(`📊 Fetching metadata for: ${youtubeUrl}`);

      const { info, duration } = await this.validateAndGetVideoInfo(youtubeUrl);

      const metadata: VideoMetadata = {
        duration: duration,
        viewCount: parseInt(info.statistics?.viewCount || '0'),
        channel: info.snippet?.channelTitle || 'Unknown',
        thumbnailUrl: info.snippet?.thumbnails?.high?.url || '',
        webpageUrl: youtubeUrl,
        fetchedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      this.logger.log(`✅ Metadata fetched successfully`);
      this.logger.log(
        `   ⏱️ Duration: ${Math.round(duration / 60)}m ${duration % 60}s`,
      );
      this.logger.log(`   👀 Views: ${metadata.viewCount.toLocaleString()}`);
      this.logger.log(`   👤 Channel: ${metadata.channel}`);

      return {
        metadata,
        success: true,
      };
    } catch (error) {
      this.logger.error(`❌ Error fetching metadata: ${error.message}`);
      return {
        metadata: null,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Gather insights from entire video by processing it in optimal chunks
   * This is the business-focused replacement for analyzeYouTubeVideo
   */
  async gatherVideoInsights(
    youtubeUrl: string,
    contentId: string,
    metadata?: any,
    forceModel?: string,
  ): Promise<VideoInsightSummary> {
    this.logger.log(
      `🎯 Starting comprehensive insight gathering for video: ${youtubeUrl}`,
    );

    try {
      // Validate video and get basic info
      const { videoId, info, duration } =
        await this.validateAndGetVideoInfo(youtubeUrl);

      // Calculate optimal chunks for insight gathering
      const chunkDuration = 300; // 5 minutes per chunk for optimal insight extraction
      const totalChunks = Math.ceil(duration / chunkDuration);

      this.logger.log(
        `📊 Video will be processed in ${totalChunks} chunks of ${chunkDuration}s each`,
      );

      const chunkResults: ChunkInsightResult[] = [];

      // Process each chunk to gather insights
      for (let i = 0; i < totalChunks; i++) {
        const startTime = i * chunkDuration;
        const endTime = Math.min((i + 1) * chunkDuration, duration);

        this.logger.log(
          `🔍 Processing chunk ${i + 1}/${totalChunks}: ${startTime}s - ${endTime}s`,
        );

        const chunkResult = await this.gatherChunkInsights(
          youtubeUrl,
          {
            title: info.snippet.title,
            channel: info.snippet.channelTitle,
            duration: duration,
            publishedAt: info.snippet.publishedAt,
            description: info.snippet.description,
          },
          {
            chunkIndex: i,
            startTime: startTime,
            endTime: endTime,
          },
          forceModel,
        );

        chunkResults.push(chunkResult);

        if (!chunkResult.success) {
          this.logger.warn(`⚠️ Chunk ${i + 1} failed: ${chunkResult.error}`);
        }
      }

      // Combine all chunk insights into comprehensive video insights
      // This is a simplified version - in the new architecture,
      // this will be handled by the ResearchService
      const successfulChunks = chunkResults.filter((chunk) => chunk.success);

      if (successfulChunks.length === 0) {
        throw new Error('No chunks were successfully processed');
      }

      // Create a summary of gathered insights
      const videoInsights: VideoInsightSummary = {
        metadata: {
          primary_language: 'en', // Could be detected from content
          hosts_or_speakers: [info.snippet.channelTitle],
          video_type: 'educational', // Could be classified
          main_topics: [], // Extracted from chunks
          target_audience: 'general',
          estimated_duration_minutes: Math.round(duration / 60),
        },
        key_insights: {
          summary: `Insights gathered from ${successfulChunks.length}/${totalChunks} video segments`,
          main_points: [],
          key_quotes: [],
          technical_details: [],
          actionable_takeaways: [],
        },
        business_intelligence: {
          market_trends: [],
          opportunities: [],
          challenges: [],
          competitive_insights: [],
          innovation_highlights: [],
        },
        content_analysis: {
          structure_breakdown: [`${totalChunks} segments analyzed`],
          engagement_factors: [],
          content_quality_assessment: 'Analysis completed',
          accessibility_notes: [],
        },
        research_value: {
          relevance_score: 0.8,
          information_density: successfulChunks.length / totalChunks,
          unique_insights: [],
          research_applications: [],
        },
      };

      this.logger.log(
        `✅ Video insight gathering completed: ${successfulChunks.length}/${totalChunks} chunks successful`,
      );

      return videoInsights;
    } catch (error) {
      this.logger.error(
        `❌ Error in video insight gathering: ${error.message}`,
      );
      throw error;
    }
  }
}
