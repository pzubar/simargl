import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel } from '../schemas/channel.schema';
import { Content } from '../schemas/content.schema';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

@Processor('channel-monitoring')
export class ChannelMonitoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ChannelMonitoringProcessor.name);
  private youtube;

  constructor(
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectQueue('video-discovery') private videoDiscoveryQueue: Queue,
    private configService: ConfigService,
  ) {
    super();
    const apiKey = this.configService.get<string>('YOUTUBE_API_KEY');
    if (!apiKey) {
      throw new Error('YOUTUBE_API_KEY is required');
    }
    this.youtube = google.youtube({
      version: 'v3',
      auth: apiKey,
    });
  }

  async process(job: Job<{ channelId: string }, any, string>): Promise<any> {
    this.logger.log(
      `🔍 Starting channel monitoring job ${job.id} with data: ${JSON.stringify(job.data)}`,
    );

    const channel = await this.channelModel.findById(job.data.channelId).exec();
    if (!channel) {
      this.logger.error(
        `❌ Channel with id ${job.data.channelId} not found in database`,
      );
      return;
    }

    this.logger.log(
      `📺 Monitoring channel: "${channel.name}" (${channel.sourceType})`,
    );
    this.logger.log(`🎯 Channel source ID: ${channel.sourceId}`);
    this.logger.log(
      `📊 Monitoring last ${job.data.fetchLastN || channel.fetchLastN} videos`,
    );

    if (channel.sourceType === 'YOUTUBE') {
      try {
        // Ensure we have the uploads playlist ID
        if (!channel.uploadsPlaylistId) {
          this.logger.log(
            `🔍 Uploads playlist ID not found, discovering for channel ${channel.sourceId}`,
          );
          await this.discoverAndSaveUploadsPlaylistId(channel);
          // Refresh channel data
          const updatedChannel = await this.channelModel
            .findById(channel._id)
            .exec();
          if (updatedChannel) {
            channel.uploadsPlaylistId = updatedChannel.uploadsPlaylistId;
          }
        }

        if (!channel.uploadsPlaylistId) {
          throw new Error(
            `Could not find uploads playlist for channel ${channel.sourceId}`,
          );
        }

        // Determine if this is initial bulk fetch or periodic monitoring
        const isInitialFetch = job.data.initialFetch || false;
        const maxResults = job.data.fetchLastN || channel.fetchLastN;

        let videosToFetch = maxResults;
        if (isInitialFetch) {
          // For initial fetch: either last 150 videos or all from 2025
          videosToFetch = 10;
          this.logger.log(
            `🚀 Performing initial bulk fetch of up to ${videosToFetch} videos`,
          );
        } else {
          this.logger.log(
            `🔄 Performing periodic monitoring of last ${videosToFetch} videos`,
          );
        }

        const videos = await this.fetchVideosFromPlaylist(
          channel.uploadsPlaylistId,
          videosToFetch,
          isInitialFetch,
        );

        this.logger.log(
          `📡 Retrieved ${videos.length} videos from uploads playlist`,
        );

        if (videos.length > 0) {
          let newVideosDiscovered = 0;
          let alreadyKnownVideos = 0;

          for (const video of videos) {
            const sourceContentId = video.contentDetails.videoId;
            this.logger.debug(
              `🔍 Processing video: ${sourceContentId} - "${video.snippet?.title}"`,
            );

            const existingContent = await this.contentModel
              .findOne({ sourceContentId })
              .exec();
            if (!existingContent) {
              this.logger.log(
                `🆕 New video discovered: ${sourceContentId} - "${video.snippet?.title}"`,
              );

              const newContent = new this.contentModel({
                sourceContentId,
                channelId: channel._id,
                title: video.snippet?.title || 'Untitled',
                description: video.snippet?.description || '',
                publishedAt: video.contentDetails?.videoPublishedAt
                  ? new Date(video.contentDetails.videoPublishedAt)
                  : video.snippet?.publishedAt
                    ? new Date(video.snippet.publishedAt)
                    : new Date(),
                status: 'DISCOVERED',
                discoveredAt: new Date(),
                data: {},
              });

              await newContent.save();

              // Queue video discovery processing
              await this.videoDiscoveryQueue.add(
                'discover-video',
                {
                  contentId: newContent._id.toString(),
                },
                {
                  attempts: 3,
                  backoff: {
                    type: 'exponential',
                    delay: 5000,
                  },
                  removeOnComplete: 10,
                  removeOnFail: 20,
                },
              );
              newVideosDiscovered++;
            } else {
              this.logger.debug(`⏭️ Video already known: ${sourceContentId}`);
              alreadyKnownVideos++;
            }
          }

          this.logger.log(
            `✅ Channel monitoring completed for ${channel.sourceId}:`,
          );
          this.logger.log(
            `   🆕 New videos discovered: ${newVideosDiscovered}`,
          );
          this.logger.log(`   📚 Already known videos: ${alreadyKnownVideos}`);
          this.logger.log(`   📊 Total videos checked: ${videos.length}`);

          return {
            channelId: channel._id.toString(),
            channelName: channel.name,
            newVideosDiscovered,
            alreadyKnownVideos,
            totalVideosChecked: videos.length,
            uploadsPlaylistId: channel.uploadsPlaylistId,
          };
        } else {
          this.logger.warn(
            `⚠️ No videos found in uploads playlist ${channel.uploadsPlaylistId}`,
          );

          return {
            channelId: channel._id.toString(),
            channelName: channel.name,
            newVideosDiscovered: 0,
            alreadyKnownVideos: 0,
            totalVideosChecked: 0,
            uploadsPlaylistId: channel.uploadsPlaylistId,
          };
        }
      } catch (error) {
        this.logger.error(`❌ Failed to monitor channel ${channel.sourceId}:`);
        this.logger.error(`   Error message: ${error.message}`);
        this.logger.error(`   Error code: ${error.code}`);
        this.logger.error(`   Error details:`, error);

        if (error.response) {
          this.logger.error(`   HTTP status: ${error.response.status}`);
          this.logger.error(
            `   Response data:`,
            JSON.stringify(error.response.data, null, 2),
          );
        }

        throw error;
      }
    } else {
      this.logger.warn(
        `⚠️ Unsupported channel source type: ${channel.sourceType}`,
      );
      return {
        channelId: channel._id.toString(),
        channelName: channel.name,
        error: `Unsupported source type: ${channel.sourceType}`,
      };
    }
  }

  /**
   * Discover and save the uploads playlist ID for a YouTube channel
   */
  private async discoverAndSaveUploadsPlaylistId(channel: any): Promise<void> {
    try {
      this.logger.log(
        `🔍 Discovering uploads playlist for channel: ${channel.sourceId}`,
      );

      // Step 1: Get channel details to find uploads playlist ID
      const channelResponse = await this.youtube.channels.list({
        part: ['contentDetails'],
        id: [channel.sourceId],
      });

      if (
        !channelResponse.data.items ||
        channelResponse.data.items.length === 0
      ) {
        throw new Error(`Channel ${channel.sourceId} not found`);
      }

      const uploadsPlaylistId =
        channelResponse.data.items[0].contentDetails?.relatedPlaylists?.uploads;

      if (!uploadsPlaylistId) {
        throw new Error(
          `No uploads playlist found for channel ${channel.sourceId}`,
        );
      }

      this.logger.log(`✅ Found uploads playlist ID: ${uploadsPlaylistId}`);

      // Step 2: Save uploads playlist ID to channel
      await this.channelModel
        .findByIdAndUpdate(channel._id, {
          uploadsPlaylistId: uploadsPlaylistId,
        })
        .exec();

      this.logger.log(
        `💾 Saved uploads playlist ID to channel ${channel.sourceId}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to discover uploads playlist for channel ${channel.sourceId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Fetch videos from a YouTube playlist using playlistItems.list
   * Much more efficient than search.list (1 quota unit vs 100)
   */
  private async fetchVideosFromPlaylist(
    playlistId: string,
    maxResults: number,
    isInitialFetch: boolean = false,
  ): Promise<any[]> {
    const videos: any[] = [];
    let nextPageToken: string | undefined;
    const year2025Start = new Date('2025-01-01');

    try {
      this.logger.log(
        `📋 Fetching videos from playlist: ${playlistId} (max: ${maxResults})`,
      );

      do {
        const requestParams: any = {
          part: ['snippet', 'contentDetails'],
          playlistId: playlistId,
          maxResults: Math.min(50, maxResults - videos.length), // YouTube API max is 50 per request
        };

        if (nextPageToken) {
          requestParams.pageToken = nextPageToken;
        }

        this.logger.debug(
          `🚀 Calling playlistItems.list with params:`,
          JSON.stringify(requestParams, null, 2),
        );

        const response = await this.youtube.playlistItems.list(requestParams);

        if (response.data.items && response.data.items.length > 0) {
          for (const item of response.data.items) {
            // For initial fetch, filter videos from 2025 onwards
            if (isInitialFetch) {
              const publishedAt =
                item.contentDetails?.videoPublishedAt ||
                item.snippet?.publishedAt;
              if (publishedAt) {
                const videoDate = new Date(publishedAt);
                if (videoDate < year2025Start) {
                  this.logger.debug(
                    `⏭️ Skipping video from ${videoDate.toISOString()} (before 2025)`,
                  );
                  continue;
                }
              }
            }

            videos.push(item);

            // Stop if we've reached our target
            if (videos.length >= maxResults) {
              this.logger.log(`🎯 Reached target of ${maxResults} videos`);
              return videos;
            }
          }

          nextPageToken = response.data.nextPageToken;
          this.logger.debug(
            `📄 Fetched ${response.data.items.length} items, total: ${videos.length}, hasNext: ${!!nextPageToken}`,
          );
        } else {
          this.logger.log(`📭 No more videos found in playlist`);
          break;
        }

        // Prevent infinite loops
        if (videos.length >= maxResults) {
          break;
        }
      } while (nextPageToken && videos.length < maxResults);

      this.logger.log(
        `✅ Fetched ${videos.length} videos from playlist ${playlistId}`,
      );
      return videos;
    } catch (error) {
      this.logger.error(
        `❌ Failed to fetch videos from playlist ${playlistId}: ${error.message}`,
      );
      throw error;
    }
  }
}
