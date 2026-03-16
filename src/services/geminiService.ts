import { AppState, ApplicationMaterial, Job, UserProfile } from '../types';

export type AuthUser = {
  email: string;
  name: string;
};

export type ForgotPasswordResult = {
  message: string;
  resetToken?: string;
  resetUrl?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData?.error) message = errorData.error;
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  return readJson<T>(response);
}

export function getCurrentUser(): Promise<AuthUser> {
  return requestJson<AuthUser>('/api/auth/me');
}

export function signup(payload: { name: string; email: string; password: string }): Promise<AuthUser> {
  return requestJson<AuthUser>('/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
}

export function login(payload: { email: string; password: string }): Promise<AuthUser> {
  return requestJson<AuthUser>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
}

export function logout(): Promise<void> {
  return requestJson<void>('/api/auth/logout', { method: 'POST' });
}

export function forgotPassword(payload: { email: string }): Promise<ForgotPasswordResult> {
  return requestJson<ForgotPasswordResult>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify(payload) });
}

export function resetPassword(payload: { token: string; password: string }): Promise<AuthUser> {
  return requestJson<AuthUser>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify(payload) });
}

export function getAppState(): Promise<AppState> {
  return requestJson<AppState>('/api/state');
}

export function saveAppState(payload: Partial<Pick<AppState, 'profile' | 'searchHistory'>>): Promise<AppState> {
  return requestJson<AppState>('/api/state', { method: 'PUT', body: JSON.stringify(payload) });
}

export function searchJobs(query: string, profile: UserProfile): Promise<Job[]> {
  return requestJson<Job[]>('/api/search-jobs', { method: 'POST', body: JSON.stringify({ query, profile }) });
}

export function generateCoverLetter(job: Job, profile: UserProfile): Promise<ApplicationMaterial> {
  return requestJson<ApplicationMaterial>('/api/generate-cover-letter', { method: 'POST', body: JSON.stringify({ job, profile }) });
}
