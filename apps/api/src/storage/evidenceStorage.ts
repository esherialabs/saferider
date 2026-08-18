import { createHash, randomUUID } from 'node:crypto';
import { Client, IamAwsProvider, type ClientOptions } from 'minio';

import { env } from '../config/env.js';

const endpointUrl = new URL(env.s3Endpoint);
const publicEndpointUrl = new URL(env.s3PublicEndpoint);

type AwsCredentialResponse = {
  AccessKeyId?: string;
  AccessKeyID?: string;
  SecretAccessKey?: string;
  Token?: string;
  Expiration?: string;
};

type MinioCredentials = Awaited<ReturnType<IamAwsProvider['getCredentials']>>;

let cachedTaskRoleCredentials: {
  credentials: MinioCredentials;
  expiresAt: number;
} | null = null;

function ecsCredentialUrl(): URL | null {
  if (process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) {
    return new URL(process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, 'http://169.254.170.2');
  }

  if (process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
    return new URL(process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI);
  }

  return null;
}

const ecsTaskRoleCredentialProvider = {
  async getCredentials(): Promise<MinioCredentials> {
    const now = Date.now();
    if (cachedTaskRoleCredentials && cachedTaskRoleCredentials.expiresAt - now > 30_000) {
      return cachedTaskRoleCredentials.credentials;
    }

    const url = ecsCredentialUrl();
    if (!url) {
      throw new Error('ECS task credential endpoint is unavailable');
    }

    const headers: Record<string, string> = {};
    if (process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN) {
      headers.Authorization = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`ECS task credential endpoint returned ${response.status}`);
    }

    const body = (await response.json()) as AwsCredentialResponse;
    const accessKey = body.AccessKeyId ?? body.AccessKeyID;
    if (!accessKey || !body.SecretAccessKey) {
      throw new Error('ECS task credential response is missing access keys');
    }

    const credentials = {
      getAccessKey: () => accessKey,
      getSecretKey: () => body.SecretAccessKey!,
      getSessionToken: () => body.Token,
    } as MinioCredentials;

    cachedTaskRoleCredentials = {
      credentials,
      expiresAt: body.Expiration ? new Date(body.Expiration).getTime() : now + 10 * 60 * 1000,
    };
    return cachedTaskRoleCredentials.credentials;
  },
};

function iamCredentialProvider(): ClientOptions['credentialsProvider'] {
  const ecsUrl = ecsCredentialUrl();
  return ecsUrl
    ? (ecsTaskRoleCredentialProvider as ClientOptions['credentialsProvider'])
    : new IamAwsProvider({});
}

function createStorageClient(url: URL): Client {
  const baseOptions = {
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    useSSL: url.protocol === 'https:',
    region: env.s3Region,
  };

  if (env.s3CredentialMode === 'iam') {
    return new Client({
      ...baseOptions,
      credentialsProvider: iamCredentialProvider(),
    });
  }

  return new Client({
    ...baseOptions,
    accessKey: env.s3AccessKeyId!,
    secretKey: env.s3SecretAccessKey!,
  });
}

export const minioClient = createStorageClient(endpointUrl);
const publicMinioClient = createStorageClient(publicEndpointUrl);

export function buildEvidenceObjectKey(): string {
  return `evidence/${randomUUID()}/${randomUUID()}`;
}

export async function createPresignedUploadPolicy(params: {
  objectKey: string;
  expirySeconds: number;
  mimeType: string;
  maxSizeBytes: number;
}): Promise<{ url: string; fields: Record<string, string> }> {
  const policy = publicMinioClient.newPostPolicy();
  policy.setBucket(env.s3Bucket);
  policy.setKey(params.objectKey);
  policy.setExpires(new Date(Date.now() + params.expirySeconds * 1000));
  policy.setContentType(params.mimeType);
  policy.setContentLengthRange(1, params.maxSizeBytes);

  const signed = await publicMinioClient.presignedPostPolicy(policy);
  return {
    url: signed.postURL,
    fields: Object.fromEntries(Object.entries(signed.formData).map(([key, value]) => [key, String(value)])),
  };
}

export async function createPresignedDownloadUrl(params: {
  objectKey: string;
  expirySeconds: number;
}): Promise<string> {
  return publicMinioClient.presignedGetObject(env.s3Bucket, params.objectKey, params.expirySeconds);
}

export async function deleteEvidenceObject(objectKey: string): Promise<void> {
  await minioClient.removeObject(env.s3Bucket, objectKey);
}

export async function hashStoredObject(objectKey: string): Promise<{ sha256: string; sizeBytes: number }> {
  const stream = await minioClient.getObject(env.s3Bucket, objectKey);
  const hash = createHash('sha256');
  let sizeBytes = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.length;
    hash.update(buffer);
  }

  return {
    sha256: hash.digest('hex'),
    sizeBytes,
  };
}
