import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { GoogleAuth } from 'google-auth-library';
import { createGoogle } from '@ai-sdk/google';

export enum TierType {
  FREE_TIER = 'free tier',
  TIER_1 = 'tier 1',
  TRIAL = 'trial',
}

export enum ModelType {
  LLM = 'llm',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
}

export interface KeyBalancerResult {
  id?: string;
  _id?: string;
  key: string;
  name?: string;
  provider?: string;
  type?: string;
  keyType?: string;
  error?: string;
  errorDescription?: string;
}

@Injectable()
export class KeyBalancerService {
  private readonly logger = new Logger(KeyBalancerService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Check if a given model identifier corresponds to a Google LLM model.
   */
  public isGoogleModel(modelName: string): boolean {
    if (!modelName) return false;
    const lower = modelName.toLowerCase();
    return lower.startsWith('gemini') || lower.startsWith('google') || lower.includes('imagen');
  }

  /**
   * Check if a key string is a GCP Service Account JSON object.
   */
  public isServiceAccountKey(keyStr: string): boolean {
    if (!keyStr) return false;
    const trimmed = keyStr.trim();
    if (!trimmed.startsWith('{')) return false;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && (parsed.type === 'service_account' || !!parsed.private_key);
    } catch {
      return false;
    }
  }

  /**
   * Get a balanced API key from Key Balancer for Google models.
   * Query is hardcoded to service_account keyType and trial tierType as requested.
   */
  public async getBestTier1GoogleKey(modelName: string, token?: any): Promise<KeyBalancerResult | null> {
    if (!this.isGoogleModel(modelName)) {
      this.logger.debug(`Model '${modelName}' is not a Google model — skipping Key Balancer.`);
      return null;
    }

    const keyBalancerHost = process.env.KEY_BALANCER_HOST;
    if (!keyBalancerHost) {
      this.logger.debug('KEY_BALANCER_HOST environment variable is not set — skipping Key Balancer.');
      return null;
    }

    const url = `${keyBalancerHost}/api/key-usage/get-best-key-balanced`;
    const payload = {
      token: token ?? null,
      keyRequest: {
        provider: 'google',
        aiType: ModelType.LLM,
        service: modelName,
        tierType: TierType.TRIAL,       // Hardcoded requirement: trial
        keyType: 'service_account',      // Hardcoded requirement: service_account
      },
    };

    try {
      this.logger.log(`⚖️ Requesting Service Account (trial) key from Key Balancer for model '${modelName}' at ${keyBalancerHost}`);
      const response = await firstValueFrom(
        this.httpService.post<KeyBalancerResult | KeyBalancerResult[]>(url, payload, { timeout: 4000 }),
      );

      const data = response.data;
      const result: KeyBalancerResult | null = Array.isArray(data) ? data[0] ?? null : data;

      if (result && result.key && !result.error) {
        this.logger.log(`Key Balancer returned key '${result.name || result.id || 'anonymous'}' (type: ${result.keyType || 'unknown'}) for model '${modelName}'.`);
        return result;
      }

      if (result?.error) {
        this.logger.warn(`Key Balancer returned error: ${result.error} — ${result.errorDescription ?? ''}`);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to fetch key from Key Balancer: ${err?.message || err}`);
    }

    return null;
  }

  /**
   * Map AI Studio model aliases to supported Vertex AI model identifiers in GCP.
   */
  public mapModelForVertex(modelName: string): string {
    if (!modelName) return 'gemini-2.5-flash-lite';
    const lower = modelName.toLowerCase();
    if (lower.includes('3.5-flash-lite')) return 'gemini-2.5-flash-lite';
    if (lower.includes('pro')) return 'gemini-2.5-pro';
    if (lower.includes('3.5-flash')) return 'gemini-2.5-flash';
    return modelName;
  }


  /**
   * Constructs a Vercel AI SDK LanguageModel (using @ai-sdk/google-vertex for Service Accounts
   * or @ai-sdk/google for standard API Keys) obtained from Key Balancer.
   */
  public async createGoogleProvider(
    modelName: string,
    token?: any,
  ): Promise<{
    googleProvider: (modelId: string) => any;
    balancedKey: KeyBalancerResult | null;
  }> {
    const balancedKey = await this.getBestTier1GoogleKey(modelName, token);

    if (balancedKey?.key && this.isServiceAccountKey(balancedKey.key)) {
      try {
        const credentials = JSON.parse(balancedKey.key.trim());
        const { createVertex } = await import('@ai-sdk/google-vertex');
        const vertex = createVertex({
          project: credentials.project_id,
          location: process.env.GCP_LOCATION || 'us-central1',
          googleAuthOptions: { credentials },
        });

        const targetModel = this.mapModelForVertex(modelName);
        this.logger.log(
          `🔑 Created Google Vertex AI Model using Service Account '${balancedKey.name || balancedKey.id || credentials.client_email || 'service_account'}' (project: ${credentials.project_id}) for model '${targetModel}' (requested: '${modelName}')`,
        );

        return { googleProvider: (m: string) => vertex(this.mapModelForVertex(m)), balancedKey };
      } catch (err: any) {
        this.logger.error(`Failed to parse/authenticate Service Account key from Key Balancer for Vertex AI: ${err?.message || err}`);
      }
    }


    // Fallback: Standard API key via @ai-sdk/google
    const apiKey = balancedKey?.key || process.env.GEMINI_API_KEY;
    const google = createGoogle({ apiKey });
    return { googleProvider: (m: string) => google(m), balancedKey };
  }


  /**
   * Update post-request usage (token count or characters) for a used key.
   */
  public async updateUsage(keyUsageId: string, usageCount: number): Promise<void> {
    const keyBalancerHost = process.env.KEY_BALANCER_HOST;
    if (!keyBalancerHost || !keyUsageId) return;

    const url = `${keyBalancerHost}/api/key-usage/update-usage`;
    try {
      await firstValueFrom(
        this.httpService.post(url, { keyUsageId, usageCount }, { timeout: 3000 }),
      );
      this.logger.verbose(`Updated Key Balancer usage for keyUsageId '${keyUsageId}': ${usageCount} tokens.`);
    } catch (err: any) {
      this.logger.warn(`Failed to update Key Balancer usage for keyUsageId '${keyUsageId}': ${err?.message || err}`);
    }
  }

  /**
   * Record a failed request (e.g. Rate Limit 429) to temporarily block the key.
   */
  public async recordFailedRequest(provider: string, key: string, service: string, errorMsg: string): Promise<void> {
    const keyBalancerHost = process.env.KEY_BALANCER_HOST;
    if (!keyBalancerHost || !key) return;

    const url = `${keyBalancerHost}/api/key-usage/update-key-failure`;
    try {
      await firstValueFrom(
        this.httpService.post(
          url,
          { provider, key, service, error: errorMsg, ttlSeconds: 5 },
          { timeout: 3000 },
        ),
      );
      this.logger.warn(`Recorded Key Balancer failure for model '${service}': ${errorMsg}`);
    } catch (err: any) {
      this.logger.warn(`Failed to record Key Balancer failure: ${err?.message || err}`);
    }
  }
}

