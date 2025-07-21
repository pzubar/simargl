import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';  
import { Job, Queue } from 'bullmq';  
import { InjectModel } from '@nestjs/mongoose';  
import { Model } from 'mongoose';  
import { Content } from '../schemas/content.schema';  
import { Prompt } from '../schemas/prompt.schema';  
import { Channel } from '../schemas/channel.schema';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';

@Processor('analysis')  
export class AnalysisProcessor extends WorkerHost {  
  private genAI: GoogleGenerativeAI;

  constructor(  
    @InjectModel(Content.name) private contentModel: Model<Content>,  
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,  
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    @InjectQueue('stats') private statsQueue: Queue,
    private configService: ConfigService,
  ) {
    super();
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async process(job: Job<any, any, string>): Promise<any> {  
    console.log(`Analyzing content: ${job.data.contentId}`);  
    const content = await this.contentModel.findById(job.data.contentId).exec();  
    
    if (!content) {
      console.error(`Content with id ${job.data.contentId} not found.`);
      return;
    }
    
    const channel = await this.channelModel.findById(content.channelId).exec();
    
    if (!channel) {
      console.error(`Channel with id ${content.channelId} not found.`);
      return;
    }

    const prompt = await this.promptModel.findOne({ isDefault: true }).sort({ version: -1 }).exec();  
    if (!prompt) throw new Error('No default prompt found!');

    let finalPrompt = prompt.promptTemplate;  
    finalPrompt = finalPrompt.replace('{{TITLE}}', content.title || '');  
    finalPrompt = finalPrompt.replace('{{TRANSCRIPT}}', content.data?.transcript || '');  
    finalPrompt = finalPrompt.replace('{{AUTHOR_CONTEXT}}', channel.authorContext || '');

    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
      const result = await model.generateContent(finalPrompt);
      const response = await result.response;
      const analysisResult = JSON.parse(response.text());

      await this.contentModel.updateOne({ _id: content._id }, {
        analysis: {
          promptVersion: prompt.version,
          promptName: prompt.promptName,
          result: analysisResult,
        },
        status: 'ANALYZED',
      });
        
      // Add a one-time job to update stats
      await this.statsQueue.add('update-stats', { contentId: content._id });
    } catch (error) {
      console.error(`Failed to analyze content ${content._id}:`, error);
      content.status = 'FAILED';
      await content.save();
      throw error;
    }

    return {};  
  }  
}