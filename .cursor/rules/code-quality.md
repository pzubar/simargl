---
alwaysApply: true
---

# Code Quality & Best Practices

## TypeScript Standards

### Type Safety
Always use proper TypeScript types:
```typescript
// ✅ Correct: Proper typing
interface CreateChannelDto {
  name: string;
  sourceType: 'YOUTUBE' | 'TELEGRAM';
  sourceId: string;
  cronPattern?: string;
}

async getChannelById(id: string): Promise<Channel | null> {
  return this.channelModel.findById(id);
}

// ❌ Wrong: Using 'any'
async getChannelById(id: any): Promise<any> {
  return this.channelModel.findById(id);
}
```

### Import Organization
```typescript
// 1. Node modules
import { Controller, Get, Post, Res } from '@nestjs/common';
import { Response } from 'express';

// 2. Local services
import { AdminService } from './admin.service';
import { TemplateService } from './template.service';

// 3. Schemas/types
import { Channel } from '../schemas/channel.schema';
```

## Error Handling

### Consistent Error Patterns
```typescript
// ✅ Correct: Proper error handling
try {
  const result = await this.service.performOperation();
  res.json({ success: true, data: result });
} catch (error) {
  console.error('Operation failed:', error);
  res.status(400).json({ 
    success: false, 
    message: 'Operation failed: ' + error.message 
  });
}

// ❌ Wrong: Silent failures
const result = await this.service.performOperation();
res.json(result);
```

### Validation
Always validate input data:
```typescript
@Post('channels')
async createChannel(@Body() createChannelDto: CreateChannelDto, @Res() res: Response) {
  if (!createChannelDto.name || !createChannelDto.sourceId) {
    return res.status(400).json({ 
      success: false, 
      message: 'Name and source ID are required' 
    });
  }
  // ... rest of the logic
}
```

## Database Operations

### MongoDB Best Practices
```typescript
// ✅ Correct: Use lean() for read-only operations
const channels = await this.channelModel.find().lean();

// ✅ Correct: Handle potential null results
const channel = await this.channelModel.findById(id);
if (!channel) {
  throw new NotFoundException('Channel not found');
}

// ✅ Correct: Use select() to limit fields
const channels = await this.channelModel.find()
  .select('name sourceType createdAt')
  .lean();
```

### Data Transformation
Transform data in services, not controllers:
```typescript
// ✅ Correct: Service handles transformation
export class AdminService {
  async getAllChannelsForDisplay() {
    const channels = await this.channelModel.find().lean();
    return channels.map(channel => ({
      _id: channel._id?.toString(),
      name: channel.name,
      sourceType: channel.sourceType,
      // ... other transformations
    }));
  }
}
```

## Logging and Debugging

### Structured Logging
```typescript
// ✅ Use structured logging
console.log('Channel created:', { 
  channelId: channel._id, 
  name: channel.name, 
  sourceType: channel.sourceType 
});

// ❌ Avoid generic console.log
console.log('Something happened');
```

### Error Context
```typescript
catch (error) {
  console.error('Failed to create channel:', {
    error: error.message,
    stack: error.stack,
    inputData: createChannelDto
  });
  throw error;
}
```

## Performance Guidelines

### Efficient Queries
```typescript
// ✅ Use aggregation for complex queries
const stats = await this.channelModel.aggregate([
  { $group: { _id: '$sourceType', count: { $sum: 1 } } }
]);

// ✅ Use indexes for frequently queried fields
// Define in schema: @index({ sourceId: 1, sourceType: 1 })
```

### Pagination
```typescript
async getContentsPaginated(page: number = 1, limit: number = 20) {
  const skip = (page - 1) * limit;
  return this.contentModel.find()
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 })
    .lean();
}
```

## Security Practices

### Input Sanitization
```typescript
// ✅ Validate and sanitize inputs
@Post('channels')
async createChannel(@Body() createChannelDto: CreateChannelDto) {
  // Validate required fields
  if (!createChannelDto.name?.trim()) {
    throw new BadRequestException('Channel name is required');
  }
  
  // Sanitize input
  const sanitizedDto = {
    ...createChannelDto,
    name: createChannelDto.name.trim(),
  };
  
  return this.adminService.createChannel(sanitizedDto);
}
```

### Safe ID Handling
```typescript
// ✅ Validate ObjectId format
import { isValidObjectId } from 'mongoose';

@Get('channels/:id')
async getChannel(@Param('id') id: string) {
  if (!isValidObjectId(id)) {
    throw new BadRequestException('Invalid channel ID format');
  }
  // ... rest of logic
}
```

## Code Organization

### Single Responsibility
Each method should have one clear purpose:
```typescript
// ✅ Good: Single responsibility
async createChannel(data: CreateChannelDto): Promise<Channel> {
  return this.channelModel.create(data);
}

async scheduleChannelPolling(channelId: string): Promise<void> {
  // Handle scheduling logic
}

// ❌ Bad: Multiple responsibilities
async createChannelAndSchedule(data: CreateChannelDto) {
  const channel = await this.channelModel.create(data);
  // ... scheduling logic
  // ... notification logic
  // ... logging logic
}
```

### DRY Principle
Avoid code duplication:
```typescript
// ✅ Extract common patterns
private formatChannelForDisplay(channel: any) {
  return {
    _id: channel._id?.toString(),
    name: channel.name,
    sourceType: channel.sourceType,
    createdAt: channel.createdAt,
  };
}
```

## Documentation

### Method Documentation
```typescript
/**
 * Creates a new channel and optionally schedules polling
 * @param createChannelDto - Channel creation data
 * @returns Promise<Channel> - Created channel document
 * @throws BadRequestException - If validation fails
 */
async createChannel(createChannelDto: CreateChannelDto): Promise<Channel> {
  // Implementation
}
```

### Complex Logic Comments
```typescript
// Convert Mongoose documents to plain objects to avoid 
// Handlebars property access issues with virtual fields
const channels = channelsRaw.map(channel => ({
  _id: channel._id?.toString(),
  // ... other mappings
}));
``` 