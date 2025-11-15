# BullMQ Rate Limiting Integration

This document explains how the BullMQ rate limiting system integrates with the existing `EnhancedQuotaManagerService` to handle API quota violations gracefully.

## Overview

The rate limiting system automatically detects when quota limits are exceeded and applies appropriate BullMQ rate limits to prevent tasks from repeatedly failing. This replaces manual retry scheduling with native BullMQ rate limiting capabilities.

## Key Components

### 1. BullMQRateLimitService

Located in `apps/api/src/services/bullmq-rate-limit.service.ts`, this service provides:

- **Dynamic rate limit calculation** based on current quota usage
- **Quota violation handling** with automatic rate limiting
- **Model-specific rate limits** for different AI models
- **System-wide overload detection** and mitigation

### 2. Updated Task Processors

The following processors integrate with the rate limiting system:

- `ChunkAnalysisProcessor` - Individual chunk processing (primary AI processing)
- `CombinationProcessor` - Chunk combination tasks (secondary AI processing)

> **Note**: The `AnalysisProcessor` has been identified as redundant and should be removed in favor of the chunk-based approach. See `PROCESSOR_DOCUMENTATION.md` for detailed migration guidance.

## How It Works

### 1. Pre-emptive Rate Limiting

Before processing a task, the system checks if the required model has sufficient quota:

```typescript
const rateLimitResult = await this.rateLimitService.applyQuotaRateLimit(
  this.worker as Worker,
  selectedModel,
  estimatedTokens
);

if (rateLimitResult.applied) {
  throw Worker.RateLimitError(); // BullMQ handles the delay
}
```

### 2. Quota Violation Handling

When a quota violation occurs, the system automatically applies rate limiting:

```typescript
const rateLimitResult = await this.rateLimitService.handleQuotaViolation(
  this.worker as Worker,
  modelUsed,
  error
);

if (rateLimitResult.rateLimited) {
  throw Worker.RateLimitError(); // BullMQ handles the retry
}
```

### 3. Rate Limit Types

The system handles different types of quota violations:

- **RPM (Requests Per Minute)**: Short-term rate limiting (typically 60-120 seconds)
- **TPM (Tokens Per Minute)**: Similar to RPM, based on token usage
- **RPD (Requests Per Day)**: Long-term rate limiting (until end of day)

## Configuration

### Queue-Specific Rate Limits

Different queues have different base rate limits:

```typescript
// AI Processing Queues (chunk-analysis, combination)
@Processor('chunk-analysis', {
  limiter: {
    max: 10, // 10 requests
    duration: 60000, // per minute
  },
})

// Standard Queues (channel-poll, content-processing, etc.)
@Processor('channel-poll', {
  limiter: {
    max: 50, // 50 requests
    duration: 60000, // per minute
  },
})
```

### Model-Specific Limits

The system applies different rate limits based on the AI model being used:

```typescript
modelRateLimits: {
  'gemini-2.5-flash-lite-preview-06-17': {
    max: 15,
    duration: 60000,
  },
  'gemini-2.5-flash': {
    max: 10,
    duration: 60000,
  },
  'gemini-2.5-pro': {
    max: 5,
    duration: 60000,
  },
}
```

## Benefits

### 1. Automatic Recovery

Tasks automatically resume when quota limits reset, without manual intervention.

### 2. Efficient Resource Usage

- No wasted API calls during quota violations
- Intelligent model selection based on availability
- Dynamic rate adjustment based on system load

### 3. Improved Reliability

- Graceful handling of quota exhaustion
- Prevents cascade failures
- Maintains system stability during high load

### 4. Better Observability

Enhanced logging provides detailed information about:
- When rate limits are applied
- Why specific delays are used
- Model availability and quota status

### 5. Chunk-Based Processing Benefits

The recommended chunk-based architecture provides additional rate limiting advantages:

- **Granular Rate Control**: Each chunk is rate-limited individually
- **Partial Progress**: Failed chunks don't affect successful ones
- **Better Resource Distribution**: Smaller jobs with more predictable resource usage
- **Parallel Processing Potential**: Foundation for parallel chunk processing

## Example Logs

```
⏳ Pre-emptive rate limit applied for content 507f1f77bcf86cd799439011: RPM limit exceeded (5/5)
📊 Quota violation handled with rate limiting for model gemini-2.5-flash, retry in 60000ms
🛑 Daily quota exceeded for gemini-2.5-pro, rate limited until day end (43200s)
🚨 System-wide overload detected (3/5 models overloaded), applying extended rate limit: 120000ms
```

## Integration Points

### 1. With EnhancedQuotaManagerService

The rate limiting service integrates seamlessly with the existing quota management:

- Uses quota check results to determine rate limits
- Records quota violations for tracking
- Respects model availability and overload status

### 2. With BullMQ Workers

Native BullMQ rate limiting ensures:
- Efficient memory usage
- Proper job scheduling
- Built-in retry mechanics

### 3. With Monitoring

Rate limiting events are logged and can be monitored through:
- Application logs
- Bull Board dashboard
- Custom metrics endpoints

## Advanced Features

### Dynamic Rate Adjustment

The system automatically adjusts rate limits based on:
- Current quota usage percentage
- Number of overloaded models
- Historical violation patterns

### Intelligent Fallback

When primary models are unavailable:
- Automatically selects alternative models
- Applies appropriate rate limits for each model
- Maintains processing continuity

### System Health Monitoring

The service monitors overall system health and applies protective measures when:
- Multiple models are overloaded
- Quota violations spike
- System resources are constrained

## Future Enhancements

1. **Predictive Rate Limiting**: Use historical data to predict and prevent quota violations
2. **Cross-Queue Coordination**: Coordinate rate limits across different queue types
3. **External Monitoring Integration**: Send rate limiting metrics to external monitoring systems
4. **Custom Rate Limit Strategies**: Allow configuration of custom rate limiting algorithms 