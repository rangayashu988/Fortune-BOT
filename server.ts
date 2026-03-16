import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import express from 'express';
import bcrypt from 'bcryptjs';
import { GoogleGenAI } from '@google/genai';
import { Pool } from 'pg';
import { createServer as createViteServer } from 'vite';

dotenv.config();

type UserProfile = {
  name: string;
  email: string;
  resumeText: string;
  targetRoles: string[];
  preferredLocations: string[];
};

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedDate: string;
  matchScore?: number;
  matchReason?: number | string;
  linkedinUrl?: string;
  visaStatus?: string;
};

type ApplicationMaterial = {
  id: string;
  job: Job;
  coverLetter: string;
  createdAt: string;
};

type AppState = {
  profile: UserProfile;
  searchHistory: string[];
  applications: ApplicationMaterial[];
};

type AuthUser = {
  email: string;
  name: string;
};

type UserRow = { email: string; name: string; password_hash: string };
type ProfileRow = { name: string | null; email: string | null; resume_text: string | null; target_roles_json: string | null; preferred_locations_json: string | null };
type SearchHistoryRow = { search_history_json: string | null };
type ApplicationRow = { id: string; job_json: string; cover_letter: string; created_at: string };
type SessionRow = { session_id: string; user_email: string; expires_at: string };
type PasswordResetRow = { token_hash: string; user_email: string; expires_at: string; used_at: string | null };

const SESSION_COOKIE = 'fortunebot_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RESET_TTL_MS = 1000 * 60 * 60;
const SESSION_SECRET = process.env.SESSION_SECRET || 'development-session-secret-change-me';
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
async function generateWithRetry<T>(operation: () => Promise<T>, retries = 3, delayMs = 1200): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const isRetryable = status === 429 || status === 503;
      if (!isRetryable || attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

const defaultProfile = (email = '', name = ''): UserProfile => ({ name, email, resumeText: '', targetRoles: [], preferredLocations: [] });

function normalizeProfile(profile?: Partial<UserProfile> | null): UserProfile {
  return {
    name: typeof profile?.name === 'string' ? profile.name : '',
    email: typeof profile?.email === 'string' ? profile.email : '',
    resumeText: typeof profile?.resumeText === 'string' ? profile.resumeText : '',
    targetRoles: Array.isArray(profile?.targetRoles)
      ? profile.targetRoles.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    preferredLocations: Array.isArray(profile?.preferredLocations)
      ? profile.preferredLocations.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
  };
}
function buildPortalSearchUrl(company: string, title: string) {
  const encodedTitle = encodeURIComponent(title);
  const companySearchUrls: Record<string, string> = {
    Salesforce: `https://careers.salesforce.com/en/jobs/?search=${encodedTitle}`,
    Accenture: `https://www.accenture.com/us-en/careers/jobsearch?jk=${encodedTitle}`,
    Deloitte: `https://apply.deloitte.com/careers/SearchJobs/${encodedTitle}`,
    PwC: `https://jobs.us.pwc.com/search-jobs/${encodedTitle}`,
    Cognizant: `https://careers.cognizant.com/us-en/jobs/?keywords=${encodedTitle}`,
    Capgemini: `https://www.capgemini.com/careers/?search=${encodedTitle}`,
    Amazon: `https://www.amazon.jobs/en/search?base_query=${encodedTitle}`,
    Microsoft: `https://jobs.careers.microsoft.com/global/en/search?q=${encodedTitle}`,
    'Capital One': `https://www.capitalonecareers.com/search-jobs?keywords=${encodedTitle}`,
    'JPMorgan Chase': `https://careers.jpmorgan.com/us/en/students/programs?search=${encodedTitle}`,
    Adobe: `https://careers.adobe.com/us/en/search-results?keywords=${encodedTitle}`,
    Airbnb: `https://careers.airbnb.com/positions/?search=${encodedTitle}`,
    Intuit: `https://jobs.intuit.com/search-jobs/${encodedTitle}`,
    Netflix: `https://jobs.netflix.com/search?q=${encodedTitle}`,
    Cisco: `https://jobs.cisco.com/jobs/SearchJobs/?21178=%5B${encodedTitle}%5D`,
    Oracle: `https://careers.oracle.com/jobs/#en/sites/jobsearch/jobs?keyword=${encodedTitle}`,
    ServiceNow: `https://careers.servicenow.com/jobs?keywords=${encodedTitle}`,
    IBM: `https://www.ibm.com/careers/search?field_keyword_18%5B0%5D=${encodedTitle}`,
    Infosys: `https://career.infosys.com/joblist?searchText=${encodedTitle}`
  };

  return companySearchUrls[company] || `https://www.google.com/search?q=${encodeURIComponent(`${company} ${title} careers`)}`;
}

function buildLinkedInJobUrl(company: string, title: string) {
  return `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${title} ${company}`)}`;
}
function buildMockJobs(query: string): Job[] {
  const normalized = query.trim().toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const seniority = normalized.includes('senior') ? 'Senior ' : normalized.includes('lead') ? 'Lead ' : normalized.includes('principal') ? 'Principal ' : '';
  const titleBase = query.trim() || 'Software Engineer';
  const inferredTitle = titleBase
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const preferredRemote = tokens.includes('remote');
  const crmFocused = normalized.includes('salesforce') || normalized.includes('crm');
  const dataFocused = normalized.includes('data') || normalized.includes('analyst');
  const frontendFocused = normalized.includes('frontend') || normalized.includes('react') || normalized.includes('ui');
  const companies = crmFocused
    ? [
        ['Salesforce', 'San Francisco, CA / Remote', 'https://careers.salesforce.com/en/jobs/', 'https://www.linkedin.com/company/salesforce/jobs/', 'Strong fit for Apex, Lightning, CRM automation, and enterprise workflow design.'],
        ['Accenture', 'Dallas, TX / Hybrid', 'https://www.accenture.com/us-en/careers/jobsearch', 'https://www.linkedin.com/company/accenture/jobs/', 'Consulting-heavy role aligned with Salesforce implementation and client-facing delivery.'],
        ['Deloitte', 'Atlanta, GA / Hybrid', 'https://apply.deloitte.com/careers', 'https://www.linkedin.com/company/deloitte/jobs/', 'Good match for Salesforce platform development, integrations, and release management.'],
        ['PwC', 'Chicago, IL / Remote', 'https://www.pwc.com/us/en/careers.html', 'https://www.linkedin.com/company/pwc/jobs/', 'Relevant to enterprise CRM transformation and cross-functional stakeholder work.'],
        ['Cognizant', 'Phoenix, AZ / Remote', 'https://careers.cognizant.com/global/en', 'https://www.linkedin.com/company/cognizant/jobs/', 'Strong alignment with customization, support, and enterprise system modernization.'],
        ['Capgemini', 'New York, NY / Hybrid', 'https://www.capgemini.com/careers/', 'https://www.linkedin.com/company/capgemini/jobs/', 'Relevant to cloud CRM delivery, integration design, and client project work.']
      ]
    : dataFocused
      ? [
          ['Amazon', 'Seattle, WA / Hybrid', 'https://www.amazon.jobs/', 'https://www.linkedin.com/company/amazon/jobs/', 'Strong fit for analytics, reporting, and large-scale data-driven decision support.'],
          ['Microsoft', 'Redmond, WA / Hybrid', 'https://jobs.careers.microsoft.com/', 'https://www.linkedin.com/company/microsoft/jobs/', 'Relevant to BI tooling, stakeholder dashboards, and production data workflows.'],
          ['Capital One', 'McLean, VA / Hybrid', 'https://www.capitalonecareers.com/', 'https://www.linkedin.com/company/capital-one/jobs/', 'Good match for experimentation, SQL-heavy analysis, and business insight generation.'],
          ['JPMorgan Chase', 'Plano, TX / Hybrid', 'https://careers.jpmorgan.com/', 'https://www.linkedin.com/company/jpmorgan/jobs/', 'Aligned with enterprise analytics, governance, and operational reporting.']
        ]
      : frontendFocused
        ? [
            ['Adobe', 'San Jose, CA / Hybrid', 'https://careers.adobe.com/us/en', 'https://www.linkedin.com/company/adobe/jobs/', 'Strong fit for design-system work, responsive UI delivery, and product-focused frontend development.'],
            ['Airbnb', 'San Francisco, CA / Remote', 'https://careers.airbnb.com/', 'https://www.linkedin.com/company/airbnb/jobs/', 'Relevant to React application development, performance optimization, and polished user experiences.'],
            ['Intuit', 'Mountain View, CA / Hybrid', 'https://jobs.intuit.com/', 'https://www.linkedin.com/company/intuit/jobs/', 'Good match for customer-facing web apps, experimentation, and accessible UI patterns.'],
            ['Netflix', 'Los Gatos, CA / Remote', 'https://jobs.netflix.com/', 'https://www.linkedin.com/company/netflix/jobs/', 'Aligned with modern frontend engineering, UI reliability, and product iteration.']
          ]
        : [
            ['Cisco', 'Austin, TX / Remote', 'https://jobs.cisco.com/', 'https://www.linkedin.com/company/cisco/jobs/', 'Good fit for platform engineering, integrations, and production application support.'],
            ['Oracle', 'Austin, TX / Hybrid', 'https://careers.oracle.com/', 'https://www.linkedin.com/company/oracle/jobs/', 'Relevant to enterprise applications, cloud platforms, and scalable business systems.'],
            ['ServiceNow', 'Santa Clara, CA / Hybrid', 'https://careers.servicenow.com/', 'https://www.linkedin.com/company/servicenow/jobs/', 'Strong match for workflow automation, internal tools, and business platform development.'],
            ['IBM', 'Raleigh, NC / Hybrid', 'https://www.ibm.com/careers', 'https://www.linkedin.com/company/ibm/jobs/', 'Aligned with enterprise delivery, cross-team collaboration, and system integration.'],
            ['Infosys', 'Richardson, TX / Remote', 'https://www.infosys.com/careers/', 'https://www.linkedin.com/company/infosys/jobs/', 'Good match for implementation work, modernization projects, and distributed teams.']
          ];

  const now = Date.now();
  const jobs = companies.map(([company, location, url, linkedinUrl, matchReason], index) => {
    const postedDate = new Date(now - index * 1000 * 60 * 60 * 14).toISOString().split('T')[0];
    const title = crmFocused && !normalized.includes('developer')
      ? `${seniority}Salesforce Developer`
      : `${seniority}${inferredTitle}`;

    return {
      id: `mock-job-${index}-${now}`,
      title,
      company,
      location: preferredRemote ? location.replace('/ Hybrid', '/ Remote') : location,
      url: buildPortalSearchUrl(company, title),
      postedDate,
      matchScore: Math.max(76, 96 - index * 4),
      matchReason,
      linkedinUrl: buildLinkedInJobUrl(company, title),
      visaStatus: index % 2 === 0 ? 'Not Specified' : 'Check posting'
    };
  });

  return jobs;
}

function buildMockCoverLetter(job: Job, profile: UserProfile) {
  const name = profile.name || 'Candidate';
  return `Dear Hiring Team,\n\nI am excited to apply for the ${job.title} role at ${job.company}. My background aligns well with enterprise application delivery, cross-functional collaboration, and building reliable user-focused solutions.\n\nBased on my experience, I can contribute quickly to platform customization, integrations, and scalable workflow improvements. I am especially interested in this opportunity because ${job.company} is known for strong product execution and customer impact.\n\nThank you for your time and consideration. I would welcome the chance to discuss how my background can support your team.\n\nSincerely,\n${name}`;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function ensureUserEmail(value?: string) {
  const email = normalizeEmail(value ?? '');
  if (!email) throw new Error('A valid email is required.');
  return email;
}

function ensurePassword(value?: string) {
  const password = value ?? '';
  if (password.length < 8) throw new Error('Password must be at least 8 characters long.');
  return password;
}

function signSessionId(sessionId: string) {
  return createHmac('sha256', SESSION_SECRET).update(sessionId).digest('hex');
}

function encodeSessionCookie(sessionId: string) {
  return `${sessionId}.${signSessionId(sessionId)}`;
}

function decodeSessionCookie(value?: string) {
  if (!value) return null;
  const [sessionId, signature] = value.split('.');
  if (!sessionId || !signature) return null;
  const expected = signSessionId(sessionId);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) return null;
  return sessionId;
}

function parseCookies(cookieHeader?: string) {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const chunk of cookieHeader.split(';')) {
    const [name, ...rest] = chunk.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function setSessionCookie(res: express.Response, sessionId: string) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeSessionCookie(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res: express.Response) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
}

function hashResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

interface DataStore {
  init(): Promise<void>;
  getState(userEmail: string): Promise<AppState>;
  saveState(userEmail: string, profile: UserProfile, searchHistory: string[]): Promise<AppState>;
  saveApplication(userEmail: string, application: ApplicationMaterial): Promise<void>;
  createUser(user: AuthUser, passwordHash: string): Promise<void>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  updateUserPassword(email: string, passwordHash: string): Promise<void>;
  createSession(userEmail: string, expiresAt: string): Promise<string>;
  getSession(sessionId: string): Promise<SessionRow | null>;
  deleteSession(sessionId: string): Promise<void>;
  deleteSessionsForUser(userEmail: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;
  createPasswordResetToken(userEmail: string, tokenHash: string, expiresAt: string): Promise<void>;
  getPasswordResetToken(tokenHash: string): Promise<PasswordResetRow | null>;
  markPasswordResetUsed(tokenHash: string): Promise<void>;
  deleteExpiredPasswordResetTokens(): Promise<void>;
}

class SqliteDataStore implements DataStore {
  private db = new Database(path.join(process.cwd(), 'fortune-bot.db'));

  async init() {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, user_email TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS password_reset_tokens (token_hash TEXT PRIMARY KEY, user_email TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
      CREATE TABLE IF NOT EXISTS user_profiles (email TEXT PRIMARY KEY, name TEXT, resume_text TEXT, target_roles_json TEXT NOT NULL DEFAULT '[]', preferred_locations_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_search_history (email TEXT PRIMARY KEY, search_history_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, user_email TEXT NOT NULL, job_json TEXT NOT NULL, cover_letter TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_applications_user_email ON applications(user_email, created_at DESC);
    `);
  }

  async getState(userEmail: string): Promise<AppState> {
    const email = normalizeEmail(userEmail);
    const profileRow = this.db.prepare('SELECT name, email, resume_text, target_roles_json, preferred_locations_json FROM user_profiles WHERE email = ?').get(email) as ProfileRow | undefined;
    const userRow = this.db.prepare('SELECT email, name, password_hash FROM users WHERE email = ?').get(email) as UserRow | undefined;
    const historyRow = this.db.prepare('SELECT search_history_json FROM user_search_history WHERE email = ?').get(email) as SearchHistoryRow | undefined;
    const applicationRows = this.db.prepare('SELECT id, job_json, cover_letter, created_at FROM applications WHERE user_email = ? ORDER BY datetime(created_at) DESC').all(email) as ApplicationRow[];
    return {
      profile: profileRow ? { name: profileRow.name ?? userRow?.name ?? '', email: profileRow.email ?? email, resumeText: profileRow.resume_text ?? '', targetRoles: parseJsonArray(profileRow.target_roles_json), preferredLocations: parseJsonArray(profileRow.preferred_locations_json) } : defaultProfile(email, userRow?.name ?? ''),
      searchHistory: historyRow ? parseJsonArray(historyRow.search_history_json) : [],
      applications: applicationRows.map((row) => ({ id: row.id, job: JSON.parse(row.job_json) as Job, coverLetter: row.cover_letter, createdAt: row.created_at })),
    };
  }

  async saveState(userEmail: string, profile: UserProfile, searchHistory: string[]): Promise<AppState> {
    const email = normalizeEmail(userEmail);
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO user_profiles (email, name, resume_text, target_roles_json, preferred_locations_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, resume_text = excluded.resume_text, target_roles_json = excluded.target_roles_json, preferred_locations_json = excluded.preferred_locations_json, updated_at = excluded.updated_at`).run(email, profile.name, profile.resumeText, JSON.stringify(profile.targetRoles), JSON.stringify(profile.preferredLocations), now);
    this.db.prepare(`INSERT INTO user_search_history (email, search_history_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET search_history_json = excluded.search_history_json, updated_at = excluded.updated_at`).run(email, JSON.stringify(searchHistory), now);
    return this.getState(email);
  }

  async saveApplication(userEmail: string, application: ApplicationMaterial): Promise<void> {
    this.db.prepare('INSERT INTO applications (id, user_email, job_json, cover_letter, created_at) VALUES (?, ?, ?, ?, ?)').run(application.id, normalizeEmail(userEmail), JSON.stringify(application.job), application.coverLetter, application.createdAt);
  }

  async createUser(user: AuthUser, passwordHash: string): Promise<void> {
    this.db.prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)').run(normalizeEmail(user.email), user.name, passwordHash, new Date().toISOString());
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    return (this.db.prepare('SELECT email, name, password_hash FROM users WHERE email = ?').get(normalizeEmail(email)) as UserRow | undefined) ?? null;
  }

  async updateUserPassword(email: string, passwordHash: string): Promise<void> {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(passwordHash, normalizeEmail(email));
  }

  async createSession(userEmail: string, expiresAt: string): Promise<string> {
    const sessionId = randomUUID();
    this.db.prepare('INSERT INTO sessions (session_id, user_email, expires_at) VALUES (?, ?, ?)').run(sessionId, normalizeEmail(userEmail), expiresAt);
    return sessionId;
  }

  async getSession(sessionId: string): Promise<SessionRow | null> {
    return (this.db.prepare('SELECT session_id, user_email, expires_at FROM sessions WHERE session_id = ?').get(sessionId) as SessionRow | undefined) ?? null;
  }

  async deleteSession(sessionId: string): Promise<void> { this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId); }
  async deleteSessionsForUser(userEmail: string): Promise<void> { this.db.prepare('DELETE FROM sessions WHERE user_email = ?').run(normalizeEmail(userEmail)); }
  async deleteExpiredSessions(): Promise<void> { this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString()); }
  async createPasswordResetToken(userEmail: string, tokenHash: string, expiresAt: string): Promise<void> { this.db.prepare('INSERT OR REPLACE INTO password_reset_tokens (token_hash, user_email, expires_at, used_at) VALUES (?, ?, ?, NULL)').run(tokenHash, normalizeEmail(userEmail), expiresAt); }
  async getPasswordResetToken(tokenHash: string): Promise<PasswordResetRow | null> { return (this.db.prepare('SELECT token_hash, user_email, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash) as PasswordResetRow | undefined) ?? null; }
  async markPasswordResetUsed(tokenHash: string): Promise<void> { this.db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?').run(new Date().toISOString(), tokenHash); }
  async deleteExpiredPasswordResetTokens(): Promise<void> { this.db.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ?').run(new Date().toISOString()); }
}

class PostgresDataStore implements DataStore {
  private pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
  }
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, user_email TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS password_reset_tokens (token_hash TEXT PRIMARY KEY, user_email TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS user_profiles (email TEXT PRIMARY KEY, name TEXT, resume_text TEXT, target_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb, preferred_locations_json JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS user_search_history (email TEXT PRIMARY KEY, search_history_json JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, user_email TEXT NOT NULL, job_json JSONB NOT NULL, cover_letter TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS idx_applications_user_email ON applications(user_email, created_at DESC);
    `);
  }
  async getState(userEmail: string): Promise<AppState> {
    const email = normalizeEmail(userEmail);
    const [profileResult, userResult, historyResult, applicationsResult] = await Promise.all([
      this.pool.query('SELECT email, name, resume_text, target_roles_json::text AS target_roles_json, preferred_locations_json::text AS preferred_locations_json FROM user_profiles WHERE email = $1', [email]),
      this.pool.query('SELECT email, name, password_hash FROM users WHERE email = $1', [email]),
      this.pool.query('SELECT search_history_json::text AS search_history_json FROM user_search_history WHERE email = $1', [email]),
      this.pool.query('SELECT id, job_json::text AS job_json, cover_letter, created_at::text AS created_at FROM applications WHERE user_email = $1 ORDER BY created_at DESC', [email]),
    ]);
    const profileRow = profileResult.rows[0] as ProfileRow | undefined;
    const userRow = userResult.rows[0] as UserRow | undefined;
    const historyRow = historyResult.rows[0] as SearchHistoryRow | undefined;
    return {
      profile: profileRow ? { name: profileRow.name ?? userRow?.name ?? '', email: profileRow.email ?? email, resumeText: profileRow.resume_text ?? '', targetRoles: parseJsonArray(profileRow.target_roles_json), preferredLocations: parseJsonArray(profileRow.preferred_locations_json) } : defaultProfile(email, userRow?.name ?? ''),
      searchHistory: historyRow ? parseJsonArray(historyRow.search_history_json) : [],
      applications: applicationsResult.rows.map((row) => ({ id: row.id, job: JSON.parse(row.job_json) as Job, coverLetter: row.cover_letter, createdAt: row.created_at })),
    };
  }
  async saveState(userEmail: string, profile: UserProfile, searchHistory: string[]): Promise<AppState> {
    const email = normalizeEmail(userEmail);
    await this.pool.query(`INSERT INTO user_profiles (email, name, resume_text, target_roles_json, preferred_locations_json, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW()) ON CONFLICT(email) DO UPDATE SET name = EXCLUDED.name, resume_text = EXCLUDED.resume_text, target_roles_json = EXCLUDED.target_roles_json, preferred_locations_json = EXCLUDED.preferred_locations_json, updated_at = NOW()`, [email, profile.name, profile.resumeText, JSON.stringify(profile.targetRoles), JSON.stringify(profile.preferredLocations)]);
    await this.pool.query(`INSERT INTO user_search_history (email, search_history_json, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT(email) DO UPDATE SET search_history_json = EXCLUDED.search_history_json, updated_at = NOW()`, [email, JSON.stringify(searchHistory)]);
    return this.getState(email);
  }
  async saveApplication(userEmail: string, application: ApplicationMaterial): Promise<void> { await this.pool.query('INSERT INTO applications (id, user_email, job_json, cover_letter, created_at) VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)', [application.id, normalizeEmail(userEmail), JSON.stringify(application.job), application.coverLetter, application.createdAt]); }
  async createUser(user: AuthUser, passwordHash: string): Promise<void> { await this.pool.query('INSERT INTO users (email, name, password_hash, created_at) VALUES ($1, $2, $3, NOW())', [normalizeEmail(user.email), user.name, passwordHash]); }
  async getUserByEmail(email: string): Promise<UserRow | null> { return (await this.pool.query('SELECT email, name, password_hash FROM users WHERE email = $1', [normalizeEmail(email)])).rows[0] as UserRow ?? null; }
  async updateUserPassword(email: string, passwordHash: string): Promise<void> { await this.pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [passwordHash, normalizeEmail(email)]); }
  async createSession(userEmail: string, expiresAt: string): Promise<string> { const sessionId = randomUUID(); await this.pool.query('INSERT INTO sessions (session_id, user_email, expires_at) VALUES ($1, $2, $3::timestamptz)', [sessionId, normalizeEmail(userEmail), expiresAt]); return sessionId; }
  async getSession(sessionId: string): Promise<SessionRow | null> { return (await this.pool.query('SELECT session_id, user_email, expires_at::text AS expires_at FROM sessions WHERE session_id = $1', [sessionId])).rows[0] as SessionRow ?? null; }
  async deleteSession(sessionId: string): Promise<void> { await this.pool.query('DELETE FROM sessions WHERE session_id = $1', [sessionId]); }
  async deleteSessionsForUser(userEmail: string): Promise<void> { await this.pool.query('DELETE FROM sessions WHERE user_email = $1', [normalizeEmail(userEmail)]); }
  async deleteExpiredSessions(): Promise<void> { await this.pool.query('DELETE FROM sessions WHERE expires_at <= NOW()'); }
  async createPasswordResetToken(userEmail: string, tokenHash: string, expiresAt: string): Promise<void> { await this.pool.query('INSERT INTO password_reset_tokens (token_hash, user_email, expires_at, used_at) VALUES ($1, $2, $3::timestamptz, NULL) ON CONFLICT(token_hash) DO UPDATE SET user_email = EXCLUDED.user_email, expires_at = EXCLUDED.expires_at, used_at = NULL', [tokenHash, normalizeEmail(userEmail), expiresAt]); }
  async getPasswordResetToken(tokenHash: string): Promise<PasswordResetRow | null> { return (await this.pool.query('SELECT token_hash, user_email, expires_at::text AS expires_at, used_at::text AS used_at FROM password_reset_tokens WHERE token_hash = $1', [tokenHash])).rows[0] as PasswordResetRow ?? null; }
  async markPasswordResetUsed(tokenHash: string): Promise<void> { await this.pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1', [tokenHash]); }
  async deleteExpiredPasswordResetTokens(): Promise<void> { await this.pool.query('DELETE FROM password_reset_tokens WHERE expires_at <= NOW()'); }
}

const store: DataStore = process.env.DATABASE_URL ? new PostgresDataStore(process.env.DATABASE_URL) : new SqliteDataStore();

function requireAi(res: express.Response) { if (ai) return ai; res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' }); return null; }

async function getAuthenticatedUser(req: express.Request) {
  await store.deleteExpiredSessions();
  await store.deleteExpiredPasswordResetTokens();
  const sessionId = decodeSessionCookie(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!sessionId) return null;
  const session = await store.getSession(sessionId);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) { if (session) await store.deleteSession(sessionId); return null; }
  const user = await store.getUserByEmail(session.user_email);
  if (!user) { await store.deleteSession(sessionId); return null; }
  return { email: user.email, name: user.name, sessionId };
}

async function requireAuth(req: express.Request, res: express.Response) {
  const user = await getAuthenticatedUser(req);
  if (!user) { res.status(401).json({ error: 'You need to log in first.' }); return null; }
  return user;
}

function buildBasicJobSearchPrompt(query: string, profile: UserProfile) {
  const safeProfile = normalizeProfile(profile);
  return `You are a job matching assistant. Based on the role query and candidate profile, return realistic job matches as a JSON array.
Role query: ${query}
Target roles: ${safeProfile.targetRoles.join(', ') || 'Not specified'}
Preferred locations: ${safeProfile.preferredLocations.join(', ') || 'Not specified'}
Resume summary: ${safeProfile.resumeText.substring(0, 1000) || 'Not provided'}
Return only JSON with fields: title, company, location, url, postedDate, matchScore, matchReason, linkedinUrl, visaStatus.`;
}

async function searchJobsWithGemini(query: string, profile: UserProfile) {
  if (!ai) {
    return buildMockJobs(query);
  }

  try {
    const response = await generateWithRetry(() => ai.models.generateContent({
      model: geminiModel,
      contents: buildJobSearchPrompt(query, profile),
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: 'application/json'
      }
    }));
    const parsed = JSON.parse(response.text || '[]') as Omit<Job, 'id'>[];
    if (parsed.length > 0) {
      return parsed.map((job, index) => ({ ...job, id: `job-${index}-${Date.now()}` }));
    }
  } catch (searchError) {
    console.error('Tool-backed Gemini search failed, trying plain generation fallback', searchError);
  }

  try {
    const fallbackResponse = await generateWithRetry(() => ai.models.generateContent({
      model: geminiModel,
      contents: buildBasicJobSearchPrompt(query, profile),
      config: {
        responseMimeType: 'application/json'
      }
    }));
    const fallbackParsed = JSON.parse(fallbackResponse.text || '[]') as Omit<Job, 'id'>[];
    if (fallbackParsed.length > 0) {
      return fallbackParsed.map((job, index) => ({
        ...job,
        id: `job-fallback-${index}-${Date.now()}`,
        matchReason: job.matchReason || 'Generated from fallback Gemini search mode.'
      }));
    }
  } catch (fallbackError) {
    console.error('Plain Gemini search failed, using realistic fallback jobs', fallbackError);
  }

  return buildMockJobs(query);
}
function buildJobSearchPrompt(query: string, profile: UserProfile) {
  const safeProfile = normalizeProfile(profile);
  const currentDate = new Date().toISOString().split('T')[0];
  return `You are a high-precision job search assistant. Your goal is to find REAL, CURRENTLY ACTIVE job postings at Forbes Global 2000 companies.
Search Criteria:
Role: ${query}
Target Roles: ${safeProfile.targetRoles.join(', ') || 'Not specified'}
Preferred Locations: ${safeProfile.preferredLocations.join(', ') || 'Not specified'}
Current Date: ${currentDate}
Return a JSON array of jobs with: title, company, location, url, linkedinUrl (optional), postedDate (YYYY-MM-DD), matchScore (0-100), matchReason, and visaStatus.
Resume summary for matching:
${safeProfile.resumeText.substring(0, 1000) || 'Not provided'}...`;
}

function buildCoverLetterPrompt(job: Job, profile: UserProfile) {
  const safeProfile = normalizeProfile(profile);
  return `Write a professional and compelling cover letter for the following job:
Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Using the applicant's profile:
Name: ${safeProfile.name || 'Candidate'}
Resume: ${safeProfile.resumeText || 'No resume provided.'}`;
}

async function startServer() {
  await store.init();
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  app.get('/healthz', (_req, res) => { res.status(200).json({ ok: true }); });

  app.get('/api/auth/me', async (req, res) => {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ email: user.email, name: user.name });
  });

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const email = ensureUserEmail(req.body?.email);
      const name = String(req.body?.name ?? '').trim();
      const password = ensurePassword(req.body?.password);
      if (!name) return res.status(400).json({ error: 'Name is required.' });
      if (await store.getUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
      const passwordHash = await bcrypt.hash(password, 10);
      await store.createUser({ email, name }, passwordHash);
      await store.saveState(email, defaultProfile(email, name), []);
      const sessionId = await store.createSession(email, new Date(Date.now() + SESSION_TTL_MS).toISOString());
      setSessionCookie(res, sessionId);
      res.status(201).json({ email, name });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = ensureUserEmail(req.body?.email);
      const user = await store.getUserByEmail(email);
      if (!user || !(await bcrypt.compare(String(req.body?.password ?? ''), user.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
      const sessionId = await store.createSession(email, new Date(Date.now() + SESSION_TTL_MS).toISOString());
      setSessionCookie(res, sessionId);
      res.json({ email: user.email, name: user.name });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const sessionId = decodeSessionCookie(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (sessionId) await store.deleteSession(sessionId);
    clearSessionCookie(res);
    res.status(204).send();
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const email = ensureUserEmail(req.body?.email);
      const user = await store.getUserByEmail(email);
      const message = 'If an account exists for this email, a reset link has been generated.';
      if (!user) return res.json({ message });
      const rawToken = `${randomUUID()}${randomUUID()}`;
      const tokenHash = hashResetToken(rawToken);
      await store.createPasswordResetToken(email, tokenHash, new Date(Date.now() + RESET_TTL_MS).toISOString());
      res.json({ message, resetToken: rawToken, resetUrl: `/reset-password?token=${rawToken}` });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const token = String(req.body?.token ?? '').trim();
      const password = ensurePassword(req.body?.password);
      if (!token) return res.status(400).json({ error: 'Reset token is required.' });
      const tokenRow = await store.getPasswordResetToken(hashResetToken(token));
      if (!tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) return res.status(400).json({ error: 'This reset token is invalid or expired.' });
      const passwordHash = await bcrypt.hash(password, 10);
      await store.updateUserPassword(tokenRow.user_email, passwordHash);
      await store.markPasswordResetUsed(tokenRow.token_hash);
      await store.deleteSessionsForUser(tokenRow.user_email);
      const user = await store.getUserByEmail(tokenRow.user_email);
      if (!user) return res.status(404).json({ error: 'Account not found.' });
      const sessionId = await store.createSession(user.email, new Date(Date.now() + SESSION_TTL_MS).toISOString());
      setSessionCookie(res, sessionId);
      res.json({ email: user.email, name: user.name });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  app.get('/api/state', async (req, res) => { const user = await requireAuth(req, res); if (!user) return; res.json(await store.getState(user.email)); });
  app.put('/api/state', async (req, res) => { const user = await requireAuth(req, res); if (!user) return; const currentState = await store.getState(user.email); const nextProfile = req.body?.profile ? { ...(req.body.profile as UserProfile), email: user.email } : currentState.profile; const nextHistory = Array.isArray(req.body?.searchHistory) ? (req.body.searchHistory as string[]) : currentState.searchHistory; res.json(await store.saveState(user.email, nextProfile, nextHistory)); });

  app.post('/api/search-jobs', async (req, res) => {
    const user = await requireAuth(req, res); if (!user) return;
    const query = String(req.body?.query ?? '').trim(); if (!query) return res.status(400).json({ error: 'query is required' });
    const profile = { ...(req.body?.profile as UserProfile), email: user.email };
    try {
      res.json(await searchJobsWithGemini(query, profile));
    } catch (error) {
      const status = (error as { status?: number })?.status;
      console.error('Failed to search jobs', error);
      res.status(status === 429 || status === 503 ? 503 : 500).json({ error: status === 429 || status === 503 ? 'Gemini is temporarily busy. Please try the search again in a few moments.' : 'Failed to search jobs' });
    }
  });

  app.post('/api/generate-cover-letter', async (req, res) => {
    const user = await requireAuth(req, res); if (!user) return;
    const job = req.body?.job as Job | undefined; if (!job) return res.status(400).json({ error: 'job is required' });
    const profile = { ...(req.body?.profile as UserProfile), email: user.email };
    try {
      let coverLetter = buildMockCoverLetter(job, profile);
      if (ai) {
        try {
          coverLetter = (await generateWithRetry(() => ai.models.generateContent({ model: geminiModel, contents: buildCoverLetterPrompt(job, profile) }))).text || coverLetter;
        } catch (generationError) {
          console.error('Gemini cover letter generation failed, using realistic fallback', generationError);
        }
      }
      const application: ApplicationMaterial = { id: randomUUID(), job, coverLetter, createdAt: new Date().toISOString() };
      await store.saveApplication(user.email, application);
      res.json(application);
    } catch (error) { const status = (error as { status?: number })?.status; console.error('Failed to generate cover letter', error); res.status(status === 429 || status === 503 ? 503 : 500).json({ error: status === 429 || status === 503 ? 'Gemini is temporarily busy. Please try generating the application again in a moment.' : 'Failed to generate cover letter' }); }
  });

  app.post('/api/verify-link', async (req, res) => {
    const user = await requireAuth(req, res); if (!user) return;
    const url = String(req.body?.url ?? '').trim(); if (!url) return res.status(400).json({ error: 'URL is required' });
    const verify = async (targetUrl: string, method: string) => {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
      try { return await fetch(targetUrl, { method, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }, signal: controller.signal }); }
      finally { clearTimeout(timeout); }
    };
    try { let response = await verify(url, 'HEAD'); if (response.status === 405 || response.status === 403) response = await verify(url, 'GET'); res.json({ ok: response.ok, status: response.status, isDead: response.status === 404 }); }
    catch (error) { const err = error as Error & { name?: string }; console.error(`Error verifying link ${url}:`, err.name === 'AbortError' ? 'Timeout' : error); res.json({ ok: false, error: err.name === 'AbortError' ? 'Timeout' : 'Connection failed', isDead: err.name !== 'AbortError' }); }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else app.use(express.static('dist'));

  app.listen(PORT, '0.0.0.0', () => { console.log(`Server running on http://localhost:${PORT}`); console.log(process.env.DATABASE_URL ? 'Using PostgreSQL storage' : 'Using SQLite storage'); });
}

startServer();













