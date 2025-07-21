import { Controller, Get, Post, Body } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiService } from './api.service';

@Controller('api')
export class ApiController {
  constructor(
    private readonly apiService: ApiService,
    @InjectQueue('analysis') private analysisQueue: Queue,
  ) {}

  @Get()
  getHello(): string {
    return this.apiService.getHello();
  }

  @Post('test-video-analysis')
  async testVideoAnalysis(@Body() body: { contentId: string }) {
    console.log(`Manually triggering video analysis for content: ${body.contentId}`);
    
    // Add job to analysis queue
    const job = await this.analysisQueue.add('analyze-content', { 
      contentId: body.contentId 
    });
    
    return {
      message: 'Video analysis job queued',
      contentId: body.contentId,
      jobId: job.id,
    };
  }
}
