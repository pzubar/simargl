import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { QuotaManagerService } from './services/quota-manager.service';

describe('ApiController', () => {
  let apiController: ApiController;
  let mockContentProcessingQueue: any;
  let mockChannelPollQueue: any;
  let mockQuotaManagerService: any;

  beforeEach(async () => {
    // Mock queue services
    mockContentProcessingQueue = {
      add: jest.fn().mockResolvedValue({ id: 'test-job-123' }),
    };

    mockChannelPollQueue = {
      add: jest.fn().mockResolvedValue({ id: 'test-poll-job-456' }),
    };

    // Mock QuotaManagerService
    mockQuotaManagerService = {
      getAvailableModels: jest.fn().mockReturnValue(['gemini-2.5-pro', 'gemini-2.5-flash']),
      getUsageStats: jest.fn().mockReturnValue({
        usage: { requestsInCurrentMinute: 0, tokensInCurrentMinute: 0, requestsToday: 0 },
        limits: { rpm: 5, tpm: 250000, rpd: 100 }
      }),
      getQuotaLimits: jest.fn().mockReturnValue({ rpm: 5, tpm: 250000, rpd: 100 }),
      canMakeRequest: jest.fn().mockResolvedValue({ allowed: true }),
      getViolationStats: jest.fn().mockReturnValue({
        totalViolations: 0,
        violationsByModel: {},
        recentViolations: []
      }),
      currentTier: 'free',
      quotaLimits: {
        free: { 'gemini-2.5-pro': {}, 'gemini-2.5-flash': {} },
        tier1: {},
        tier2: {},
        tier3: {}
      }
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        ApiService,
        {
          provide: getQueueToken('content-processing'),
          useValue: mockContentProcessingQueue,
        },
        {
          provide: getQueueToken('channel-poll'),
          useValue: mockChannelPollQueue,
        },
        {
          provide: QuotaManagerService,
          useValue: mockQuotaManagerService,
        },
      ],
    }).compile();

    apiController = app.get<ApiController>(ApiController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(apiController.getHello()).toBe('Hello World!');
    });
  });

  describe('testVideoAnalysis', () => {
    it('should successfully queue video analysis with valid contentId', async () => {
      const body = { contentId: '507f1f77bcf86cd799439011' };
      
      const result = await apiController.testVideoAnalysis(body);
      
      expect(result).toEqual({
        message: 'Video analysis job queued (metadata → analysis pipeline)',
        contentId: '507f1f77bcf86cd799439011',
        jobId: 'test-job-123',
        model: 'auto-select',
      });
      
      expect(mockContentProcessingQueue.add).toHaveBeenCalledWith(
        'process-content',
        {
          contentId: '507f1f77bcf86cd799439011',
          forceModel: undefined,
        },
        {
          attempts: 4,
          backoff: {
            type: 'exponential',
            delay: 30000,
          },
          removeOnComplete: 10,
          removeOnFail: 20,
        }
      );
    });

    it('should successfully queue video analysis with model selection', async () => {
      const body = { 
        contentId: '507f1f77bcf86cd799439011',
        model: 'gemini-2.5-flash'
      };
      
      const result = await apiController.testVideoAnalysis(body);
      
      expect(result).toEqual({
        message: 'Video analysis job queued (metadata → analysis pipeline)',
        contentId: '507f1f77bcf86cd799439011',
        jobId: 'test-job-123',
        model: 'gemini-2.5-flash',
      });
      
      expect(mockContentProcessingQueue.add).toHaveBeenCalledWith(
        'process-content',
        {
          contentId: '507f1f77bcf86cd799439011',
          forceModel: 'gemini-2.5-flash',
        },
        expect.any(Object)
      );
    });

    it('should trim whitespace from contentId', async () => {
      const body = { contentId: '  507f1f77bcf86cd799439011  ' };
      
      const result = await apiController.testVideoAnalysis(body);
      
      expect(result.contentId).toBe('507f1f77bcf86cd799439011');
      expect(mockContentProcessingQueue.add).toHaveBeenCalledWith(
        'process-content',
        {
          contentId: '507f1f77bcf86cd799439011',
          forceModel: undefined,
        },
        expect.any(Object)
      );
    });

    it('should throw error when body is missing', async () => {
      await expect(apiController.testVideoAnalysis(null as any))
        .rejects.toThrow('Request body is missing');
      
      expect(mockContentProcessingQueue.add).not.toHaveBeenCalled();
    });

    it('should throw error when contentId is missing', async () => {
      const body = { model: 'gemini-2.5-flash' } as any;
      
      await expect(apiController.testVideoAnalysis(body))
        .rejects.toThrow('contentId is required');
      
      expect(mockContentProcessingQueue.add).not.toHaveBeenCalled();
    });

    it('should throw error when contentId is empty string', async () => {
      const body = { contentId: '' };
      
      await expect(apiController.testVideoAnalysis(body))
        .rejects.toThrow('contentId must be a non-empty string');
      
      expect(mockContentProcessingQueue.add).not.toHaveBeenCalled();
    });

    it('should throw error when contentId is only whitespace', async () => {
      const body = { contentId: '   ' };
      
      await expect(apiController.testVideoAnalysis(body))
        .rejects.toThrow('contentId must be a non-empty string');
      
      expect(mockContentProcessingQueue.add).not.toHaveBeenCalled();
    });

    it('should throw error when contentId is not a string', async () => {
      const body = { contentId: 123 } as any;
      
      await expect(apiController.testVideoAnalysis(body))
        .rejects.toThrow('contentId must be a non-empty string');
      
      expect(mockContentProcessingQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('testChannelPoll', () => {
    it('should successfully queue channel poll with valid channelId', async () => {
      const body = { channelId: '507f1f77bcf86cd799439011' };
      
      const result = await apiController.testChannelPoll(body);
      
      expect(result).toEqual({
        message: 'Channel poll job queued',
        channelId: '507f1f77bcf86cd799439011',
        jobId: 'test-poll-job-456',
      });
      
      expect(mockChannelPollQueue.add).toHaveBeenCalledWith(
        'poll-channel',
        { channelId: '507f1f77bcf86cd799439011' }
      );
    });
  });

  describe('getAvailableModels', () => {
    it('should return available models and tier information', () => {
      const result = apiController.getAvailableModels();
      
      expect(result).toEqual({
        models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
        modelsByTier: {
          free: ['gemini-2.5-pro', 'gemini-2.5-flash'],
          tier1: [],
          tier2: [],
          tier3: []
        },
        currentTier: 'free',
        timestamp: expect.any(String),
      });
    });
  });
});
