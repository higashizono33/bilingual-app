import { config } from '../config';
import type { Child, HistoryResponse } from '../types';

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, idToken: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${idToken}`,
      ...init.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as T;
}

export function listChildren(idToken: string): Promise<{ children: Child[] }> {
  return request('/children', idToken);
}

export function upsertChild(
  idToken: string,
  childId: string,
  data: { name?: string; birthdate?: string; photoKey?: string; sortOrder?: number },
): Promise<{ childId: string }> {
  return request(`/children/${encodeURIComponent(childId)}`, idToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function getHistory(idToken: string, childId: string): Promise<HistoryResponse> {
  return request(`/children/${encodeURIComponent(childId)}/history`, idToken);
}

interface PresignVideoRequest {
  kind: 'video';
  childId: string;
  date: string;
  lang: 'ja' | 'en';
  contentType: string;
  durationSec: number;
}

interface PresignPhotoRequest {
  kind: 'photo';
  photoChildId: string;
  contentType: string;
}

interface PresignResponse {
  uploadUrl: string;
  key: string;
  requiredHeaders: Record<string, string>;
}

export function presignUpload(
  idToken: string,
  req: PresignVideoRequest | PresignPhotoRequest,
): Promise<PresignResponse> {
  return request('/uploads/presign', idToken, { method: 'POST', body: JSON.stringify(req) });
}

/**
 * Presigned URLへS3直PUTアップロードする(要件定義書5.2章)。
 * XMLHttpRequestを使い、アップロード進捗(0-100)をonProgressで通知する。
 */
export function uploadToPresignedUrl(
  uploadUrl: string,
  blob: Blob,
  requiredHeaders: Record<string, string>,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    for (const [name, value] of Object.entries(requiredHeaders)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, `upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.send(blob);
  });
}
