import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Briefcase, 
  User, 
  FileText, 
  ExternalLink, 
  Loader2, 
  ChevronRight,
  TrendingUp,
  Building2,
  MapPin,
  Sparkles,
  CheckCircle2,
  Linkedin,
  Share2,
  Globe,
  Clock,
  X
} from 'lucide-react';
import { Job, UserProfile } from './types';
import { searchJobs, generateCoverLetter } from './services/geminiService';
import { cn } from './lib/utils';
import Markdown from 'react-markdown';

export default function App() {
  const [activeTab, setActiveTab] = useState<'search' | 'profile' | 'applications'>('search');
  const [profile, setProfile] = useState<UserProfile>({
    name: '',
    email: '',
    resumeText: '',
    targetRoles: [],
    preferredLocations: []
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [timeFilter, setTimeFilter] = useState<'all' | '24h' | 'older'>('all');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [coverLetter, setCoverLetter] = useState<string | null>(null);
  const [isGeneratingLetter, setIsGeneratingLetter] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  // Load profile and history from localStorage on mount
  useEffect(() => {
    const savedProfile = localStorage.getItem('fortunebot_profile');
    if (savedProfile) {
      try {
        setProfile(JSON.parse(savedProfile));
      } catch (e) {
        console.error("Failed to parse saved profile", e);
      }
    }

    const savedHistory = localStorage.getItem('fortunebot_history');
    if (savedHistory) {
      try {
        setSearchHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse search history", e);
      }
    }
  }, []);

  const handleSaveProfile = () => {
    setIsSavingProfile(true);
    localStorage.setItem('fortunebot_profile', JSON.stringify(profile));
    setTimeout(() => {
      setIsSavingProfile(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }, 600);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    
    // Update history
    const newHistory = [searchQuery, ...searchHistory.filter(q => q !== searchQuery)].slice(0, 5);
    setSearchHistory(newHistory);
    localStorage.setItem('fortunebot_history', JSON.stringify(newHistory));

    setIsSearching(true);
    try {
      const results = await searchJobs(searchQuery, profile);
      // Initialize with verifying status
      const jobsWithStatus = results.map(j => ({ ...j, verificationStatus: 'verifying' as const }));
      setJobs(jobsWithStatus);

      // Verify links in background
      jobsWithStatus.forEach(async (job) => {
        // Verify Portal Link
        try {
          const res = await fetch('/api/verify-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: job.url })
          });
          const data = await res.json();
          setJobs(prev => prev.map(j => 
            j.id === job.id 
              ? { ...j, verificationStatus: data.isDead ? 'dead' : 'live' } 
              : j
          ));
        } catch (e) {
          console.error("Portal verification failed for", job.url, e);
        }

        // Verify LinkedIn Link if provided
        if (job.linkedinUrl) {
          try {
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, linkedinVerificationStatus: 'verifying' } : j));
            const res = await fetch('/api/verify-link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: job.linkedinUrl })
            });
            const data = await res.json();
            setJobs(prev => prev.map(j => 
              j.id === job.id 
                ? { ...j, linkedinVerificationStatus: data.isDead ? 'dead' : 'live' } 
                : j
            ));
          } catch (e) {
            console.error("LinkedIn verification failed for", job.linkedinUrl, e);
          }
        }
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem('fortunebot_history');
  };

  const handleHistoryClick = (query: string) => {
    setSearchQuery(query);
    // Trigger search manually since we're not in a form submit event
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    handleSearch(fakeEvent);
  };

  const handleReportDeadLink = (jobId: string) => {
    setJobs(prev => prev.filter(j => j.id !== jobId));
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 3000);
  };

  const filteredJobs = jobs.filter(job => {
    if (timeFilter === 'all') return true;
    
    const postedDate = new Date(job.postedDate);
    const now = new Date();
    const diffInHours = (now.getTime() - postedDate.getTime()) / (1000 * 60 * 60);
    
    if (timeFilter === '24h') return diffInHours <= 24;
    if (timeFilter === 'older') return diffInHours > 24;
    return true;
  });

  const handleGenerateLetter = async (job: Job) => {
    setIsGeneratingLetter(true);
    setSelectedJob(job);
    try {
      const letter = await generateCoverLetter(job, profile);
      setCoverLetter(letter);
      setActiveTab('applications');
    } catch (error) {
      console.error(error);
    } finally {
      setIsGeneratingLetter(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {/* Sidebar */}
      <nav className="fixed left-0 top-0 h-full w-64 bg-white border-r border-[#E5E7EB] p-6 z-50">
        <div className="flex items-center gap-2 mb-10">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles className="text-white w-5 h-5" />
          </div>
          <h1 className="font-bold text-xl tracking-tight">FortuneBot</h1>
        </div>

        <div className="space-y-2">
          <NavButton 
            active={activeTab === 'search'} 
            onClick={() => setActiveTab('search')}
            icon={<Search size={18} />}
            label="Job Search"
          />
          <NavButton 
            active={activeTab === 'profile'} 
            onClick={() => setActiveTab('profile')}
            icon={<User size={18} />}
            label="My Profile"
          />
          <NavButton 
            active={activeTab === 'applications'} 
            onClick={() => setActiveTab('applications')}
            icon={<FileText size={18} />}
            label="Applications"
          />
        </div>

        <div className="absolute bottom-8 left-6 right-6">
          <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
            <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1">Forbes Global 2000 Focus</p>
            <p className="text-xs text-indigo-900/70 leading-relaxed">Currently monitoring 2,000+ career portals for new opportunities.</p>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pl-64 min-h-screen">
        <header className="h-16 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-md sticky top-0 z-40 px-8 flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-[#6B7280]">
            <span>Dashboard</span>
            <ChevronRight size={14} />
            <span className="text-[#1A1A1A] font-medium capitalize">{activeTab}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
              {profile.name ? profile.name[0] : '?'}
            </div>
          </div>
        </header>

        <div className="p-8 max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'search' && (
              <motion.div
                key="search"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Find your next big move</h2>
                    <p className="text-[#6B7280]">AI-powered search across Forbes Global 2000 career portals.</p>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={handleShare}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-[#E5E7EB] rounded-xl text-sm font-semibold hover:bg-[#F9FAFB] transition-colors shadow-sm"
                    >
                      <Share2 size={16} className="text-[#6B7280]" />
                      Share Tool
                    </button>
                    <div className="flex bg-white border border-[#E5E7EB] rounded-xl p-1 shadow-sm">
                      <FilterBtn 
                        active={timeFilter === 'all'} 
                        onClick={() => setTimeFilter('all')} 
                        label="All Time" 
                      />
                      <FilterBtn 
                        active={timeFilter === '24h'} 
                        onClick={() => setTimeFilter('24h')} 
                        label="Last 24h" 
                      />
                      <FilterBtn 
                        active={timeFilter === 'older'} 
                        onClick={() => setTimeFilter('older')} 
                        label="Older" 
                      />
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSearch} className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={20} />
                  <input 
                    type="text"
                    placeholder="Search by role (e.g. Senior Product Designer, AI Engineer)..."
                    className="w-full h-14 pl-12 pr-32 bg-white border border-[#E5E7EB] rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-lg"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <button 
                    type="submit"
                    disabled={isSearching}
                    className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSearching ? <Loader2 className="animate-spin" size={18} /> : 'Search'}
                  </button>
                </form>

                {searchHistory.length > 0 && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-bold text-[#9CA3AF] uppercase tracking-wider flex items-center gap-1">
                      <Clock size={12} /> Recent:
                    </span>
                    {searchHistory.map((query, i) => (
                      <button
                        key={i}
                        onClick={() => handleHistoryClick(query)}
                        className="px-3 py-1 bg-white border border-[#E5E7EB] rounded-full text-xs text-[#6B7280] hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm flex items-center gap-1 group"
                      >
                        {query}
                      </button>
                    ))}
                    <button 
                      onClick={handleClearHistory}
                      className="text-[10px] font-bold text-[#9CA3AF] hover:text-red-500 uppercase tracking-widest ml-auto"
                    >
                      Clear History
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4">
                  {isSearching ? (
                    <div className="py-20 flex flex-col items-center justify-center text-[#6B7280] gap-4">
                      <Loader2 className="animate-spin text-indigo-600" size={32} />
                      <p className="font-medium">Scanning Forbes Global 2000 portals...</p>
                    </div>
                  ) : filteredJobs.length > 0 ? (
                    filteredJobs.map((job) => (
                      <JobCard 
                        key={job.id} 
                        job={job} 
                        onGenerate={() => handleGenerateLetter(job)}
                        onReportDead={() => handleReportDeadLink(job.id)}
                        isGenerating={isGeneratingLetter && selectedJob?.id === job.id}
                      />
                    ))
                  ) : (
                    <div className="py-20 text-center border-2 border-dashed border-[#E5E7EB] rounded-3xl">
                      <div className="w-12 h-12 bg-[#F3F4F6] rounded-full flex items-center justify-center mx-auto mb-4">
                        <Briefcase className="text-[#9CA3AF]" size={24} />
                      </div>
                      <h3 className="font-semibold text-lg">No jobs found yet</h3>
                      <p className="text-[#6B7280]">Enter a role above to start searching Forbes Global 2000 portals.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'profile' && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold tracking-tight">Your Professional Profile</h2>
                  <p className="text-[#6B7280]">This information helps the AI match you to the best roles.</p>
                </div>

                <div className="bg-white border border-[#E5E7EB] rounded-3xl p-8 shadow-sm space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-[#374151]">Full Name</label>
                      <input 
                        type="text"
                        className="w-full h-12 px-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={profile.name}
                        onChange={(e) => setProfile({...profile, name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-[#374151]">Email Address</label>
                      <input 
                        type="email"
                        className="w-full h-12 px-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={profile.email}
                        onChange={(e) => setProfile({...profile, email: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-[#374151]">Target Roles (comma separated)</label>
                      <input 
                        type="text"
                        placeholder="e.g. Product Designer, Frontend Engineer"
                        className="w-full h-12 px-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={profile.targetRoles.join(", ")}
                        onChange={(e) => setProfile({...profile, targetRoles: e.target.value.split(",").map(s => s.trim())})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-[#374151]">Preferred Locations (comma separated)</label>
                      <input 
                        type="text"
                        placeholder="e.g. New York, Remote, London"
                        className="w-full h-12 px-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={profile.preferredLocations.join(", ")}
                        onChange={(e) => setProfile({...profile, preferredLocations: e.target.value.split(",").map(s => s.trim())})}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[#374151]">Resume / Experience Summary</label>
                    <textarea 
                      className="w-full h-64 p-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                      placeholder="Paste your resume text or a detailed summary of your experience..."
                      value={profile.resumeText}
                      onChange={(e) => setProfile({...profile, resumeText: e.target.value})}
                    />
                  </div>

                  <div className="flex justify-end items-center gap-4">
                    {saveSuccess && (
                      <motion.span 
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-emerald-600 text-sm font-semibold flex items-center gap-1"
                      >
                        <CheckCircle2 size={16} /> Profile saved successfully
                      </motion.span>
                    )}
                    <button 
                      onClick={handleSaveProfile}
                      disabled={isSavingProfile}
                      className="px-8 h-12 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {isSavingProfile ? <Loader2 className="animate-spin" size={18} /> : 'Save Profile'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'applications' && (
              <motion.div
                key="applications"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold tracking-tight">Application Materials</h2>
                  <p className="text-[#6B7280]">AI-generated materials for your selected roles.</p>
                </div>

                {selectedJob && coverLetter ? (
                  <div className="bg-white border border-[#E5E7EB] rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-[#E5E7EB] bg-[#F9FAFB] flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-lg">{selectedJob.title}</h3>
                        <p className="text-sm text-[#6B7280]">{selectedJob.company} • {selectedJob.location}</p>
                      </div>
                      <button 
                        onClick={() => window.open(selectedJob.url, '_blank')}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm font-semibold hover:bg-[#F3F4F6] transition-colors"
                      >
                        Apply on Portal <ExternalLink size={14} />
                      </button>
                    </div>
                    <div className="p-8 prose prose-indigo max-w-none">
                      <div className="flex items-center justify-between mb-6">
                        <h4 className="text-sm font-bold uppercase tracking-widest text-[#9CA3AF]">Generated Cover Letter</h4>
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(coverLetter);
                            alert('Copied to clipboard!');
                          }}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                        >
                          Copy to Clipboard
                        </button>
                      </div>
                      <div className="bg-[#F9FAFB] p-8 rounded-2xl border border-[#E5E7EB] font-serif leading-relaxed text-[#374151]">
                        <Markdown>{coverLetter}</Markdown>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-20 text-center border-2 border-dashed border-[#E5E7EB] rounded-3xl">
                    <div className="w-12 h-12 bg-[#F3F4F6] rounded-full flex items-center justify-center mx-auto mb-4">
                      <FileText className="text-[#9CA3AF]" size={24} />
                    </div>
                    <h3 className="font-semibold text-lg">No active applications</h3>
                    <p className="text-[#6B7280]">Search for jobs and click "Prepare Application" to see materials here.</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
      {/* Share Toast */}
      <AnimatePresence>
        {showShareToast && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#1A1A1A] text-white px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-2 text-sm font-medium"
          >
            <CheckCircle2 size={16} className="text-emerald-400" />
            Link copied to clipboard!
          </motion.div>
        )}
      </AnimatePresence>
      {/* Share Toast */}
      <AnimatePresence>
        {showShareToast && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#1A1A1A] text-white px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-2 text-sm font-medium"
          >
            <CheckCircle2 size={16} className="text-emerald-400" />
            Link copied to clipboard!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all",
        active 
          ? "bg-indigo-50 text-indigo-600 shadow-sm" 
          : "text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#1A1A1A]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function FilterBtn({ active, onClick, label }: { active: boolean, onClick: () => void, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
        active 
          ? "bg-indigo-600 text-white shadow-sm" 
          : "text-[#6B7280] hover:bg-[#F9FAFB]"
      )}
    >
      {label}
    </button>
  );
}

function JobCard({ job, onGenerate, onReportDead, isGenerating }: { job: Job, onGenerate: () => void, onReportDead: () => void, isGenerating: boolean }) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="group bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-4">
          <div className="w-12 h-12 bg-[#F3F4F6] rounded-xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
            <Building2 className="text-[#9CA3AF] group-hover:text-indigo-600" size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-lg leading-tight group-hover:text-indigo-600 transition-colors">{job.title}</h3>
            <div className="flex items-center gap-3 text-sm text-[#6B7280]">
              <span className="flex items-center gap-1"><Building2 size={14} /> {job.company}</span>
              <span className="flex items-center gap-1"><MapPin size={14} /> {job.location}</span>
              {job.visaStatus && (
                <span className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold",
                  job.visaStatus.toLowerCase().includes('available') || job.visaStatus.toLowerCase().includes('yes')
                    ? "bg-blue-50 text-blue-700 border border-blue-100"
                    : "bg-gray-100 text-gray-600 border border-gray-200"
                )}>
                  <Globe size={10} /> {job.visaStatus}
                </span>
              )}
              <span className="flex items-center gap-1 ml-2 px-2 py-0.5 bg-[#F3F4F6] rounded text-[10px] uppercase font-bold tracking-wider">
                Posted: {job.postedDate}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {job.verificationStatus === 'verifying' && (
              <div className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-bold flex items-center gap-1 border border-blue-100 animate-pulse">
                <Loader2 size={10} className="animate-spin" /> Verifying Link...
              </div>
            )}
            {job.verificationStatus === 'live' && (
              <div className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-bold flex items-center gap-1 border border-emerald-100">
                <CheckCircle2 size={10} /> Link Active
              </div>
            )}
            {job.verificationStatus === 'dead' && (
              <div className="px-2 py-0.5 bg-red-50 text-red-600 rounded text-[10px] font-bold flex items-center gap-1 border border-red-100">
                <CheckCircle2 size={10} className="rotate-45" /> Link Dead (404)
              </div>
            )}
            {!job.verificationStatus && (
              <div className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold flex items-center gap-1 border border-indigo-100">
                <CheckCircle2 size={10} /> Verified
              </div>
            )}
            <div className={cn(
              "px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1",
              job.matchScore && job.matchScore > 80 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            )}>
              <TrendingUp size={12} /> {job.matchScore}% Match
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 p-3 bg-[#F9FAFB] rounded-xl text-xs text-[#6B7280] leading-relaxed">
        <span className="font-bold text-[#374151]">AI Insight:</span> {job.matchReason}
      </div>

      <div className="mt-6 flex items-center justify-between pt-4 border-t border-[#F3F4F6]">
        <div className="flex items-center gap-4">
          <a 
            href={job.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className={cn(
              "text-sm font-semibold flex items-center gap-1",
              job.verificationStatus === 'dead' 
                ? "text-red-500 hover:text-red-600" 
                : "text-indigo-600 hover:text-indigo-700"
            )}
          >
            {job.verificationStatus === 'dead' ? 'Link (May be broken)' : 'View Portal'} <ExternalLink size={14} />
          </a>
          {job.linkedinUrl ? (
            <a 
              href={job.linkedinUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className={cn(
                "text-sm font-semibold flex items-center gap-1",
                job.linkedinVerificationStatus === 'dead' 
                  ? "text-red-500 hover:text-red-600" 
                  : "text-[#0A66C2] hover:text-[#004182]"
              )}
            >
              {job.linkedinVerificationStatus === 'dead' ? 'LinkedIn (May be broken)' : 'LinkedIn'} <Linkedin size={14} />
              {job.linkedinVerificationStatus === 'verifying' && <Loader2 size={10} className="animate-spin ml-1" />}
            </a>
          ) : (
            <a 
              href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${job.title} ${job.company}`)}`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm font-semibold text-[#0A66C2] hover:text-[#004182] flex items-center gap-1"
            >
              Search LinkedIn <Linkedin size={14} />
            </a>
          )}
          <button 
            onClick={onReportDead}
            className="text-xs text-[#9CA3AF] hover:text-red-500 transition-colors flex items-center gap-1"
          >
            Report Dead Link
          </button>
        </div>
        <button 
          onClick={onGenerate}
          disabled={isGenerating}
          className="px-5 py-2 bg-[#1A1A1A] text-white rounded-lg text-sm font-semibold hover:bg-black transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {isGenerating ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          Prepare Application
        </button>
      </div>
    </motion.div>
  );
}
