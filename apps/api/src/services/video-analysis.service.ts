import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { Prompt } from '../schemas/prompt.schema';
import { VideoChunk as VideoChunkModel } from '../schemas/video-chunk.schema';
import { GoogleGenAI } from '@google/genai';
import {
  QuotaManagerService,
  GEMINI_MODELS,
  GeminiModel,
} from './quota-manager.service';
import {
  VideoAnalysisResponseSchema,
  VideoAnalysisResponse,
} from '../schemas/video-analysis-response.schema';

// VIDEO TOKEN OPTIMIZATION NOTES:
// Based on https://ai.google.dev/gemini-api/docs/video-understanding#technical-details-video
//
// Token Calculation Formula:
// - Default: ~300 tokens/second (258 tokens/frame at 1fps + 32 tokens/second audio)
// - Optimized: ~100 tokens/second (66 tokens/frame at 1fps + 32 tokens/second audio with low resolution)
// - Custom FPS: Can be < 1 for static content (lectures, presentations)
//
// Current Optimizations Applied:
// ✅ FPS: 0.5 (half frame rate for mostly static content)
// ✅ Accurate token calculation based on chunk duration
// ✅ Official structured output schema (replaces manual JSON parsing)
// ⚠️  Media resolution: 'low' setting needs SDK support verification
//
// TODO: 1. Fix overlapping (now it looses 30 secons for each chunk)
// 2. Verify media resolution setting in latest SDK version

export interface VideoChunk {
  startTime: number; // in seconds
  endTime: number; // in seconds
  duration: number; // in seconds
  chunkIndex: number;
  totalChunks: number;
}

export interface ChunkAnalysisResult {
  chunk: VideoChunk;
  analysis: any; // The JSON analysis result from Gemini
  processingTime: number;
  success: boolean;
  error?: string;
  modelUsed?: string; // Track which model was used for this analysis
  isModelOverloaded?: boolean; // New field to track overload situations
}

export interface CombinedAnalysisResult {
  metadata: {
    primary_language: string;
    hosts_or_speakers: string[];
    video_duration: number;
    total_chunks: number;
    processing_summary: {
      successful_chunks: number;
      failed_chunks: number;
      total_processing_time: number;
    };
  };
  stance_and_thesis: any;
  narrative_analysis: any;
  rhetorical_and_emotional_analysis: any;
  visual_analysis: any;
  source_and_evidence_analysis: any;
  entity_and_topic_indexing: any;
  classification: any;
}

@Injectable()
export class VideoAnalysisService {
  private readonly logger = new Logger(VideoAnalysisService.name);
  private genAI: GoogleGenAI;
  private youtube: any;

  // Configuration constants
  private readonly MAX_CHUNK_DURATION = 15 * 60; // 15 minutes per chunk
  private readonly OVERLAP_DURATION = 30; // 30 seconds overlap between chunks
  private readonly MAX_RETRIES = 3; // Increased for better handling
  private readonly RETRY_DELAY = 2000; // 2 seconds base delay
  
  // 503 error specific configuration
  private readonly OVERLOAD_RETRY_DELAY = 30000; // 30 seconds for overload errors
  private readonly MAX_OVERLOAD_RETRIES = 2; // Specific retries for overload errors

  constructor(
    private configService: ConfigService,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
    @InjectModel(VideoChunkModel.name) private videoChunkModel: Model<VideoChunkModel>,
    private quotaManager: QuotaManagerService,
  ) {
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
    const youtubeApiKey = this.configService.get<string>('YOUTUBE_API_KEY');

    this.logger.log('🔧 Initializing VideoAnalysisService...');

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

    this.logger.log('✅ VideoAnalysisService initialized successfully');
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

      const info = {
        title,
        description,
        duration,
        channel,
        view_count: videoData.statistics.viewCount,
        upload_date: videoData.snippet.publishedAt,
        thumbnail:
          videoData.snippet.thumbnails?.maxres?.url ||
          videoData.snippet.thumbnails?.high?.url,
        webpage_url: youtubeUrl,
      };

      return { videoId, info, duration };
    } catch (apiError) {
      this.logger.error(`❌ YouTube Data API failed: ${apiError.message}`);
      throw new Error(
        `Unable to retrieve video information: ${apiError.message}`,
      );
    }
  }

  /**
   * Get optimized video processing settings for token efficiency
   * Based on https://ai.google.dev/gemini-api/docs/video-understanding#technical-details-video
   */
  private getOptimizedVideoSettings() {
    return {
      fps: 0.5, // Lower FPS for mostly static content (< 1 FPS recommended for lectures)
      // Note: mediaResolution should be set to 'low' for 66 tokens/frame vs 258
      // This reduces cost from ~300 tokens/second to ~100 tokens/second
      // Currently using FPS optimization, media resolution optimization needs SDK support
    };
  }

  /**
   * Log optimization recommendations for video processing
   */
  private logOptimizationRecommendations(
    videoDuration: number,
    videoTitle?: string,
  ): void {
    this.logger.log(
      `🎯 OPTIMIZATION RECOMMENDATIONS for video "${videoTitle || 'Unknown'}" (${Math.round(videoDuration / 60)}m ${videoDuration % 60}s):`,
    );

    if (videoDuration > 1800) {
      // 30 minutes
      this.logger.log(
        `   📉 LONG VIDEO: Consider FPS 0.25-0.5 for lectures/static content`,
      );
    }

    if (videoDuration > 3600) {
      // 1 hour
      this.logger.log(
        `   ⚡ VERY LONG: Consider pre-processing to extract key segments`,
      );
    }

    const defaultTokens = videoDuration * 300;
    const optimizedTokens = videoDuration * 100;
    const savings = Math.round(
      ((defaultTokens - optimizedTokens) / defaultTokens) * 100,
    );

    this.logger.log(
      `   💰 TOKEN SAVINGS: ${savings}% reduction (${defaultTokens.toLocaleString()} → ${optimizedTokens.toLocaleString()} tokens)`,
    );
  }

  /**
   * Calculate video token consumption based on official Gemini API documentation
   * @param durationInSeconds Duration of video segment in seconds
   * @param useOptimizedSettings Whether to use optimized settings for better token efficiency
   */
  private calculateVideoTokens(
    durationInSeconds: number,
    useOptimizedSettings: boolean = true,
  ): number {
    if (useOptimizedSettings) {
      // Optimized settings: Low media resolution + 0.5 FPS for static content
      // Low resolution: 66 tokens per frame + 32 tokens per second for audio
      const framesPerSecond = 0.5; // Lower FPS for mostly static content (lectures, etc.)
      const tokensPerFrame = 66; // Low media resolution
      const audioTokensPerSecond = 32;

      const totalFrames = durationInSeconds * framesPerSecond;
      const frameTokens = totalFrames * tokensPerFrame;
      const audioTokens = durationInSeconds * audioTokensPerSecond;

      // Add 10% buffer for metadata and processing overhead
      const totalTokens = Math.ceil((frameTokens + audioTokens) * 1.1);

      this.logger.debug(
        `📊 Video tokens calculation (optimized): ${durationInSeconds}s × ${framesPerSecond}fps × ${tokensPerFrame}t/frame + ${audioTokensPerSecond}t/s audio = ${totalTokens} tokens`,
      );

      return totalTokens;
    } else {
      // Default settings: ~300 tokens per second (as per documentation)
      const tokensPerSecond = 300;
      const totalTokens = Math.ceil(durationInSeconds * tokensPerSecond * 1.1); // 10% buffer

      this.logger.debug(
        `📊 Video tokens calculation (default): ${durationInSeconds}s × ${tokensPerSecond}t/s = ${totalTokens} tokens`,
      );

      return totalTokens;
    }
  }

  /**
   * Calculate video chunks based on duration (with memory-safe loop termination)
   */
  calculateVideoChunks(duration: number): VideoChunk[] {
    // Validate input
    if (!duration || duration <= 0) {
      this.logger.warn(`⚠️ Invalid video duration: ${duration}`);
      return [];
    }

    if (duration <= this.MAX_CHUNK_DURATION) {
      this.logger.log(
        `📊 Video duration (${Math.round(duration / 60)}m) fits in single chunk`,
      );
      return [
        {
          startTime: 0,
          endTime: duration,
          duration: duration,
          chunkIndex: 0,
          totalChunks: 1,
        },
      ];
    }

    const chunks: VideoChunk[] = [];
    let currentStart = 0;
    let chunkIndex = 0;
    const maxPossibleChunks =
      Math.ceil(duration / (this.MAX_CHUNK_DURATION * 0.5)) + 2; // Safety limit

    this.logger.log(
      `📊 Chunking ${Math.round(duration / 60)}m video (max ${this.MAX_CHUNK_DURATION / 60}m per chunk)`,
    );

    while (currentStart < duration && chunkIndex < maxPossibleChunks) {
      let currentEnd = Math.min(
        currentStart + this.MAX_CHUNK_DURATION,
        duration,
      );

      // For the last chunk, merge if it's too small
      if (
        duration - currentEnd < this.MAX_CHUNK_DURATION * 0.3 &&
        currentEnd < duration
      ) {
        currentEnd = duration;
      }

      chunks.push({
        startTime: currentStart,
        endTime: currentEnd,
        duration: currentEnd - currentStart,
        chunkIndex: chunkIndex,
        totalChunks: 0, // Will be set after all chunks are calculated
      });

      chunkIndex++;

      // CRITICAL: If we've reached the end, break immediately
      if (currentEnd >= duration) {
        break;
      }

      // Calculate next start with overlap, ensuring forward progress
      const nextStart = currentEnd - this.OVERLAP_DURATION;

      // Safety: Ensure we always make progress to prevent infinite loops
      if (nextStart <= currentStart) {
        this.logger.warn(`⚠️ Overlap too large, reducing to ensure progress`);
        currentStart = currentStart + this.MAX_CHUNK_DURATION * 0.8; // Force 80% progress
      } else {
        currentStart = nextStart;
      }
    }

    // Safety check
    if (chunkIndex >= maxPossibleChunks) {
      this.logger.error(
        `❌ Chunking safety limit reached! Generated ${chunks.length} chunks`,
      );
    }

    // Set total chunks for all
    chunks.forEach((chunk) => (chunk.totalChunks = chunks.length));

    this.logger.log(
      `📊 Video split into ${chunks.length} chunks (${this.OVERLAP_DURATION}s overlap)`,
    );
    chunks.forEach((chunk, index) => {
      this.logger.log(
        `   📦 Chunk ${index + 1}: ${Math.round(chunk.startTime / 60)}:${String(chunk.startTime % 60).padStart(2, '0')} - ${Math.round(chunk.endTime / 60)}:${String(chunk.endTime % 60).padStart(2, '0')} (${Math.round(chunk.duration / 60)}m${Math.round(chunk.duration % 60)}s)`,
      );
    });

    return chunks;
  }

  /**
   * Check if error is a 503 model overloaded error
   */
  private isModelOverloadedError(error: any): boolean {
    // Check for 503 status code
    if (error.status === 503 || error.code === 503) {
      return true;
    }
    
    // Check error message content for overload indicators
    const errorMessage = error?.message || error?.error?.message || '';
    const overloadKeywords = [
      'overloaded',
      'UNAVAILABLE',
      'Service Unavailable',
      'try again later',
      'too many requests',
      'capacity'
    ];
    
    return overloadKeywords.some(keyword => 
      errorMessage.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * Handle model overload by finding alternative model
   */
  private async handleModelOverload(
    currentModel: string,
    estimatedTokens: number,
    attempt: number
  ): Promise<{ model: string | null; reason?: string }> {
    this.logger.warn(
      `🔄 Model ${currentModel} is overloaded. Attempting to find alternative model (attempt ${attempt})`
    );

    // Temporarily mark current model as overloaded
    this.quotaManager.markModelAsOverloaded(currentModel);

    // Find next best available model
    const modelSelection = await this.quotaManager.findBestAvailableModel(
      estimatedTokens,
      [currentModel] // Exclude the overloaded model
    );

    if (modelSelection.model) {
      this.logger.log(
        `✅ Switched from overloaded ${currentModel} to ${modelSelection.model}`
      );
      return modelSelection;
    }

    this.logger.error(
      `❌ No alternative models available. All models may be overloaded.`
    );
    return {
      model: null,
      reason: 'All models are overloaded or unavailable'
    };
  }

  /**
   * Analyze a single video chunk
   */
  async analyzeVideoChunk(
    youtubeUrl: string,
    videoInfo: any,
    chunk: VideoChunk,
    prompt: Prompt,
    forceModel?: string,
  ): Promise<ChunkAnalysisResult> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `🔍 Analyzing chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks} (${Math.round(chunk.startTime / 60)}:${String(chunk.startTime % 60).padStart(2, '0')} - ${Math.round(chunk.endTime / 60)}:${String(chunk.endTime % 60).padStart(2, '0')})`,
      );

      const basePrompt = this.constructPrompt(
        prompt.promptTemplate,
        videoInfo,
        chunk,
      );

      let lastError: Error | null = null;
      let model: string = '';
      let isOverloadedError = false;
      let overloadRetryCount = 0;

      // Calculate accurate token estimation based on official Gemini API documentation (outside retry loop)
      const textPromptTokens = this.quotaManager.estimateTokenCount(basePrompt);
      const videoTokens = this.calculateVideoTokens(chunk.duration);
      const estimatedTokens = textPromptTokens + videoTokens;

      // Enhanced retry logic with model switching for overloaded errors
      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          // Prepare the end offset for video segmentation (Google API expects seconds format)
          const endOffsetSeconds = Math.round(chunk.endTime);
          const endOffset = `${endOffsetSeconds}s`; // Must end with 's' for Google API

          // Use forced model or find the best available model for this request
          if (forceModel && attempt === 1) {
            model = forceModel;
            this.logger.log(`🎯 Using forced model: ${model}`);

            // Validate that the forced model is available for this tier
            const availableModels = this.quotaManager.getAvailableModels();
            if (!availableModels.includes(model as any)) {
              throw new Error(
                `Forced model ${model} is not available for current tier`,
              );
            }

            // Check if we can make the request with this model
            const quotaCheck = this.quotaManager.canMakeRequest(
              model,
              estimatedTokens,
            );
            if (!quotaCheck.allowed) {
              throw new Error(
                `Cannot use forced model ${model}: ${quotaCheck.reason}`,
              );
            }
          } else {
            // For retries after overload, exclude the previously failed model
            const excludeModels = isOverloadedError && lastError ? [model] : [];
            
            const modelSelection =
              await this.quotaManager.findBestAvailableModel(
                estimatedTokens,
                excludeModels
              );

            if (!modelSelection.model) {
              throw new Error(
                `No available models for analysis: ${modelSelection.reason}`,
              );
            }

            model = modelSelection.model;
          }
          const quotaLimits = this.quotaManager.getQuotaLimits(model);

          this.logger.log(
            `🚀 Analysis attempt ${attempt}/${this.MAX_RETRIES} for chunk ${chunk.chunkIndex + 1} using ${model}`,
          );
          this.logger.log(
            `📊 Token breakdown: ${textPromptTokens} (text) + ${videoTokens} (video ~${chunk.duration}s) = ${estimatedTokens} total. Max allowed: ${quotaLimits.maxTokensPerRequest}`,
          );

          const config = {
            responseMimeType: 'application/json', // Required for structured output
            responseSchema: VideoAnalysisResponseSchema, // Official structured output schema
            temperature: 0.1, // Low temperature for consistency
          };

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
                    endOffset: endOffset,
                    ...this.getOptimizedVideoSettings(),
                  },
                },
                {
                  text: basePrompt,
                },
              ],
            },
          ];

          this.logger.log(`📹 Analyzing video segment: 0s - ${endOffset}`);

          // Use streaming to handle large responses efficiently
          const response = await this.genAI.models.generateContentStream({
            model,
            config,
            contents,
          });

          let analysisText = '';
          let chunkCount = 0;

          // Process streaming response with memory management
          for await (const streamChunk of response) {
            if (streamChunk.text) {
              analysisText += streamChunk.text;
              chunkCount++;

              // Log every 10 chunks to avoid log spam
              if (chunkCount % 10 === 0) {
                this.logger.log(
                  `📄 Received ${chunkCount} response chunks (${analysisText.length} chars)`,
                );
              }
            }
          }

          this.logger.log(
            `📄 Final response: ${analysisText.length} chars from ${chunkCount} chunks`,
          );

          // With structured output, response should already be valid JSON
          let analysis: VideoAnalysisResponse;
          try {
            analysis = JSON.parse(analysisText) as VideoAnalysisResponse;
            this.logger.log(
              `✅ Structured output successfully received for chunk ${chunk.chunkIndex + 1}`,
            );

            // Validate that we received the expected structure
            if (
              !analysis.metadata ||
              !analysis.stance_and_thesis ||
              !analysis.classification
            ) {
              throw new Error(
                'Response missing required structured output fields',
              );
            }
          } catch (parseError) {
            this.logger.error(
              `❌ Structured output parsing failed for chunk ${chunk.chunkIndex + 1}: ${parseError.message}`,
            );
            this.logger.warn(
              `Response content: ${analysisText.substring(0, 500)}...`,
            );
            throw new Error(
              `Structured output parsing failed: ${parseError.message}`,
            );
          }

          const processingTime = Date.now() - startTime;
          this.logger.log(
            `✅ Successfully analyzed chunk ${chunk.chunkIndex + 1} in ${processingTime}ms`,
          );

          // Record quota usage for successful request
          const actualTokens =
            this.quotaManager.estimateTokenCount(analysisText) +
            estimatedTokens;
          this.quotaManager.recordRequest(model, actualTokens);

          const { usage, limits } = this.quotaManager.getUsageStats(model);
          this.logger.log(
            `📊 Quota usage: ${usage.requestsInCurrentMinute}/${limits.rpm} RPM, ${usage.tokensInCurrentMinute}/${limits.tpm} TPM`,
          );

          // Clear variables to help with garbage collection
          analysisText = null;

          // Create and save the chunk result to database
          const chunkResult = {
            chunk, // Return the VideoChunk object (not chunkAnalysis string)
            analysis,
            processingTime,
            success: true,
            modelUsed: model,
            isModelOverloaded: false,
          };

          return chunkResult;
        } catch (error) {
          lastError = error;
          isOverloadedError = this.isModelOverloadedError(error);

          // Handle different types of errors with appropriate strategies
          if (isOverloadedError) {
            overloadRetryCount++;
            this.logger.error(
              `📊 Model overload error for ${model}: ${error.message}`,
            );
            
                         // Try to switch to a different model for overload errors
             if (overloadRetryCount <= this.MAX_OVERLOAD_RETRIES) {
               const alternativeModel = await this.handleModelOverload(
                 model,
                 estimatedTokens,
                 overloadRetryCount
               );
              
              if (alternativeModel.model) {
                this.logger.log(
                  `🔄 Retrying with alternative model: ${alternativeModel.model}`
                );
                // Use longer delay for overload errors
                await new Promise((resolve) =>
                  setTimeout(resolve, this.OVERLOAD_RETRY_DELAY)
                );
                continue; // Retry with new model
              }
            }
          } else if (
            // Handle quota violation errors (429 status code)
            error.status === 429 ||
            error.code === 429 ||
            (error.message && error.message.includes('quota')) ||
            (error.error && error.error.code === 429)
          ) {
            // Record the quota violation for tracking
            this.quotaManager.recordQuotaViolation(model || 'unknown', error);
            this.logger.error(
              `📊 Quota violation for ${model}: ${error.message}`,
            );
          }

          this.logger.warn(
            `⚠️ Attempt ${attempt} failed for chunk ${chunk.chunkIndex + 1}: ${error.message}`,
          );

          if (attempt < this.MAX_RETRIES) {
            const delay = isOverloadedError 
              ? this.OVERLOAD_RETRY_DELAY 
              : this.RETRY_DELAY * attempt;
            
            this.logger.log(
              `⏳ Waiting ${delay}ms before retry...`,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, delay),
            );
          }
        }
      }

      // All retries failed
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `❌ Failed to analyze chunk ${chunk.chunkIndex + 1} after ${this.MAX_RETRIES} attempts`,
      );

      return {
        chunk,
        analysis: null,
        processingTime,
        success: false,
        error: lastError?.message || 'Unknown error',
        isModelOverloaded: isOverloadedError,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `❌ Error analyzing chunk ${chunk.chunkIndex + 1}: ${error.message}`,
      );

      return {
        chunk,
        analysis: null,
        processingTime,
        success: false,
        error: error.message,
        isModelOverloaded: this.isModelOverloadedError(error),
      };
    }
  }

  /**
   * Save chunk analysis result to database
   */
  private async saveChunkToDatabase(
    contentId: Types.ObjectId | string,
    chunkResult: ChunkAnalysisResult,
    prompt: Prompt,
  ): Promise<VideoChunkModel> {
    try {
      const chunkData = {
        contentId: new Types.ObjectId(contentId),
        chunkIndex: chunkResult.chunk.chunkIndex,
        startTime: chunkResult.chunk.startTime,
        endTime: chunkResult.chunk.endTime,
        duration: chunkResult.chunk.duration,
        status: chunkResult.success ? 'ANALYZED' : (chunkResult.isModelOverloaded ? 'OVERLOADED' : 'FAILED'),
        analysisResult: chunkResult.success ? chunkResult.analysis : undefined,
        modelUsed: chunkResult.modelUsed,
        processingTime: chunkResult.processingTime,
        error: chunkResult.error,
        promptIdUsed: prompt._id,
        promptVersionUsed: prompt.version,
      };

      const savedChunk = await this.videoChunkModel.create(chunkData);
      this.logger.log(
        `💾 Saved chunk ${chunkResult.chunk.chunkIndex + 1} to database with status: ${chunkData.status}`,
      );
      return savedChunk;
    } catch (error) {
      this.logger.error(
        `❌ Failed to save chunk ${chunkResult.chunk.chunkIndex + 1} to database: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Combine analysis results from chunks stored in database using Gemini AI
   */
  async combineChunkAnalysesUsingAI(
    contentId: Types.ObjectId | string,
    videoInfo: any,
    forceModel?: string,
  ): Promise<VideoAnalysisResponse> {
    this.logger.log(`🤖 Starting AI-powered combination of chunk analyses for content: ${contentId}`);
    
    try {
      // 1. Fetch all successful chunk analyses from database
      const chunks = await this.videoChunkModel
        .find({
          contentId: new Types.ObjectId(contentId),
          status: 'ANALYZED',
          analysisResult: { $exists: true, $ne: null },
        })
        .sort({ chunkIndex: 1 })
        .exec();

      if (chunks.length === 0) {
        throw new Error('No successful chunk analyses found in database');
      }

      this.logger.log(`📊 Found ${chunks.length} successful chunk analyses to combine`);

      // 2. Get combination prompt from database
      const combinerPrompt = await this.promptModel
        .findOne({ promptName: 'Chunk Analysis Combiner' })
        .sort({ version: -1 })
        .exec();

      if (!combinerPrompt) {
        throw new Error('Chunk Analysis Combiner prompt not found in database');
      }

      this.logger.log(`✅ Using combiner prompt: "${combinerPrompt.promptName}" (v${combinerPrompt.version})`);

      // 3. Prepare chunk analyses data for the AI prompt
      const chunkAnalysesJson = chunks.map((chunk, index) => ({
        chunkIndex: chunk.chunkIndex,
        timeRange: `${Math.round(chunk.startTime / 60)}:${String(chunk.startTime % 60).padStart(2, '0')} - ${Math.round(chunk.endTime / 60)}:${String(chunk.endTime % 60).padStart(2, '0')}`,
        analysis: chunk.analysisResult,
        modelUsed: chunk.modelUsed,
      }));

      // 4. Construct the combination prompt
      const combinationPrompt = this.constructCombinationPrompt(
        combinerPrompt.promptTemplate,
        chunkAnalysesJson,
        videoInfo,
        chunks.length,
      );

      // 5. Select model for combination task
      const textPromptTokens = this.quotaManager.estimateTokenCount(combinationPrompt);
      // Combination doesn't include video processing, so only text tokens
      const estimatedTokens = textPromptTokens;

      let model: string = '';
      if (forceModel) {
        model = forceModel;
        this.logger.log(`🎯 Using forced model for combination: ${model}`);
      } else {
        const modelSelection = await this.quotaManager.findBestAvailableModel(estimatedTokens);
        if (!modelSelection.model) {
          throw new Error(`No available models for combination: ${modelSelection.reason}`);
        }
        model = modelSelection.model;
      }

      this.logger.log(`🚀 Combining analyses using ${model} with ${estimatedTokens} estimated tokens`);

      // 6. Call Gemini API to combine the analyses
      const config = {
        responseMimeType: 'application/json',
        responseSchema: VideoAnalysisResponseSchema,
        temperature: 0.1,
      };

      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: combinationPrompt,
            },
          ],
        },
      ];

      const response = await this.genAI.models.generateContentStream({
        model,
        config,
        contents,
      });

      let combinedAnalysisText = '';
      let chunkCount = 0;

      for await (const streamChunk of response) {
        if (streamChunk.text) {
          combinedAnalysisText += streamChunk.text;
          chunkCount++;

          if (chunkCount % 10 === 0) {
            this.logger.log(`📄 Received ${chunkCount} response chunks for combination`);
          }
        }
      }

      this.logger.log(`📄 Final combination response: ${combinedAnalysisText.length} chars from ${chunkCount} chunks`);

      // 7. Parse and validate the combined result
      let combinedAnalysis: VideoAnalysisResponse;
      try {
        combinedAnalysis = JSON.parse(combinedAnalysisText) as VideoAnalysisResponse;
        this.logger.log(`✅ AI successfully combined ${chunks.length} chunk analyses`);

        // Validate structure
        if (!combinedAnalysis.metadata || !combinedAnalysis.stance_and_thesis || !combinedAnalysis.classification) {
          throw new Error('Combined response missing required structured output fields');
        }
      } catch (parseError) {
        this.logger.error(`❌ AI combination parsing failed: ${parseError.message}`);
        this.logger.warn(`Response content: ${combinedAnalysisText.substring(0, 500)}...`);
        throw new Error(`AI combination parsing failed: ${parseError.message}`);
      }

      // 8. Record quota usage
      const actualTokens = this.quotaManager.estimateTokenCount(combinedAnalysisText) + estimatedTokens;
      this.quotaManager.recordRequest(model, actualTokens);

      this.logger.log(`🎉 AI-powered combination completed successfully using ${model}`);
      
      return combinedAnalysis;
    } catch (error) {
      this.logger.error(`❌ AI-powered combination failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Construct prompt for AI-powered combination
   */
  private constructCombinationPrompt(
    template: string,
    chunkAnalyses: any[],
    videoInfo: any,
    totalChunks: number,
  ): string {
    let populatedPrompt = template;

    // Format chunk analyses as JSON string for the prompt
    const chunkAnalysesText = JSON.stringify(chunkAnalyses, null, 2);

    const replacements = {
      '{{chunk_analyses}}': chunkAnalysesText,
      '{{video.title}}': videoInfo.title || 'Unknown',
      '{{video.channel}}': videoInfo.channel || 'Unknown',
      '{{video.duration}}': Math.round((videoInfo.duration || 0) / 60),
      '{{chunk.total}}': totalChunks,
    };

    // Replace placeholders with actual values
    for (const [placeholder, value] of Object.entries(replacements)) {
      if (value !== null && value !== undefined) {
        populatedPrompt = populatedPrompt.replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          String(value),
        );
      }
    }

    return populatedPrompt;
  }

  /**
   * Get most common value from an array
   */
  private getMostCommon<T>(arr: T[]): T | null {
    if (arr.length === 0) return null;

    const frequency: { [key: string]: number } = {};
    arr.forEach((item) => {
      const key = String(item);
      frequency[key] = (frequency[key] || 0) + 1;
    });

    let maxCount = 0;
    let mostCommon: T | null = null;

    Object.entries(frequency).forEach(([key, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = arr.find((item) => String(item) === key) || null;
      }
    });

    return mostCommon;
  }

  /**
   * Fetch and return video metadata without analysis
   */
  async fetchVideoMetadata(
    youtubeUrl: string,
  ): Promise<{ videoId: string; metadata: any }> {
    this.logger.log(`📋 Fetching metadata for YouTube video: ${youtubeUrl}`);

    try {
      const { videoId, info, duration } =
        await this.validateAndGetVideoInfo(youtubeUrl);

      const metadata = {
        duration,
        viewCount: parseInt(info.view_count || '0'),
        channel: info.channel,
        thumbnailUrl: info.thumbnail,
        webpageUrl: info.webpage_url,
        fetchedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      this.logger.log(
        `✅ Successfully fetched metadata for video: ${info.title}`,
      );
      this.logger.log(
        `   ⏱️ Duration: ${Math.round(duration / 60)}m ${duration % 60}s`,
      );
      this.logger.log(`   👀 Views: ${metadata.viewCount.toLocaleString()}`);
      this.logger.log(`   👤 Channel: ${metadata.channel}`);

      return { videoId, metadata };
    } catch (error) {
      this.logger.error(`❌ Failed to fetch video metadata: ${error.message}`);
      throw error;
    }
  }

  /**
   * Main method to analyze a YouTube video with chunking (requires metadata to be already fetched)
   */
  async analyzeYouTubeVideo(
    youtubeUrl: string,
    contentId: Types.ObjectId | string,
    existingMetadata?: any,
    forceModel?: string,
  ): Promise<any> {
    this.logger.log(
      `🎬 Starting comprehensive analysis of YouTube video: ${youtubeUrl}`,
    );
    const overallStartTime = Date.now();

    try {
      // 1. Fetch the default prompt from the database
      this.logger.log('📋 Fetching analysis prompt from database...');
      const prompt = await this.promptModel
        .findOne({ isDefault: true })
        .sort({ version: -1 })
        .exec();
      if (!prompt) {
        throw new Error('No default prompt found in the database.');
      }
      this.logger.log(
        `✅ Using prompt: "${prompt.promptName}" (v${prompt.version})`,
      );

      // Ensure we're using a structured output compatible prompt (v2+)
      if (prompt.version < 2) {
        this.logger.warn(
          `⚠️ Prompt version ${prompt.version} may not be optimized for structured output. Consider running: npm run update-prompt`,
        );
      }

      // 2. Get video info (either from existing metadata or fetch fresh)
      let info, duration;
      if (existingMetadata) {
        this.logger.log(`📋 Using existing metadata from database`);
        info = {
          title: 'Video', // Title should be in content.title
          description: '',
          duration: existingMetadata.duration,
          channel: existingMetadata.channel,
          view_count: existingMetadata.viewCount,
          upload_date: null,
          thumbnail: existingMetadata.thumbnailUrl,
          webpage_url: existingMetadata.webpageUrl,
        };
        duration = existingMetadata.duration;
      } else {
        this.logger.log(`📋 Fetching fresh video info from YouTube API`);
        const result = await this.validateAndGetVideoInfo(youtubeUrl);
        info = result.info;
        duration = result.duration;
      }

      // 3. Calculate chunks
      const chunks = this.calculateVideoChunks(duration);

      // Log optimization recommendations
      this.logOptimizationRecommendations(duration, info.title);

      // 4. Analyze each chunk and save to database
      this.logger.log(`🔄 Starting analysis of ${chunks.length} chunk(s)...`);
      const chunkResults: ChunkAnalysisResult[] = [];

      for (const chunk of chunks) {
        const result = await this.analyzeVideoChunk(
          youtubeUrl,
          info,
          chunk,
          prompt,
          forceModel,
        );
        chunkResults.push(result);

        // Save chunk result to database
        try {
          await this.saveChunkToDatabase(contentId, result, prompt);
        } catch (saveError) {
          this.logger.error(`⚠️ Failed to save chunk ${chunk.chunkIndex + 1} to database: ${saveError.message}`);
          // Continue processing even if database save fails
        }

        if (result.success) {
          this.logger.log(
            `✅ Chunk ${chunk.chunkIndex + 1}/${chunks.length} completed successfully`,
          );
        } else {
          this.logger.error(
            `❌ Chunk ${chunk.chunkIndex + 1}/${chunks.length} failed: ${result.error}`,
          );
        }
      }

      // 5. Combine results using AI
      this.logger.log('🤖 Combining chunk analyses using AI...');
      const combinedResult = await this.combineChunkAnalysesUsingAI(contentId, info, forceModel);

      const totalProcessingTime = Date.now() - overallStartTime;
      const successfulChunks = chunkResults.filter((r) => r.success).length;

      this.logger.log(`🎉 Analysis completed successfully!`);
      this.logger.log(`   📊 Total processing time: ${totalProcessingTime}ms`);
      this.logger.log(
        `   ✅ Successful chunks: ${successfulChunks}/${chunks.length}`,
      );
      this.logger.log(`   📝 Video: ${info.title}`);

      // Determine the primary model used (most successful chunks)
      const modelUsageCount: Record<string, number> = {};
      chunkResults.forEach((result) => {
        if (result.success && result.modelUsed) {
          modelUsageCount[result.modelUsed] =
            (modelUsageCount[result.modelUsed] || 0) + 1;
        }
      });

      let primaryModel = '';
      let maxCount = 0;
      for (const [model, count] of Object.entries(modelUsageCount)) {
        if (count > maxCount) {
          maxCount = count;
          primaryModel = model;
        }
      }

      // Return both the result and the prompt info
      return {
        analysis: combinedResult,
        prompt: {
          _id: prompt._id,
          promptName: prompt.promptName,
          version: prompt.version,
        },
        modelUsed: primaryModel,
        modelUsageStats: modelUsageCount,
      };
    } catch (error) {
      const totalProcessingTime = Date.now() - overallStartTime;
      this.logger.error(
        `❌ Video analysis failed after ${totalProcessingTime}ms: ${error.message}`,
      );
      throw error;
    }
  }

  private constructPrompt(
    template: string,
    videoInfo: any,
    chunk: VideoChunk,
  ): string {
    let populatedPrompt = template;

    const replacements = {
      '{{video.title}}': videoInfo.title,
      '{{video.description}}': videoInfo.description,
      '{{video.channel}}': videoInfo.channel,
      '{{video.duration}}': Math.round(videoInfo.duration / 60),
      '{{chunk.index}}': chunk.chunkIndex + 1,
      '{{chunk.total}}': chunk.totalChunks,
      '{{chunk.startTime}}': `${Math.round(chunk.startTime / 60)}:${String(chunk.startTime % 60).padStart(2, '0')}`,
      '{{chunk.endTime}}': `${Math.round(chunk.endTime / 60)}:${String(chunk.endTime % 60).padStart(2, '0')}`,
      '{{chunk.duration}}': Math.round(chunk.duration / 60),
    };

    // Replace placeholders with actual values
    for (const [placeholder, value] of Object.entries(replacements)) {
      if (value !== null && value !== undefined) {
        populatedPrompt = populatedPrompt.replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          String(value),
        );
      }
    }

    return populatedPrompt;
  }
}
