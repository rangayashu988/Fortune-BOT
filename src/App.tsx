
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Linkedin,
  Loader2,
  LogOut,
  MapPin,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  User,
  Users,
  WandSparkles,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { ApplicationMaterial, Job, UserProfile } from './types';
import {
  AuthUser,
  generateCoverLetter,
  getAppState,
  forgotPassword,
  getCurrentUser,
  login,
  logout,
  resetPassword,
  saveAppState,
  searchJobs,
  signup,
} from './services/geminiService';
import { cn } from './lib/utils';

const emptyProfile: UserProfile = {
  name: '',
  email: '',
  resumeText: '',
  targetRoles: [],
  preferredLocations: [],
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'search' | 'profile' | 'applications'>('search');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', token: '' });
  const [resetHint, setResetHint] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [profile, setProfile] = useState<UserProfile>(emptyProfile);
  const [searchQuery, setSearchQuery] = useState('');
  const [targetRolesInput, setTargetRolesInput] = useState('');
  const [preferredLocationsInput, setPreferredLocationsInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [timeFilter, setTimeFilter] = useState<'24h' | 'currentWeek' | 'pastWeek' | '10d'>('24h');
  const [applications, setApplications] = useState<ApplicationMaterial[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [isGeneratingLetter, setIsGeneratingLetter] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);

  const selectedApplication = applications.find((application) => application.id === selectedApplicationId) ?? null;
  const filteredJobs = jobs.filter((job) => matchesTimeFilter(job.postedDate, timeFilter));

  useEffect(() => {
    async function bootstrap() {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch {
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setProfile(emptyProfile);
      setTargetRolesInput('');
      setPreferredLocationsInput('');
      setSearchHistory([]);
      setApplications([]);
      setSelectedApplicationId(null);
      setJobs([]);
      return;
    }

    let cancelled = false;
    setIsBootstrapping(true);
    setWorkspaceError(null);

    async function loadState() {
      try {
        const state = await getAppState();
        if (cancelled) return;
        setProfile({ ...state.profile, email: currentUser.email, name: state.profile.name || currentUser.name });
        setTargetRolesInput(state.profile.targetRoles.join(', '));
        setPreferredLocationsInput(state.profile.preferredLocations.join(', '));
        setSearchHistory(state.searchHistory);
        setApplications(state.applications);
        setSelectedApplicationId(state.applications[0]?.id ?? null);
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError((error as Error).message);
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  async function persistWorkspace(partial: Partial<{ profile: UserProfile; searchHistory: string[] }>) {
    const nextProfile = partial.profile ? { ...partial.profile, email: currentUser?.email ?? partial.profile.email } : undefined;
    const response = await saveAppState({ profile: nextProfile, searchHistory: partial.searchHistory });
    setProfile(response.profile);
    setSearchHistory(response.searchHistory);
    setApplications(response.applications);
    setSelectedApplicationId((current) => current ?? response.applications[0]?.id ?? null);
    return response;
  }

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);
    setResetHint(null);
    try {
      if (authMode === 'forgot') {
        const result = await forgotPassword({ email: authForm.email });
        setResetHint(result.resetToken ? `Reset token: ${result.resetToken}` : result.message);
        if (result.resetToken) {
          setAuthMode('reset');
          setAuthForm((current) => ({ ...current, token: result.resetToken, password: '' }));
        }
      } else {
        const user = authMode === 'login'
          ? await login({ email: authForm.email, password: authForm.password })
          : authMode === 'signup'
            ? await signup({ name: authForm.name, email: authForm.email, password: authForm.password })
            : await resetPassword({ token: authForm.token, password: authForm.password });
        setCurrentUser(user);
        setAuthForm({ name: '', email: user.email, password: '', token: '' });
      }
    } catch (error) {
      setAuthError((error as Error).message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
    setAuthMode('login');
    setAuthForm({ name: '', email: '', password: '', token: '' });
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    setWorkspaceError(null);
    try {
      await persistWorkspace({
        profile: {
          ...profile,
          email: currentUser?.email ?? profile.email,
          targetRoles: splitValues(targetRolesInput),
          preferredLocations: splitValues(preferredLocationsInput),
        },
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (error) {
      setWorkspaceError((error as Error).message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSearch = async (event?: React.FormEvent, forcedQuery?: string) => {
    event?.preventDefault();
    const effectiveQuery = (forcedQuery ?? searchQuery).trim();
    if (!effectiveQuery || !currentUser) return;

    const newHistory = [effectiveQuery, ...searchHistory.filter((query) => query !== effectiveQuery)].slice(0, 6);
    setSearchHistory(newHistory);
    try {
      await persistWorkspace({ profile: { ...profile, email: currentUser.email }, searchHistory: newHistory });
    } catch (error) {
      setWorkspaceError((error as Error).message);
    }

    setIsSearching(true);
    try {
      const results = await searchJobs(effectiveQuery, { ...profile, email: currentUser.email });
      const jobsWithStatus = results.map((job) => ({ ...job, verificationStatus: 'verifying' as const }));
      setJobs(jobsWithStatus);

      jobsWithStatus.forEach(async (job) => {
        try {
          const portalResponse = await fetch('/api/verify-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: job.url }),
          });
          const portalData = await portalResponse.json();
          setJobs((previous) => previous.map((item) => item.id === job.id ? { ...item, verificationStatus: portalData.isDead ? 'dead' : 'live' } : item));
        } catch (error) {
          console.error('Portal verification failed', error);
        }

        if (job.linkedinUrl) {
          try {
            setJobs((previous) => previous.map((item) => item.id === job.id ? { ...item, linkedinVerificationStatus: 'verifying' as const } : item));
            const linkedinResponse = await fetch('/api/verify-link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: job.linkedinUrl }),
            });
            const linkedinData = await linkedinResponse.json();
            setJobs((previous) => previous.map((item) => item.id === job.id ? { ...item, linkedinVerificationStatus: linkedinData.isDead ? 'dead' : 'live' } : item));
          } catch (error) {
            console.error('LinkedIn verification failed', error);
          }
        }
      });
    } catch (error) {
      setWorkspaceError((error as Error).message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleGenerateLetter = async (job: Job) => {
    if (!currentUser) return;
    setIsGeneratingLetter(true);
    setWorkspaceError(null);
    try {
      const application = await generateCoverLetter(job, { ...profile, email: currentUser.email });
      setApplications((current) => [application, ...current.filter((item) => item.id !== application.id)]);
      setSelectedApplicationId(application.id);
      setActiveTab('applications');
    } catch (error) {
      setWorkspaceError((error as Error).message);
    } finally {
      setIsGeneratingLetter(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      setSearchHistory([]);
      await persistWorkspace({ profile, searchHistory: [] });
    } catch (error) {
      setWorkspaceError((error as Error).message);
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 2500);
  };
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3">
          <Loader2 className="animate-spin" size={18} />
          <span className="text-sm font-semibold">Loading session...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.30),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(251,146,60,0.18),_transparent_24%),radial-gradient(circle_at_bottom_left,_rgba(34,197,94,0.16),_transparent_20%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-4 py-8 text-white md:px-8">
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-8 xl:grid-cols-[1.1fr_520px] xl:items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
              <ShieldCheck size={14} /> AI recruiting operator
            </div>
            <div>
              <h1 className="max-w-3xl text-5xl font-semibold leading-tight tracking-tight md:text-6xl">Sign in to your AI job-search bot and keep every search, draft, and candidate workflow in one secure workspace.</h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">FortuneBot remembers candidate context, hunts relevant openings, verifies outbound links, and prepares application drafts without exposing the model key in the browser.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <AuthMetric label="Bot Memory" value="Saved per user" />
              <AuthMetric label="Security" value="Server-side auth" />
              <AuthMetric label="Workflow" value="Search to apply" />
            </div>
          </div>

          <div className="rounded-[36px] border border-white/10 bg-[linear-gradient(180deg,_rgba(255,255,255,0.16),_rgba(255,255,255,0.08))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl md:p-8">
            <div className="flex rounded-2xl border border-white/10 bg-slate-950/50 p-1">
              <AuthTab active={authMode === 'login'} onClick={() => { setAuthMode('login'); setResetHint(null); }} label="Login" />
              <AuthTab active={authMode === 'signup'} onClick={() => { setAuthMode('signup'); setResetHint(null); }} label="Sign Up" />
            </div>

            <form onSubmit={handleAuthSubmit} className="mt-6 space-y-4">
              {authMode === 'signup' && (
                <AuthField label="Full Name" value={authForm.name} onChange={(value) => setAuthForm((current) => ({ ...current, name: value }))} placeholder="Ava Thompson" />
              )}
              {(authMode === 'login' || authMode === 'signup' || authMode === 'forgot') && (
                <AuthField label="Email" type="email" value={authForm.email} onChange={(value) => setAuthForm((current) => ({ ...current, email: value }))} placeholder="ava@company.com" />
              )}
              {authMode === 'reset' && (
                <AuthField label="Reset Token" value={authForm.token} onChange={(value) => setAuthForm((current) => ({ ...current, token: value }))} placeholder="Paste your reset token" />
              )}
              {authMode !== 'forgot' && (
                <AuthField label="Password" type="password" value={authForm.password} onChange={(value) => setAuthForm((current) => ({ ...current, password: value }))} placeholder={authMode === 'reset' ? 'Create a new password' : 'At least 8 characters'} />
              )}

              {authError && <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{authError}</div>}
              {resetHint && <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">{resetHint}</div>}

              <button type="submit" disabled={authSubmitting} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">
                {authSubmitting ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                {authMode === 'login' ? 'Login to Workspace' : authMode === 'signup' ? 'Create Account' : authMode === 'forgot' ? 'Generate Reset Token' : 'Reset Password'}
              </button>

              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <button type="button" onClick={() => { setAuthMode('forgot'); setAuthError(null); setResetHint(null); }} className="transition hover:text-cyan-200">Forgot password?</button>
                {authMode === 'forgot' || authMode === 'reset' ? (
                  <button type="button" onClick={() => { setAuthMode('login'); setAuthError(null); setResetHint(null); }} className="transition hover:text-cyan-200">Back to login</button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const heroMetrics = [
    { label: 'Operator', value: currentUser.name, icon: Users },
    { label: 'Tracked Searches', value: `${searchHistory.length}`, icon: Search },
    { label: 'Saved Applications', value: `${applications.length}`, icon: FileText },
  ];
  const workflowSteps = [
    { label: '1. Load memory', detail: 'Use the saved candidate profile, target roles, locations, and resume summary.' },
    { label: '2. Hunt roles', detail: 'Search openings, rank fit, and keep searches tied to the signed-in workspace.' },
    { label: '3. Verify links', detail: 'Check employer portals and LinkedIn routes before sending users out to apply.' },
    { label: '4. Draft applications', detail: 'Generate a cover letter and archive every application draft for reuse.' },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.18),_transparent_22%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.14),_transparent_24%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_42%,_#ecfeff_100%)] text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-6 px-4 py-4 md:px-6">
        <aside className="hidden w-[280px] shrink-0 flex-col rounded-[32px] border border-slate-900/80 bg-[linear-gradient(180deg,_#020617_0%,_#0b1120_38%,_#082f49_100%)] px-6 py-7 text-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 text-slate-950 shadow-lg shadow-cyan-500/25">
              <Sparkles size={22} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Talent Agent</p>
              <h1 className="text-2xl font-semibold tracking-tight">FortuneBot</h1>
            </div>
          </div>

          <div className="mt-10 space-y-2">
            <NavButton active={activeTab === 'search'} onClick={() => setActiveTab('search')} icon={<Search size={18} />} label="Search Studio" />
            <NavButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<User size={18} />} label="Candidate Profile" />
            <NavButton active={activeTab === 'applications'} onClick={() => setActiveTab('applications')} icon={<FileText size={18} />} label={`Applications${applications.length ? ` (${applications.length})` : ''}`} />
          </div>

          <div className="mt-10 rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Signed In</p>
            <p className="mt-3 text-lg font-semibold">{currentUser.name}</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{currentUser.email}</p>
          </div>

          <button onClick={() => void handleLogout()} className="mt-auto inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
            <LogOut size={16} /> Logout
          </button>
        </aside>

        <main className="flex-1 rounded-[32px] border border-white/70 bg-[linear-gradient(180deg,_rgba(255,255,255,0.86),_rgba(255,255,255,0.74))] shadow-[0_24px_80px_rgba(148,163,184,0.22)] backdrop-blur-xl">
          <div className="border-b border-slate-200/70 px-5 py-4 md:px-8">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-600">FortuneBot command center</p>
                <div className="mt-2 flex items-center gap-3 text-sm text-slate-500">
                  <span>Dashboard</span>
                  <ChevronRight size={14} />
                  <span className="font-medium capitalize text-slate-900">{activeTab}</span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] xl:min-w-[520px]">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Logged In</label>
                  <p className="mt-2 text-sm font-medium text-slate-900">{currentUser.email}</p>
                </div>
                <button onClick={handleShare} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-sky-200 hover:text-sky-700">
                  <Share2 size={16} /> Share
                </button>
              </div>
            </div>
          </div>
          <div className="px-5 py-6 md:px-8 md:py-8">
            <section className="rounded-[30px] border border-white/70 bg-[linear-gradient(135deg,_rgba(14,116,144,0.95),_rgba(30,64,175,0.96))] px-6 py-7 text-white shadow-[0_24px_60px_rgba(14,116,144,0.22)] md:px-8">
              <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-end">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100"><Star size={14} /> Recruiter-style AI workflow</div>
                  <h2 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">An AI bot that remembers the candidate, searches openings, verifies portals, and drafts applications.</h2>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-cyan-50/90 md:text-base">This workspace is built around the real FortuneBot loop: candidate memory in, ranked jobs out, verified links, then a generated application draft saved back to the user account.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  {heroMetrics.map((metric) => (
                    <div key={metric.label} className="rounded-3xl border border-white/12 bg-white/10 px-4 py-4 backdrop-blur">
                      <div className="flex items-center gap-2 text-cyan-100"><metric.icon size={16} /><span className="text-xs font-semibold uppercase tracking-[0.24em]">{metric.label}</span></div>
                      <p className="mt-4 text-xl font-semibold tracking-tight text-white">{metric.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {workflowSteps.map((step) => (
                  <div key={step.label} className="rounded-[24px] border border-white/12 bg-white/10 px-4 py-4 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100">{step.label}</p>
                    <p className="mt-3 text-sm leading-6 text-cyan-50/90">{step.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            {workspaceError && <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{workspaceError}</div>}
            {isBootstrapping && <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600"><Loader2 className="animate-spin" size={16} /> Loading your workspace...</div>}

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <StatusCard icon={<ShieldCheck size={18} />} label="Auth" value="Active session" tone="sky" />
              <StatusCard icon={<Briefcase size={18} />} label="Saved Materials" value={`${applications.length} active`} tone="amber" />
              <StatusCard icon={<TrendingUp size={18} />} label="Scale" value="Ready for teams" tone="emerald" />
            </div>

            <AnimatePresence mode="wait">
              {activeTab === 'search' && (
                <motion.section key="search" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="mt-8 space-y-6">
                  <div className="rounded-[30px] border border-slate-200/70 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.92))] p-5 shadow-sm md:p-6">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Bot Search Queue</p>
                        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Tell FortuneBot what role to hunt and it will turn profile memory into ranked matches</h3>
                      </div>
                      <div className="flex flex-wrap rounded-2xl border border-slate-200 bg-slate-50 p-1">
                        <FilterButton active={timeFilter === '24h'} onClick={() => setTimeFilter('24h')} label="Last 24h" />
                        <FilterButton active={timeFilter === 'currentWeek'} onClick={() => setTimeFilter('currentWeek')} label="Current Week" />
                        <FilterButton active={timeFilter === 'pastWeek'} onClick={() => setTimeFilter('pastWeek')} label="Past Week" />
                        <FilterButton active={timeFilter === '10d'} onClick={() => setTimeFilter('10d')} label="Past 10 Days" />
                      </div>
                    </div>

                    <form onSubmit={handleSearch} className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="relative rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-3 shadow-inner shadow-slate-200/40">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Senior Product Designer, AI Engineer, Talent Analytics Manager..." className="h-12 w-full bg-transparent pl-8 text-base text-slate-900 outline-none placeholder:text-slate-400" />
                      </div>
                      <button type="submit" disabled={isSearching} className="inline-flex items-center justify-center gap-2 rounded-[28px] bg-gradient-to-r from-sky-600 via-cyan-500 to-emerald-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50">
                        {isSearching ? <Loader2 size={18} className="animate-spin" /> : <WandSparkles size={18} />}
                        Search Jobs
                      </button>
                    </form>

                    {searchHistory.length > 0 && (
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400"><Clock size={13} /> Recent</span>
                        {searchHistory.map((item) => (
                          <button key={item} onClick={() => void handleSearch(undefined, item)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-sky-200 hover:text-sky-700">{item}</button>
                        ))}
                        <button onClick={() => void handleClearHistory()} className="ml-auto text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 transition hover:text-rose-500">Clear History</button>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-4">
                      {isSearching ? (
                        <div className="rounded-[30px] border border-dashed border-slate-300 bg-white/70 px-6 py-16 text-center text-slate-500"><Loader2 className="mx-auto animate-spin text-sky-600" size={32} /><p className="mt-4 font-medium">Scanning employer portals and ranking matches...</p></div>
                      ) : filteredJobs.length > 0 ? (
                        filteredJobs.map((job) => <JobCard key={job.id} job={job} onGenerate={() => void handleGenerateLetter(job)} onReportDead={() => setJobs((current) => current.filter((item) => item.id !== job.id))} isGenerating={isGeneratingLetter && selectedApplication?.job.id === job.id} />)
                      ) : (
                        <div className="rounded-[30px] border border-dashed border-slate-300 bg-white/70 px-6 py-16 text-center text-slate-500"><Briefcase className="mx-auto text-slate-300" size={34} /><p className="mt-4 text-lg font-semibold text-slate-900">The bot is waiting for a role query</p><p className="mt-2 text-sm">Type a role, then FortuneBot will search, score, verify, and prepare the next application workflow.</p></div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <InsightPanel title="How FortuneBot works" subtitle="Bot flow">
                        <ul className="space-y-3 text-sm leading-6 text-slate-600">
                          <li>Searches use candidate profile memory, not just the raw role query.</li>
                          <li>Every result is checked against the portal and optional LinkedIn path.</li>
                          <li>Prepare Application turns one selected role into a saved draft.</li>
                          <li>When Gemini is unavailable, the bot falls back gracefully instead of breaking the UI.</li>
                        </ul>
                      </InsightPanel>
                      <InsightPanel title="Why this workspace matters" subtitle="Operator view">
                        <ul className="space-y-3 text-sm leading-6 text-slate-600">
                          <li>Each signed-in user gets isolated state and saved applications.</li>
                          <li>The backend keeps secrets server-side so the browser never owns the model key.</li>
                          <li>The layout is designed to feel like a recruiting command console, not a generic form app.</li>
                        </ul>
                      </InsightPanel>
                    </div>
                  </div>
                </motion.section>
              )}
              {activeTab === 'profile' && (
                <motion.section key="profile" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="rounded-[30px] border border-slate-200/70 bg-white p-6 shadow-sm md:p-8">
                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Candidate Memory</p>
                    <h3 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">The memory bank FortuneBot uses before every search and application draft</h3>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">This workspace profile is the bot context layer. It follows the signed-in user and shapes search relevance, messaging, and saved application output.</p>

                    <div className="mt-8 grid gap-5 md:grid-cols-2">
                      <Field label="Full Name" value={profile.name} onChange={(value) => setProfile((current) => ({ ...current, name: value }))} placeholder="Ava Thompson" />
                      <Field label="Email Address" value={currentUser.email} onChange={() => {}} placeholder="" type="email" readOnly />
                      <Field label="Target Roles" value={targetRolesInput} onChange={setTargetRolesInput} placeholder="Product Designer, Growth PM" />
                      <Field label="Preferred Locations" value={preferredLocationsInput} onChange={setPreferredLocationsInput} placeholder="Remote, New York, London" />
                    </div>

                    <div className="mt-5">
                      <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Resume / Experience Summary</label>
                      <textarea value={profile.resumeText} onChange={(event) => setProfile((current) => ({ ...current, resumeText: event.target.value }))} placeholder="Paste the candidate summary, achievements, technical stack, and preferred company profile..." className="mt-3 h-72 w-full rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-sky-300" />
                    </div>

                    <div className="mt-6 flex items-center justify-end gap-4">
                      {saveSuccess && <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-600"><CheckCircle2 size={16} /> Profile saved</span>}
                      <button onClick={() => void handleSaveProfile()} disabled={isSavingProfile} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                        {isSavingProfile ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                        Save Profile
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <InsightPanel title="Login flow" subtitle="What was added">
                      <ul className="space-y-3 text-sm leading-6 text-slate-600">
                        <li>Dedicated sign in, sign up, forgot-password, and reset flows.</li>
                        <li>DB-backed sessions survive refreshes and protect per-user workspaces.</li>
                        <li>The profile here becomes the instruction set for the bot&apos;s downstream search and drafting behavior.</li>
                      </ul>
                    </InsightPanel>
                  </div>
                </motion.section>
              )}

              {activeTab === 'applications' && (
                <motion.section key="applications" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="mt-8 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                  <div className="rounded-[30px] border border-slate-200/70 bg-white p-5 shadow-sm">
                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Application Archive</p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Application drafts generated by FortuneBot</h3>
                    <div className="mt-5 space-y-3">
                      {applications.length > 0 ? applications.map((application) => (
                        <button key={application.id} onClick={() => setSelectedApplicationId(application.id)} className={cn('w-full rounded-[24px] border px-4 py-4 text-left transition', selectedApplicationId === application.id ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50')}>
                          <p className="font-semibold text-slate-950">{application.job.title}</p>
                          <p className="mt-1 text-sm text-slate-500">{application.job.company}</p>
                          <p className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-400">{new Date(application.createdAt).toLocaleString()}</p>
                        </button>
                      )) : (
                        <div className="rounded-[24px] border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">Run Prepare Application from the search tab and the bot will save the draft here.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[30px] border border-slate-200/70 bg-white shadow-sm overflow-hidden">
                    {selectedApplication ? (
                      <>
                        <div className="border-b border-slate-200 bg-slate-50 px-6 py-5 md:px-8">
                          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Selected draft</p>
                              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{selectedApplication.job.title}</h3>
                              <p className="mt-2 text-sm text-slate-500">{selectedApplication.job.company} • {selectedApplication.job.location}</p>
                            </div>
                            <button onClick={() => window.open(getApplyUrl(selectedApplication.job), '_blank')} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-sky-200 hover:text-sky-700">{getApplyLabel(selectedApplication.job)} <ExternalLink size={16} /></button>
                          </div>
                        </div>

                        <div className="px-6 py-6 md:px-8 md:py-8">
                          <div className="mb-6 flex items-center justify-between gap-4">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Generated cover letter</p>
                              <p className="mt-2 text-sm text-slate-500">Saved {new Date(selectedApplication.createdAt).toLocaleString()}</p>
                            </div>
                            <button onClick={() => navigator.clipboard.writeText(selectedApplication.coverLetter)} className="text-sm font-semibold text-sky-700 transition hover:text-sky-900">Copy to Clipboard</button>
                          </div>
                          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-6 text-slate-700">
                            <Markdown>{selectedApplication.coverLetter}</Markdown>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="px-6 py-20 text-center text-slate-500 md:px-8"><FileText className="mx-auto text-slate-300" size={34} /><p className="mt-4 text-lg font-semibold text-slate-900">No saved applications yet</p><p className="mt-2 text-sm">Generate a tailored application from the search screen and it will appear here.</p></div>
                    )}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      <AnimatePresence>
        {showShareToast && <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-2xl">Link copied to clipboard.</motion.div>}
      </AnimatePresence>
    </div>
  );
}
function splitValues(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function matchesTimeFilter(postedDateValue: string, filter: '24h' | 'currentWeek' | 'pastWeek' | '10d') {
  const postedDate = new Date(postedDateValue);
  if (Number.isNaN(postedDate.getTime())) return false;

  const now = new Date();
  const diffInMs = now.getTime() - postedDate.getTime();
  const diffInDays = diffInMs / (1000 * 60 * 60 * 24);
  const currentDay = now.getDay();
  const mondayOffset = currentDay === 0 ? 6 : currentDay - 1;
  const startOfCurrentWeek = new Date(now);
  startOfCurrentWeek.setHours(0, 0, 0, 0);
  startOfCurrentWeek.setDate(now.getDate() - mondayOffset);

  const startOfPastWeek = new Date(startOfCurrentWeek);
  startOfPastWeek.setDate(startOfCurrentWeek.getDate() - 7);

  if (filter === '24h') return diffInMs <= 1000 * 60 * 60 * 24;
  if (filter === 'currentWeek') return postedDate >= startOfCurrentWeek;
  if (filter === 'pastWeek') return postedDate >= startOfPastWeek && postedDate < startOfCurrentWeek;
  return diffInDays <= 10;
}

function isGenericPortalUrl(url: string) {
  return /\/jobs\/?$|\/careers\/?$|search-jobs|jobsearch|keywords=|search=|\/positions\/?\?|\/search\?|\bjobs\?/.test(url.toLowerCase());
}

function getApplyUrl(job: Job) {
  if (job.url && !isGenericPortalUrl(job.url)) return job.url;
  if (job.linkedinUrl) return job.linkedinUrl;
  return job.url;
}

function getApplyLabel(job: Job) {
  if (job.url && !isGenericPortalUrl(job.url)) return 'Apply Direct';
  if (job.linkedinUrl) return 'Open Best Match';
  return 'Open Job Search';
}

function AuthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/6 px-5 py-5 backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/70">{label}</p>
      <p className="mt-3 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function AuthTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button onClick={onClick} className={cn('flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition', active ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white')}>{label}</button>;
}

function AuthField({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</label>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-3 h-14 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-white outline-none transition focus:border-cyan-300" />
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button onClick={onClick} className={cn('flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition', active ? 'bg-white text-slate-950 shadow-lg shadow-slate-950/10' : 'text-slate-300 hover:bg-white/10 hover:text-white')}>{icon}<span>{label}</span></button>;
}

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button onClick={onClick} className={cn('rounded-2xl px-4 py-2 text-xs font-semibold transition', active ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900')}>{label}</button>;
}

function StatusCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: 'sky' | 'amber' | 'emerald' }) {
  const toneClasses = { sky: 'from-sky-100 to-cyan-50 text-sky-800 border-sky-200/70', amber: 'from-amber-100 to-orange-50 text-amber-800 border-amber-200/70', emerald: 'from-emerald-100 to-teal-50 text-emerald-800 border-emerald-200/70' }[tone];
  return <div className={cn('rounded-[28px] border bg-gradient-to-br px-5 py-5 shadow-sm', toneClasses)}><div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em]">{icon}<span>{label}</span></div><p className="mt-4 text-2xl font-semibold tracking-tight">{value}</p></div>;
}

function InsightPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="rounded-[30px] border border-slate-200/70 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{subtitle}</p><h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title}</h4><div className="mt-4">{children}</div></div>;
}

function Field({ label, value, onChange, placeholder, type = 'text', readOnly = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string; readOnly?: boolean }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{label}</label>
      <input type={type} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={cn('mt-3 h-14 w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300', readOnly && 'cursor-not-allowed text-slate-500')} />
    </div>
  );
}

function JobCard({ job, onGenerate, onReportDead, isGenerating }: { job: Job; onGenerate: () => void; onReportDead: () => void; isGenerating: boolean }) {
  const applyUrl = getApplyUrl(job);
  const applyLabel = getApplyLabel(job);
  return (
    <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[30px] border border-slate-200/70 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-cyan-50 text-sky-700"><Building2 size={24} /></div>
          <div>
            <h4 className="text-xl font-semibold tracking-tight text-slate-950">{job.title}</h4>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1"><Building2 size={14} /> {job.company}</span>
              <span className="inline-flex items-center gap-1"><MapPin size={14} /> {job.location}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Posted {job.postedDate}</span>
              {job.visaStatus && <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700"><Globe size={12} /> {job.visaStatus}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          {job.verificationStatus === 'verifying' && <Badge tone="sky"><Loader2 size={12} className="animate-spin" /> Verifying</Badge>}
          {job.verificationStatus === 'live' && <Badge tone="emerald"><CheckCircle2 size={12} /> Link Active</Badge>}
          {job.verificationStatus === 'dead' && <Badge tone="rose"><CheckCircle2 size={12} /> Link Dead</Badge>}
          <Badge tone="amber"><TrendingUp size={12} /> {job.matchScore ?? '--'}% Match</Badge>
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600"><span className="font-semibold text-slate-900">AI insight:</span> {job.matchReason}</div>

      <div className="mt-6 flex flex-col gap-4 border-t border-slate-200 pt-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-sm font-semibold">
          <a href={applyUrl} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1 transition', job.verificationStatus === 'dead' ? 'text-rose-600 hover:text-rose-700' : 'text-sky-700 hover:text-sky-900')}>{job.verificationStatus === 'dead' ? 'Apply link may be broken' : applyLabel} <ExternalLink size={14} /></a>
          {job.linkedinUrl ? (
            <a href={job.linkedinUrl} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1 transition', job.linkedinVerificationStatus === 'dead' ? 'text-rose-600 hover:text-rose-700' : 'text-[#0A66C2] hover:text-[#004182]')}>LinkedIn <Linkedin size={14} /></a>
          ) : (
            <a href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${job.title} ${job.company}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#0A66C2] transition hover:text-[#004182]">Search LinkedIn <Linkedin size={14} /></a>
          )}
          <button onClick={onReportDead} className="text-slate-400 transition hover:text-rose-500">Remove</button>
        </div>

        <button onClick={onGenerate} disabled={isGenerating} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-600 via-cyan-500 to-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50">{isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Prepare Application</button>
      </div>
    </motion.article>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'sky' | 'emerald' | 'rose' | 'amber' }) {
  const toneClasses = { sky: 'border-sky-200 bg-sky-50 text-sky-700', emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700', rose: 'border-rose-200 bg-rose-50 text-rose-700', amber: 'border-amber-200 bg-amber-50 text-amber-700' }[tone];
  return <div className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold', toneClasses)}>{children}</div>;
}







