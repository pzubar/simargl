---
alwaysApply: true
---

# Docker Development Rules

## Mandatory Container Usage
**CRITICAL**: All development commands and scripts MUST be executed inside Docker containers using `docker-compose.dev.yml`.

### Required Container Commands

#### Starting Development Environment
```bash
# Start all services with build
npm run docker:dev

# Start with watch mode (if using newer Docker Compose)
npm run docker:dev:watch

# View logs
npm run docker:dev:logs
```

#### Executing Commands Inside Containers
```bash
# NestJS commands
docker-compose -f docker-compose.dev.yml exec sim-api npm run start:dev
docker-compose -f docker-compose.dev.yml exec sim-api npm run seed:dev

# Database operations
docker-compose -f docker-compose.dev.yml exec sim-mongodb mongosh simargl

# Tailwind CSS compilation
docker-compose -f docker-compose.dev.yml exec sim-api npx tailwindcss -i /usr/src/app/apps/api/src/public/input.css -o /usr/src/app/apps/api/src/public/output.css

# TypeScript compilation
docker-compose -f docker-compose.dev.yml exec sim-api npm run build

# Running scripts
docker-compose -f docker-compose.dev.yml exec sim-api npm run seed
docker-compose -f docker-compose.dev.yml exec sim-api npm run update-prompt
```

#### File Operations in Containers
```bash
# Copy files from container
docker cp simargl-api-dev:/usr/src/app/apps/api/src/public/output.css apps/api/src/public/output.css

# Execute interactive shell
docker-compose -f docker-compose.dev.yml exec sim-api /bin/bash
```

### Container Information
- **API Container**: `sim-api` (simargl-api-dev)
- **MongoDB Container**: `sim-mongodb` (port 27018 → 27017)
- **Redis Container**: `sim-redis` (port 6380 → 6379)

### Network and Volumes
- Network: `app-network`
- MongoDB Data: `mongo_data` volume
- Redis Data: `redis_data` volume
- Hot reload enabled for `/apps` and `/libs` directories

### Never Run Locally
❌ **DO NOT** run these commands on the host system:
- `npm start` / `npm run start:dev`
- `mongosh` / `mongo`
- Direct TypeScript compilation
- Database seeding scripts
- Any Node.js/NestJS related commands

✅ **ALWAYS** use the Docker containers for development tasks. 