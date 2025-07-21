import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { Prompt } from '../schemas/prompt.schema';
import { GoogleGenAI } from '@google/genai';

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
  private readonly MAX_CHUNK_DURATION = 30 * 60; // 10 minutes per chunk
  private readonly OVERLAP_DURATION = 30; // 30 seconds overlap between chunks
  private readonly MAX_RETRIES = 1;
  private readonly RETRY_DELAY = 2000; // 2 seconds

  constructor(
    private configService: ConfigService,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
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
    // this.model = this.genAI.getGenerativeModel({ 
    //   model: "gemini-2.5-flash",
    //   generationConfig: {
    //     temperature: 0.1, // Low temperature for consistent analysis
    //     topP: 0.8,
    //     topK: 40,
    //     maxOutputTokens: 8192, // Increased for more detailed analysis
    //   },
    // });

    // Initialize YouTube API if key is available
    if (youtubeApiKey) {
      this.youtube = google.youtube({
        version: 'v3',
        auth: youtubeApiKey, 
      });
      this.logger.log('✅ YouTube Data API initialized');
    } else {
      this.logger.warn('⚠️ YouTube Data API key not provided - fallback will be limited');
    }
    
    this.logger.log('✅ VideoAnalysisService initialized successfully');
  }

  /**
   * Extract YouTube video ID from URL
   */
  private extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
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
  async validateAndGetVideoInfo(youtubeUrl: string): Promise<{ videoId: string; info: any; duration: number }> {
    const videoId = this.extractVideoId(youtubeUrl);
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    this.logger.log(`🔍 Fetching video info for: ${youtubeUrl}`);
    this.logger.log(`📹 Video ID: ${videoId}`);

    if (!this.youtube) {
      throw new Error('YouTube Data API is not available - YOUTUBE_API_KEY required');
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

      this.logger.log(`✅ Successfully retrieved video info via YouTube Data API:`);
      this.logger.log(`   📝 Title: ${title}`);
      this.logger.log(`   👤 Channel: ${channel}`);
      this.logger.log(`   ⏱️ Duration: ${Math.round(duration / 60)}m ${duration % 60}s`);
      this.logger.log(`   👀 View count: ${videoData.statistics.viewCount || 'N/A'}`);
      this.logger.log(`   📅 Published: ${videoData.snippet.publishedAt}`);

      const info = {
        title,
        description,
        duration,
        channel,
        view_count: videoData.statistics.viewCount,
        upload_date: videoData.snippet.publishedAt,
        thumbnail: videoData.snippet.thumbnails?.maxres?.url || videoData.snippet.thumbnails?.high?.url,
        webpage_url: youtubeUrl,
      };

      return { videoId, info, duration };

    } catch (apiError) {
      this.logger.error(`❌ YouTube Data API failed: ${apiError.message}`);
      throw new Error(`Unable to retrieve video information: ${apiError.message}`);
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
      this.logger.log(`📊 Video duration (${Math.round(duration / 60)}m) fits in single chunk`);
      return [{
        startTime: 0,
        endTime: duration,
        duration: duration,
        chunkIndex: 0,
        totalChunks: 1
      }];
    }

    const chunks: VideoChunk[] = [];
    let currentStart = 0;
    let chunkIndex = 0;
    const maxPossibleChunks = Math.ceil(duration / (this.MAX_CHUNK_DURATION * 0.5)) + 2; // Safety limit

    this.logger.log(`📊 Chunking ${Math.round(duration / 60)}m video (max ${this.MAX_CHUNK_DURATION / 60}m per chunk)`);

    while (currentStart < duration && chunkIndex < maxPossibleChunks) {
      let currentEnd = Math.min(currentStart + this.MAX_CHUNK_DURATION, duration);
      
      // For the last chunk, merge if it's too small
      if (duration - currentEnd < this.MAX_CHUNK_DURATION * 0.3 && currentEnd < duration) {
        currentEnd = duration;
      }

      chunks.push({
        startTime: currentStart,
        endTime: currentEnd,
        duration: currentEnd - currentStart,
        chunkIndex: chunkIndex,
        totalChunks: 0 // Will be set after all chunks are calculated
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
        currentStart = currentStart + (this.MAX_CHUNK_DURATION * 0.8); // Force 80% progress
      } else {
        currentStart = nextStart;
      }
    }

    // Safety check
    if (chunkIndex >= maxPossibleChunks) {
      this.logger.error(`❌ Chunking safety limit reached! Generated ${chunks.length} chunks`);
    }

    // Set total chunks for all
    chunks.forEach(chunk => chunk.totalChunks = chunks.length);

    this.logger.log(`📊 Video split into ${chunks.length} chunks (${this.OVERLAP_DURATION}s overlap)`);
    chunks.forEach((chunk, index) => {
      this.logger.log(`   📦 Chunk ${index + 1}: ${Math.round(chunk.startTime / 60)}:${String(chunk.startTime % 60).padStart(2, '0')} - ${Math.round(chunk.endTime / 60)}:${String(chunk.endTime % 60).padStart(2, '0')} (${Math.round(chunk.duration / 60)}m${Math.round(chunk.duration % 60)}s)`);
    });

    return chunks;
  }

  /**
   * Analyze a single video chunk
   */
  async analyzeVideoChunk(
    youtubeUrl: string,
    videoInfo: any,
    chunk: VideoChunk,
    prompt: Prompt,
  ): Promise<ChunkAnalysisResult> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`🔍 Analyzing chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks} (${Math.round(chunk.startTime / 60)}:${String(chunk.startTime % 60).padStart(2, '0')} - ${Math.round(chunk.endTime / 60)}:${String(chunk.endTime % 60).padStart(2, '0')})`);

      const basePrompt = this.constructPrompt(prompt.promptTemplate, videoInfo, chunk);

      let lastError: Error | null = null;
       
      // Retry logic with memory optimization
      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          this.logger.log(`🚀 Analysis attempt ${attempt}/${this.MAX_RETRIES} for chunk ${chunk.chunkIndex + 1} using Gemini 2.5 Flash`);

          // Prepare the end offset for video segmentation (Google API expects seconds format)
          const endOffsetSeconds = Math.round(chunk.endTime);
          const endOffset = `${endOffsetSeconds}s`; // Must end with 's' for Google API

          // Configure the model and request
          const model = 'gemini-2.5-flash';
          const config = {
            responseMimeType: 'application/json', // Force JSON response
            temperature: 0.1, // Low temperature for consistency
            // maxOutputTokens: 4096, // Limit tokens to prevent memory issues
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
                  }
                },
                {
                  text: basePrompt
                }
              ]
            }
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
                this.logger.log(`📄 Received ${chunkCount} response chunks (${analysisText.length} chars)`);
              }

              // Memory safety: limit response size
              if (analysisText.length > 50000) { // 50KB limit
                this.logger.warn(`⚠️ Response too large, truncating at ${analysisText.length} chars`);
                break;
              }
            }
          }

          this.logger.log(`📄 Final response: ${analysisText.length} chars from ${chunkCount} chunks`);

          // Parse JSON response
          let analysis;
          try {
            // Try to parse the full response as JSON
            analysis = JSON.parse(analysisText);
            this.logger.log(`✅ Successfully parsed JSON response for chunk ${chunk.chunkIndex + 1}`);
          } catch (parseError) {
            this.logger.warn(`⚠️ Initial JSON parse failed, attempting to extract JSON...`);
            
            // Try to extract JSON from response if it's wrapped in text/markdown
            const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                analysis = JSON.parse(jsonMatch[0]);
                this.logger.log(`✅ Successfully extracted and parsed JSON for chunk ${chunk.chunkIndex + 1}`);
              } catch (extractError) {
                throw new Error(`Failed to parse extracted JSON: ${extractError.message}`);
              }
            } else {
              // If no JSON found, return the raw text as analysis
              this.logger.warn(`⚠️ No JSON found, using raw text response`);
              analysis = { rawResponse: analysisText };
            }
          }

          const processingTime = Date.now() - startTime;
          this.logger.log(`✅ Successfully analyzed chunk ${chunk.chunkIndex + 1} in ${processingTime}ms`);

          // Clear variables to help with garbage collection
          analysisText = null;

          return {
            chunk, // Return the VideoChunk object (not chunkAnalysis string)
            analysis,
            processingTime,
            success: true,
          };

        } catch (error) {
          lastError = error;
          this.logger.warn(`⚠️ Attempt ${attempt} failed for chunk ${chunk.chunkIndex + 1}: ${error.message}`);
          
          if (attempt < this.MAX_RETRIES) {
            this.logger.log(`⏳ Waiting ${this.RETRY_DELAY * attempt}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * attempt));
          }
        }
      }

      // All retries failed
      const processingTime = Date.now() - startTime;
      this.logger.error(`❌ Failed to analyze chunk ${chunk.chunkIndex + 1} after ${this.MAX_RETRIES} attempts`);

      return {
        chunk,
        analysis: null,
        processingTime,
        success: false,
        error: lastError?.message || 'Unknown error',
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`❌ Error analyzing chunk ${chunk.chunkIndex + 1}: ${error.message}`);

      return {
        chunk,
        analysis: null,
        processingTime,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Combine analysis results from multiple chunks
   */
  combineChunkAnalyses(chunkResults: ChunkAnalysisResult[], videoInfo: any): CombinedAnalysisResult {
    const successfulResults = chunkResults.filter(r => r.success);
    const failedResults = chunkResults.filter(r => !r.success);

    if (successfulResults.length === 0) {
      throw new Error('No chunks were successfully analyzed');
    }

    this.logger.log(`Combining ${successfulResults.length} successful analyses (${failedResults.length} failed)`);

    // Initialize combined result structure
    const combined: CombinedAnalysisResult = {
      metadata: {
        primary_language: '',
        hosts_or_speakers: [],
        video_duration: Math.round(videoInfo.duration || 0),
        total_chunks: chunkResults.length,
        processing_summary: {
          successful_chunks: successfulResults.length,
          failed_chunks: failedResults.length,
          total_processing_time: chunkResults.reduce((sum, r) => sum + r.processingTime, 0),
        },
      },
      stance_and_thesis: {
        russo_ukrainian_war_stance: 'Not Applicable',
        main_thesis: '',
        key_messages: [],
      },
      narrative_analysis: {
        primary_narrative_frame: '',
        secondary_narrative_frames: [],
        narrative_characters: {
          heroes: [],
          villains: [],
          victims: [],
        },
        plot_summary: '',
      },
      rhetorical_and_emotional_analysis: {
        speaker_tone_and_style: '',
        emotional_appeals: [],
        rhetorical_devices_and_fallacies: '',
        loaded_language_and_keywords: [],
        call_to_action: {
          cta_type: 'None',
          cta_text: '',
        },
      },
      visual_analysis: {
        editing_style_and_pacing: '',
        on_screen_elements: '',
        speaker_non_verbal_cues: '',
      },
      source_and_evidence_analysis: {
        unverifiable_claims: [],
        source_integrity: '',
      },
      entity_and_topic_indexing: {
        named_entities: [],
        key_concepts_and_themes: [],
      },
      classification: {
        is_manipulative: {
          decision: 'false',
          confidence: 0.5,
          reasoning: '',
        },
        is_disinformation: {
          decision: 'false',
          confidence: 0.5,
          reasoning: '',
        },
      },
    };

    // Combine metadata
    const languages = new Set<string>();
    const speakers = new Set<string>();

    successfulResults.forEach(result => {
      if (result.analysis.metadata?.primary_language) {
        languages.add(result.analysis.metadata.primary_language);
      }
      if (result.analysis.metadata?.hosts_or_speakers) {
        result.analysis.metadata.hosts_or_speakers.forEach((speaker: string) => speakers.add(speaker));
      }
    });

    combined.metadata.primary_language = Array.from(languages)[0] || '';
    combined.metadata.hosts_or_speakers = Array.from(speakers);

    // Combine stance and thesis (use most common or first non-empty)
    const stances = successfulResults.map(r => r.analysis.stance_and_thesis?.russo_ukrainian_war_stance).filter(Boolean);
    combined.stance_and_thesis.russo_ukrainian_war_stance = this.getMostCommon(stances) || 'Not Applicable';

    const theses = successfulResults.map(r => r.analysis.stance_and_thesis?.main_thesis).filter(Boolean);
    combined.stance_and_thesis.main_thesis = theses[0] || '';

    // Combine key messages
    const allKeyMessages = new Set<string>();
    successfulResults.forEach(result => {
      if (result.analysis.stance_and_thesis?.key_messages) {
        result.analysis.stance_and_thesis.key_messages.forEach((msg: string) => allKeyMessages.add(msg));
      }
    });
    combined.stance_and_thesis.key_messages = Array.from(allKeyMessages);

    // Combine narrative analysis
    const narrativeFrames = successfulResults.map(r => r.analysis.narrative_analysis?.primary_narrative_frame).filter(Boolean);
    combined.narrative_analysis.primary_narrative_frame = this.getMostCommon(narrativeFrames) || '';

    const allSecondaryFrames = new Set<string>();
    successfulResults.forEach(result => {
      if (result.analysis.narrative_analysis?.secondary_narrative_frames) {
        result.analysis.narrative_analysis.secondary_narrative_frames.forEach((frame: string) => allSecondaryFrames.add(frame));
      }
    });
    combined.narrative_analysis.secondary_narrative_frames = Array.from(allSecondaryFrames);

    // Combine characters
    const allHeroes = new Set<string>();
    const allVillains = new Set<string>();
    const allVictims = new Set<string>();

    successfulResults.forEach(result => {
      if (result.analysis.narrative_analysis?.narrative_characters) {
        const chars = result.analysis.narrative_analysis.narrative_characters;
        chars.heroes?.forEach((hero: string) => allHeroes.add(hero));
        chars.villains?.forEach((villain: string) => allVillains.add(villain));
        chars.victims?.forEach((victim: string) => allVictims.add(victim));
      }
    });

    combined.narrative_analysis.narrative_characters = {
      heroes: Array.from(allHeroes),
      villains: Array.from(allVillains),
      victims: Array.from(allVictims),
    };

    // Combine plot summaries
    const plotSummaries = successfulResults.map(r => r.analysis.narrative_analysis?.plot_summary).filter(Boolean);
    combined.narrative_analysis.plot_summary = plotSummaries.join(' ') || '';

    // Combine rhetorical analysis
    const tones = successfulResults.map(r => r.analysis.rhetorical_and_emotional_analysis?.speaker_tone_and_style).filter(Boolean);
    combined.rhetorical_and_emotional_analysis.speaker_tone_and_style = tones[0] || '';

    const allEmotionalAppeals = new Set<string>();
    const allLoadedLanguage = new Set<string>();

    successfulResults.forEach(result => {
      if (result.analysis.rhetorical_and_emotional_analysis?.emotional_appeals) {
        result.analysis.rhetorical_and_emotional_analysis.emotional_appeals.forEach((appeal: string) => allEmotionalAppeals.add(appeal));
      }
      if (result.analysis.rhetorical_and_emotional_analysis?.loaded_language_and_keywords) {
        result.analysis.rhetorical_and_emotional_analysis.loaded_language_and_keywords.forEach((keyword: string) => allLoadedLanguage.add(keyword));
      }
    });

    combined.rhetorical_and_emotional_analysis.emotional_appeals = Array.from(allEmotionalAppeals);
    combined.rhetorical_and_emotional_analysis.loaded_language_and_keywords = Array.from(allLoadedLanguage);

    // Combine entities and topics
    const allEntities = new Set<string>();
    const allConcepts = new Set<string>();

    successfulResults.forEach(result => {
      if (result.analysis.entity_and_topic_indexing?.named_entities) {
        result.analysis.entity_and_topic_indexing.named_entities.forEach((entity: string) => allEntities.add(entity));
      }
      if (result.analysis.entity_and_topic_indexing?.key_concepts_and_themes) {
        result.analysis.entity_and_topic_indexing.key_concepts_and_themes.forEach((concept: string) => allConcepts.add(concept));
      }
    });

    combined.entity_and_topic_indexing.named_entities = Array.from(allEntities);
    combined.entity_and_topic_indexing.key_concepts_and_themes = Array.from(allConcepts);

    // Combine classifications (use highest confidence scores)
    const manipulativeAnalyses = successfulResults.map(r => r.analysis.classification?.is_manipulative).filter(Boolean);
    const disinformationAnalyses = successfulResults.map(r => r.analysis.classification?.is_disinformation).filter(Boolean);

    if (manipulativeAnalyses.length > 0) {
      const highestConfidenceManipulative = manipulativeAnalyses.reduce((max, current) => 
        current.confidence > max.confidence ? current : max
      );
      combined.classification.is_manipulative = highestConfidenceManipulative;
    }

    if (disinformationAnalyses.length > 0) {
      const highestConfidenceDisinfo = disinformationAnalyses.reduce((max, current) => 
        current.confidence > max.confidence ? current : max
      );
      combined.classification.is_disinformation = highestConfidenceDisinfo;
    }

    this.logger.log(`Successfully combined analysis from ${successfulResults.length} chunks`);
    return combined;
  }

  /**
   * Get most common value from an array
   */
  private getMostCommon<T>(arr: T[]): T | null {
    if (arr.length === 0) return null;
    
    const frequency: { [key: string]: number } = {};
    arr.forEach(item => {
      const key = String(item);
      frequency[key] = (frequency[key] || 0) + 1;
    });

    let maxCount = 0;
    let mostCommon: T | null = null;

    Object.entries(frequency).forEach(([key, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = arr.find(item => String(item) === key) || null;
      }
    });

    return mostCommon;
  }

  /**
   * Main method to analyze a YouTube video with chunking
   */
  async analyzeYouTubeVideo(youtubeUrl: string): Promise<any> {
    this.logger.log(`🎬 Starting comprehensive analysis of YouTube video: ${youtubeUrl}`);
    const overallStartTime = Date.now();

    try {
      // 1. Fetch the default prompt from the database
      this.logger.log('📋 Fetching analysis prompt from database...');
      const prompt = await this.promptModel.findOne({ isDefault: true }).sort({ version: -1 }).exec();
      if (!prompt) {
        throw new Error('No default prompt found in the database.');
      }
      this.logger.log(`✅ Using prompt: "${prompt.promptName}" (v${prompt.version})`);

      // 2. Validate and get video info
      const { info, duration } = await this.validateAndGetVideoInfo(youtubeUrl);

      // 3. Calculate chunks
      const chunks = this.calculateVideoChunks(duration);

      // 4. Analyze each chunk
      this.logger.log(`🔄 Starting analysis of ${chunks.length} chunk(s)...`);
      const chunkResults: ChunkAnalysisResult[] = [];
      
      for (const chunk of chunks) {
        const result = await this.analyzeVideoChunk(youtubeUrl, info, chunk, prompt);
        chunkResults.push(result);
        
        if (result.success) {
          this.logger.log(`✅ Chunk ${chunk.chunkIndex + 1}/${chunks.length} completed successfully`);
        } else {
          this.logger.error(`❌ Chunk ${chunk.chunkIndex + 1}/${chunks.length} failed: ${result.error}`);
        }
      }

      // 5. Combine results
      this.logger.log('🔗 Combining chunk analyses...');
      const combinedResult = this.combineChunkAnalyses(chunkResults, info);

      const totalProcessingTime = Date.now() - overallStartTime;
      const successfulChunks = chunkResults.filter(r => r.success).length;
      
      this.logger.log(`🎉 Analysis completed successfully!`);
      this.logger.log(`   📊 Total processing time: ${totalProcessingTime}ms`);
      this.logger.log(`   ✅ Successful chunks: ${successfulChunks}/${chunks.length}`);
      this.logger.log(`   📝 Video: ${info.title}`);

      // Return both the result and the prompt info
      return {
        analysis: combinedResult,
        prompt: {
          _id: prompt._id,
          promptName: prompt.promptName,
          version: prompt.version,
        },
      };

    } catch (error) {
      const totalProcessingTime = Date.now() - overallStartTime;
      this.logger.error(`❌ Video analysis failed after ${totalProcessingTime}ms: ${error.message}`);
      throw error;
    }
  }

  private constructPrompt(template: string, videoInfo: any, chunk: VideoChunk): string {
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
        populatedPrompt = populatedPrompt.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), String(value));
      }
    }

    return populatedPrompt;
  }
} 