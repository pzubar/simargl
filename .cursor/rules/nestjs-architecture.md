---
alwaysApply: true
---

# NestJS Architecture Rules

## Project Structure Rules

### Module Organization
Follow the established modular structure:
```
src/
├── admin/          # Admin dashboard functionality
├── channels/       # Channel management
├── schemas/        # MongoDB schemas
├── services/       # Shared services
├── tasks/          # Background job processors
├── views/          # Handlebars templates
└── scripts/        # Utility scripts
```

### Service Layer Pattern
Always use proper service injection and separation of concerns:

#### ✅ Correct Controller Pattern
```typescript
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly templateService: TemplateService,
  ) {}

  @Get('channels')
  async channelsList(@Res() res: Response) {
    const channels = await this.adminService.getAllChannels();
    
    const html = this.templateService.renderLayout('main', 'admin/channels-list.hbs', {
      title: 'Channels',
      currentPage: 'channels',
      showNavigation: true,
      channels
    });
    res.send(html);
  }
}
```

#### ❌ Wrong: Business Logic in Controller
```typescript
// NEVER put business logic directly in controllers
@Get('channels')
async channelsList(@Res() res: Response) {
  // Don't do database operations here
  const channels = await this.channelModel.find();
  // Don't do data transformation here
  const transformedChannels = channels.map(...);
}
```

### MongoDB Schema Usage
Always use the established schemas in `src/schemas/`:
- `channel.schema.ts` - Channel configuration
- `content.schema.ts` - Content items
- `prompt.schema.ts` - AI prompts
- `video-analysis-response.schema.ts` - Analysis results

#### Schema Import Pattern
```typescript
import { Channel } from '../schemas/channel.schema';
import { Content } from '../schemas/content.schema';
```

### BullMQ Task Processing
Use the established task processors in `src/tasks/`:
```typescript
// Reference existing processors
import { AnalysisProcessor } from '../tasks/analysis.processor';
import { ChannelPollProcessor } from '../tasks/channel-poll.processor';
```

### Service Dependencies
Follow the established service structure:
```typescript
// Core services
QuotaManagerService    // API rate limiting
VideoAnalysisService   // AI analysis
TemplateService       // View rendering
AdminService          // Admin operations
ChannelsService       // Channel management
```

### Error Handling Pattern
```typescript
@Post('channels')
async createChannel(@Body() createChannelDto: CreateChannelDto, @Res() res: Response) {
  try {
    await this.adminService.createChannel(createChannelDto);
    res.redirect('/admin/channels');
  } catch (error) {
    res.status(400).send('Error creating channel: ' + error.message);
  }
}
```

### Environment Configuration
Always use environment variables for configuration:
```typescript
// Available via Docker environment
process.env.MONGO_URI      // MongoDB connection
process.env.REDIS_HOST     // Redis host
process.env.REDIS_PORT     // Redis port
process.env.NODE_ENV       // Environment
```

### API Response Patterns

#### HTML Responses (Admin UI)
```typescript
const html = this.templateService.renderLayout('main', 'template.hbs', data);
res.send(html);
```

#### JSON API Responses
```typescript
// Success
res.json({ success: true, data: result });

// Error
res.status(400).json({ success: false, message: error.message });
```

#### Redirects
```typescript
res.redirect('/admin/channels');
```

### Dependency Injection
Always use proper DI patterns:
```typescript
constructor(
  private readonly serviceA: ServiceA,
  private readonly serviceB: ServiceB,
) {}
```

### File Organization Rules
- Controllers: Handle HTTP requests/responses only
- Services: Business logic and data operations
- Schemas: MongoDB model definitions
- Processors: Background job handling
- Scripts: Utility and setup scripts

### Import Path Rules
Use relative imports for local modules:
```typescript
import { AdminService } from './admin.service';
import { TemplateService } from './template.service';
import { Channel } from '../schemas/channel.schema';
```

### Docker Integration
All services must work within the Docker environment:
- Database connections use container names (`sim-mongodb`, `sim-redis`)
- Environment variables are set via docker-compose
- Hot reload is configured for development 