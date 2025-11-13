---
alwaysApply: true
---

# Testing Rules

Always add tests cases for the new features or after the bugfixes

## Testing Environment Setup

### Running Tests in Docker
Always run tests within the Docker environment:
```bash
# Unit tests
docker-compose -f docker-compose.dev.yml exec sim-api npm test

# Watch mode
docker-compose -f docker-compose.dev.yml exec sim-api npm run test:watch

# Coverage
docker-compose -f docker-compose.dev.yml exec sim-api npm run test:cov

# E2E tests
docker-compose -f docker-compose.dev.yml exec sim-api npm run test:e2e
```

## Test Structure

### Unit Test Pattern
```typescript
// admin.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AdminService } from './admin.service';
import { Channel } from '../schemas/channel.schema';

describe('AdminService', () => {
  let service: AdminService;
  let mockChannelModel: any;

  beforeEach(async () => {
    mockChannelModel = {
      find: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: getModelToken(Channel.name),
          useValue: mockChannelModel,
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  describe('getAllChannels', () => {
    it('should return all channels', async () => {
      const mockChannels = [{ name: 'Test Channel', sourceType: 'YOUTUBE' }];
      mockChannelModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockChannels),
      });

      const result = await service.getAllChannels();
      
      expect(result).toEqual(mockChannels);
      expect(mockChannelModel.find).toHaveBeenCalled();
    });
  });
});
```

### Controller Test Pattern
```typescript
// admin.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TemplateService } from './template.service';

describe('AdminController', () => {
  let controller: AdminController;
  let adminService: AdminService;
  let templateService: TemplateService;

  beforeEach(async () => {
    const mockAdminService = {
      getAllChannels: jest.fn(),
      createChannel: jest.fn(),
      getDashboardStats: jest.fn(),
    };

    const mockTemplateService = {
      renderLayout: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: TemplateService, useValue: mockTemplateService },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    adminService = module.get<AdminService>(AdminService);
    templateService = module.get<TemplateService>(TemplateService);
  });

  it('should render channels list', async () => {
    const mockChannels = [{ name: 'Test', sourceType: 'YOUTUBE' }];
    const mockHtml = '<html>Mock HTML</html>';
    
    jest.spyOn(adminService, 'getAllChannels').mockResolvedValue(mockChannels);
    jest.spyOn(templateService, 'renderLayout').mockReturnValue(mockHtml);

    const mockRes = {
      send: jest.fn(),
    } as any;

    await controller.channelsList(mockRes);

    expect(adminService.getAllChannels).toHaveBeenCalled();
    expect(templateService.renderLayout).toHaveBeenCalledWith(
      'main',
      'admin/channels-list.hbs',
      expect.objectContaining({
        title: 'Channels',
        currentPage: 'channels',
        channels: mockChannels,
      })
    );
    expect(mockRes.send).toHaveBeenCalledWith(mockHtml);
  });
});
```

### E2E Test Pattern
```typescript
// app.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/admin (GET)', () => {
    return request(app.getHttpServer())
      .get('/admin')
      .expect(200)
      .expect(res => {
        expect(res.text).toContain('Dashboard');
      });
  });

  it('/admin/channels (GET)', () => {
    return request(app.getHttpServer())
      .get('/admin/channels')
      .expect(200)
      .expect(res => {
        expect(res.text).toContain('Channels');
      });
  });
});
```

## Testing Database Operations

### Mock MongoDB Models
```typescript
const mockChannelModel = {
  find: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue([]),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
  }),
  findById: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue({}),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  findByIdAndDelete: jest.fn().mockResolvedValue({}),
  aggregate: jest.fn().mockResolvedValue([]),
};
```

### Test Database Transactions
```typescript
describe('createChannel', () => {
  it('should create channel successfully', async () => {
    const channelDto = {
      name: 'Test Channel',
      sourceType: 'YOUTUBE' as const,
      sourceId: 'UC123456',
    };

    const createdChannel = { ...channelDto, _id: 'mock-id' };
    mockChannelModel.create.mockResolvedValue(createdChannel);

    const result = await service.createChannel(channelDto);

    expect(mockChannelModel.create).toHaveBeenCalledWith(channelDto);
    expect(result).toEqual(createdChannel);
  });

  it('should handle creation errors', async () => {
    const channelDto = {
      name: 'Test Channel',
      sourceType: 'YOUTUBE' as const,
      sourceId: 'UC123456',
    };

    mockChannelModel.create.mockRejectedValue(new Error('Database error'));

    await expect(service.createChannel(channelDto)).rejects.toThrow('Database error');
  });
});
```

## Testing BullMQ Jobs

### Mock Queue Operations
```typescript
const mockQueue = {
  add: jest.fn(),
  remove: jest.fn(),
  getJob: jest.fn(),
  getJobs: jest.fn(),
};

describe('job scheduling', () => {
  it('should schedule channel poll job', async () => {
    await service.scheduleChannelPoll('channel-id');
    
    expect(mockQueue.add).toHaveBeenCalledWith(
      'poll-channel',
      { channelId: 'channel-id' },
      expect.any(Object)
    );
  });
});
```

## Testing Template Rendering

### Mock Template Service
```typescript
const mockTemplateService = {
  renderLayout: jest.fn().mockReturnValue('<html>Mock</html>'),
};

describe('template rendering', () => {
  it('should render with correct data', async () => {
    const mockRes = { send: jest.fn() } as any;
    
    await controller.channelsList(mockRes);
    
    expect(mockTemplateService.renderLayout).toHaveBeenCalledWith(
      'main',
      'admin/channels-list.hbs',
      expect.objectContaining({
        title: 'Channels',
        currentPage: 'channels',
      })
    );
  });
});
```

## Test Coverage Requirements

### Minimum Coverage Targets
- Services: 80% minimum
- Controllers: 70% minimum
- Critical business logic: 90% minimum

### Coverage Commands
```bash
# Generate coverage report
docker-compose -f docker-compose.dev.yml exec sim-api npm run test:cov

# View coverage in browser (if configured)
docker-compose -f docker-compose.dev.yml exec sim-api open coverage/lcov-report/index.html
```

## Testing Best Practices

### ✅ Good Testing Practices
- Test one thing at a time
- Use descriptive test names
- Mock external dependencies
- Test both success and error scenarios
- Clean up after tests

### ❌ Testing Anti-patterns
- Testing implementation details
- Overly complex test setup
- Tests that depend on other tests
- Mocking everything (including what you're testing)
- Tests without assertions

### Test Organization
```
src/
├── admin/
│   ├── admin.controller.spec.ts
│   ├── admin.service.spec.ts
│   └── template.service.spec.ts
├── channels/
│   ├── channels.controller.spec.ts
│   └── channels.service.spec.ts
└── tasks/
    ├── analysis.processor.spec.ts
    └── channel-poll.processor.spec.ts
``` 