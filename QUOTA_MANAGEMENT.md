# Gemini API Quota Management

## Overview

The application now includes dynamic quota management for the Gemini API to respect rate limits and prevent quota exhaustion. The system supports both Free Tier and paid tiers.

## Configuration

Add to your environment variables:

```bash
# Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_TIER=free  # Options: free, tier1, tier2, tier3
```

## Quota Limits by Tier

### Free Tier (`GEMINI_TIER=free`)
- **gemini-2.5-flash**: 10 RPM, 250K TPM, 250 RPD, 4K max tokens/request
- **gemini-2.5-pro**: 5 RPM, 250K TPM, 100 RPD, 4K max tokens/request  
- **gemini-2.0-flash-exp**: 15 RPM, 1M TPM, 200 RPD, 4K max tokens/request

### Tier 1 (`GEMINI_TIER=tier1`)
- **gemini-2.5-flash**: 2000 RPM, 4M TPM, 8K max tokens/request
- **gemini-2.5-pro**: 1000 RPM, 4M TPM, 8K max tokens/request
- **gemini-2.0-flash-exp**: 30000 RPM, 30M TPM, 8K max tokens/request

### Tier 2+ (`GEMINI_TIER=tier2` or `tier3`)
- Higher limits for production usage

## Features

### Automatic Quota Management
- ✅ **Request Rate Limiting**: Respects RPM (Requests Per Minute) limits
- ✅ **Token Rate Limiting**: Respects TPM (Tokens Per Minute) limits  
- ✅ **Daily Limits**: Respects RPD (Requests Per Day) for free tier
- ✅ **Request Size Limiting**: Respects max tokens per request
- ✅ **Auto-waiting**: Automatically waits when limits are reached
- ✅ **Token Estimation**: Estimates token usage before requests

### Dynamic Tier Switching
- ✅ **Runtime Switching**: Change tiers without restart
- ✅ **API Endpoint**: `POST /api/quota/tier` to change tiers
- ✅ **Automatic Cleanup**: Clears usage stats when switching

### Monitoring & Logging
- ✅ **Real-time Usage**: Track current quota usage
- ✅ **Detailed Logging**: See quota checks and usage
- ✅ **Status Endpoint**: `GET /api/quota/status` for current status
- ✅ **Model-specific Checks**: `GET /api/quota/check/:model`

## API Endpoints

### Get Quota Status
```bash
GET /api/quota/status
```

Response:
```json
{
  "currentTier": "free",
  "models": [
    {
      "model": "gemini-2.5-flash",
      "usage": {
        "requestsInCurrentMinute": 2,
        "tokensInCurrentMinute": 5430,
        "requestsToday": 15
      },
      "limits": {
        "rpm": 10,
        "tpm": 250000,
        "rpd": 250,
        "maxTokensPerRequest": 4096
      }
    }
  ],
  "timestamp": "2025-07-21T14:30:00.000Z"
}
```

### Check Quota for Specific Model
```bash
GET /api/quota/check/gemini-2.5-flash
```

Response:
```json
{
  "model": "gemini-2.5-flash",
  "estimatedTokens": 1000,
  "check": {
    "allowed": true
  },
  "limits": { "rpm": 10, "tpm": 250000 },
  "usage": { "requestsInCurrentMinute": 2 }
}
```

### Change Quota Tier
```bash
POST /api/quota/tier
Content-Type: application/json

{
  "tier": "tier1"
}
```

Response:
```json
{
  "message": "Quota tier updated to TIER1",
  "newTier": "tier1",
  "timestamp": "2025-07-21T14:30:00.000Z"
}
```

## Integration

The quota manager is automatically integrated into the video analysis pipeline:

1. **Pre-request Check**: Verifies quota availability before making requests
2. **Auto-waiting**: Waits if quota limits are reached
3. **Usage Recording**: Records actual token usage after requests
4. **Logging**: Provides detailed quota usage logs

## Example Logs

```
🎯 Quota Manager initialized for FREE tier
📋 Available models for FREE tier:
   🤖 gemini-2.5-flash: 10 RPM, 250K TPM, 250 RPD
   🤖 gemini-2.5-pro: 5 RPM, 250K TPM, 100 RPD

📊 Estimated tokens: 2500, Max allowed: 4096
📊 Quota usage: 3/10 RPM, 7800/250000 TPM

⏳ Quota limit reached for gemini-2.5-flash. Waiting 45s. Reason: RPM limit exceeded (10/10)
```

## Best Practices

1. **Monitor Usage**: Check `/api/quota/status` regularly
2. **Start with Free Tier**: Test with free tier before upgrading
3. **Plan for Limits**: Design workflows around quota constraints
4. **Use Appropriate Models**: Choose models based on your tier limits
5. **Handle Waiting**: The system automatically waits, but plan for delays

## Upgrading Tiers

To upgrade from free to paid tier:

1. Upgrade your Google AI Studio/Vertex AI billing
2. Update `GEMINI_TIER` environment variable
3. Restart the application OR use the API endpoint:
   ```bash
   curl -X POST http://localhost:3333/api/quota/tier \
     -H "Content-Type: application/json" \
     -d '{"tier": "tier1"}'
   ```

The system will automatically use the higher limits and better performance of the paid tier. 