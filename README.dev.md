# Development Environment Setup

This project now supports hot reload development using Docker Compose with volume mounts and NestJS watch mode.

## 🚀 Quick Start

### Development Mode (Hot Reload)
```bash
# Start development environment with hot reload
npm run docker:dev

# Or manually
docker-compose -f docker-compose.dev.yml up --build
```

### With Docker Compose Watch (Recommended)
If you have Docker Compose v2.20+ with watch support:
```bash
# Start with file watching
npm run docker:dev:watch

# Or manually
docker-compose -f docker-compose.dev.yml watch
```

## 📁 Project Structure

- `docker-compose.yml` - Production configuration
- `docker-compose.dev.yml` - Development configuration with hot reload
- `Dockerfile` - Production Dockerfile
- `Dockerfile.dev` - Development Dockerfile with watch mode

## 🛠️ Available Scripts

### Development
- `npm run docker:dev` - Start development environment
- `npm run docker:dev:watch` - Start with file watching (Docker Compose v2.20+)
- `npm run docker:dev:down` - Stop development environment
- `npm run docker:dev:logs` - View API logs

### Production
- `npm run docker:prod` - Start production environment
- `npm run docker:prod:down` - Stop production environment

## 🔄 Hot Reload Features

### What Gets Reloaded Automatically:
- TypeScript files in `apps/` directory
- TypeScript files in `libs/` directory
- Configuration files (nest-cli.json, tsconfig.json)

### What Triggers Rebuild:
- Changes to `package.json` (new dependencies)

### Volume Mounts:
- Source code is mounted for real-time sync
- `node_modules` is excluded to avoid conflicts
- Compiled output is stored in a Docker volume

## 🌐 Access Points

Once running:
- **Main Application**: http://localhost:3333
- **AdminJS Panel**: http://localhost:3333/admin
- **MongoDB**: localhost:27017
- **Redis**: localhost:6379

## 📋 Environment Variables

Create a `.env` file with:
```env
# Application
PORT=3333
NODE_ENV=development

# Database
MONGO_URI=mongodb://mongodb:27017/simargl

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# APIs
YOUTUBE_API_KEY=your_youtube_api_key_here
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
```

## 🐛 Troubleshooting

### Hot Reload Not Working?
1. Ensure Docker Compose version supports watch (v2.20+)
2. Check volume mounts are correctly configured
3. Verify NestJS is running in watch mode inside container

### Container Build Issues?
```bash
# Clean rebuild
npm run docker:dev:down
docker system prune -f
npm run docker:dev
```

### View Container Logs:
```bash
npm run docker:dev:logs
```

## 💡 Development Tips

1. **Code Changes**: Automatically reload when you save files
2. **Dependency Changes**: Restart containers when adding new packages
3. **Configuration Changes**: May require container restart
4. **Database Changes**: Schema changes persist in MongoDB volume
5. **Performance**: Volume mounts may be slower on some systems (especially macOS) 