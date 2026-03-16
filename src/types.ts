export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description?: string;
  matchScore?: number;
  matchReason?: string;
  postedDate: string;
  verificationStatus?: 'verifying' | 'live' | 'dead';
  linkedinUrl?: string;
  linkedinVerificationStatus?: 'verifying' | 'live' | 'dead';
  visaStatus?: string;
}

export interface UserProfile {
  name: string;
  email: string;
  resumeText: string;
  targetRoles: string[];
  preferredLocations: string[];
}

export interface ApplicationMaterial {
  id: string;
  job: Job;
  coverLetter: string;
  createdAt: string;
}

export interface AppState {
  profile: UserProfile;
  searchHistory: string[];
  applications: ApplicationMaterial[];
}
