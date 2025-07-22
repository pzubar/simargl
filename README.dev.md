# Simargl Development Setup

This document covers the development setup for the Simargl project.

## Quick Start

### 1. Start with Docker Compose (Recommended)

```bash
# Start development environment
npm run docker:dev

# Watch logs
npm run docker:dev:logs

# Stop environment
npm run docker:dev:down
```

### 2. Individual Services (Optional)

If you prefer to run services individually:

```bash
# Start MongoDB and Redis
docker-compose -f docker-compose.dev.yml up mongodb redis

# Install dependencies
npm install

# Start API in development mode
npm run start:dev

# Seed database (optional)
npm run seed:dev
```

## Available Services

- **API**: http://localhost:3333
- **Admin Panel**: http://localhost:3333/admin
- **Queue Dashboard**: http://localhost:3333/queues
- **MongoDB**: localhost:27017
- **Redis**: localhost:6379

## Development Commands

```bash
# Build and start development environment
npm run docker:dev

# Watch development logs
npm run docker:dev:logs

# Stop development environment
npm run docker:dev:down

# Rebuild CSS styles (run after template changes)
npm run build:css:copy

# Seed database with sample data
npm run seed:dev

# Update structured prompts
npm run update-prompt
```

## Admin Interface

The admin interface is available at http://localhost:3333/admin and provides:

- **Dashboard**: Overview of channels, content, and system stats
- **Channel Management**: Create, edit, and manage content channels
- **Content Management**: View and manage processed content
- **Recurring Jobs**: Start/stop automated channel polling
- **Manual Polling**: Trigger immediate channel processing

### Template Development

The admin interface uses Handlebars templates with Tailwind CSS styling:

- **Templates**: `apps/api/src/views/admin/*.hbs`
- **Layout**: `apps/api/src/views/layouts/main.hbs`
- **CSS**: `apps/api/src/public/output.css` (auto-generated)

**Important**: After making changes to templates, rebuild the CSS:

```bash
npm run build:css:copy
```

This ensures all Tailwind classes used in new templates are included in the compiled CSS.

## Database Seeding

```bash
# Seed development database
npm run seed:dev

# This creates:
# - Sample YouTube channels
# - Sample content items
# - Default analysis prompts
```

## Queue Management

The application uses BullMQ for background job processing:

- **Channel Polling**: Automated every 24 hours (configurable)
- **Content Analysis**: Video/text analysis jobs
- **Queue Dashboard**: http://localhost:3333/queues

## Quota Management

The system includes built-in quota management for AI model usage:

- **Daily Limits**: Configurable per model
- **Rate Limiting**: Requests per hour/day
- **Cost Tracking**: Token usage monitoring
- **Status Endpoint**: `/api/quota/status`

## Environment Variables

Key environment variables for development:

```bash
# Database
MONGODB_URI=mongodb://mongodb:27017/simargl

# Redis
REDIS_URL=redis://redis:6379

# Google AI
GOOGLE_API_KEY=your_google_ai_api_key

# YouTube API
YOUTUBE_API_KEY=your_youtube_api_key

# Application
NODE_ENV=development
PORT=3333
```

## Troubleshooting

### CSS Styles Not Loading

If admin interface styles appear broken:

```bash
# Rebuild CSS with all template classes
npm run build:css:copy
```

### Database Connection Issues

```bash
# Restart MongoDB container
docker-compose -f docker-compose.dev.yml restart mongodb

# Check container status
docker-compose -f docker-compose.dev.yml ps
```

### Queue Jobs Not Processing

```bash
# Restart Redis container
docker-compose -f docker-compose.dev.yml restart redis

# Check queue dashboard
open http://localhost:3333/queues
```

### Port Already in Use

```bash
# Stop all containers
npm run docker:dev:down

# Check what's using port 3333
lsof -i :3333

# Kill process if needed
kill -9 <PID>
```

## Architecture

- **Framework**: NestJS with TypeScript
- **Database**: MongoDB with Mongoose ODM
- **Queue**: BullMQ with Redis
- **Templates**: Handlebars with Tailwind CSS
- **AI Integration**: Google Generative AI
- **API Integration**: YouTube Data API v3

## API Documentation

### Admin Endpoints

- `GET /admin` - Dashboard
- `GET /admin/channels` - Channel list
- `POST /admin/channels` - Create channel
- `GET/PUT/DELETE /admin/channels/:id` - Channel CRUD

### Public API Endpoints

- `GET /api` - API status
- `GET/POST /channels` - Channel management
- `POST /api/test-video-analysis` - Trigger analysis
- `GET /api/quota/status` - Quota information

## Contributing

1. Make changes to templates or code
2. Rebuild CSS if templates changed: `npm run build:css:copy`
3. Test locally with `npm run docker:dev`
4. Check admin interface works correctly
5. Submit pull request

## Production Deployment

```bash
# Build and start production environment
npm run docker:prod

# Stop production environment
npm run docker:prod:down
``` 