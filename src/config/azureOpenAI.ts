import { env } from './env';

export type AzureOpenAIConfig = {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
};

export const azureOpenAIConfig: AzureOpenAIConfig = {
  endpoint: env.azureOpenAI.endpoint ?? '',
  apiKey: '',
  deployment: env.azureOpenAI.deployment ?? '',
  apiVersion: env.azureOpenAI.apiVersion ?? '',
};

export function isAzureConfigured(): boolean {
  return false;
}
