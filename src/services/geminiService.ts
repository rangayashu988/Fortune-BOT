import { GoogleGenAI } from "@google/genai";
import { Job, UserProfile } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function searchJobs(query: string, profile: UserProfile): Promise<Job[]> {
  const currentDate = new Date().toISOString().split('T')[0];
  const prompt = `
    You are a high-precision job search assistant. Your goal is to find REAL, CURRENTLY ACTIVE job postings at Forbes Global 2000 companies.
    
    STRICT VERIFICATION PROTOCOL:
    1. Use Google Search to find the most recent job listings on OFFICIAL career portals of Forbes Global 2000 companies.
    2. ONLY return jobs that are currently live and accepting applications. 
    3. MANDATORY: You must verify that the URL is NOT a dead link or a 404 page. If you cannot confirm the link is active, DO NOT include the job.
    4. DO NOT include jobs from 3rd party aggregators (like Indeed or LinkedIn) unless they link directly to the official company portal.
    5. VERIFY the URL is a direct, permanent link to the specific job posting.
    6. If a job was posted more than 14 days ago, it is highly likely to be stale. Only include it if you can confirm it is still active.
    7. Ensure the 'postedDate' is as accurate as possible.
    
    Search Criteria:
    Role: ${query}
    Target Roles: ${profile.targetRoles.join(", ")}
    Preferred Locations: ${profile.preferredLocations.join(", ")}
    Current Date: ${currentDate}
    
    Return a JSON array of jobs with: title, company, location, url, linkedinUrl (optional), postedDate (YYYY-MM-DD), matchScore (0-100), matchReason, and visaStatus (e.g., "Sponsorship Available", "No Sponsorship", or "Not Specified").
    
    Resume summary for matching:
    ${profile.resumeText.substring(0, 1000)}...
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            company: { type: "STRING" },
            location: { type: "STRING" },
            url: { type: "STRING" },
            linkedinUrl: { type: "STRING" },
            postedDate: { type: "STRING", description: "Date in YYYY-MM-DD format" },
            matchScore: { type: "NUMBER" },
            matchReason: { type: "STRING" },
            visaStatus: { type: "STRING", description: "Visa sponsorship status" }
          },
          required: ["title", "company", "url", "postedDate"]
        }
      }
    },
  });

  try {
    const jobs = JSON.parse(response.text || "[]");
    return jobs.map((j: any, i: number) => ({
      ...j,
      id: `job-${i}-${Date.now()}`
    }));
  } catch (e) {
    console.error("Failed to parse jobs", e);
    return [];
  }
}

export async function generateCoverLetter(job: Job, profile: UserProfile): Promise<string> {
  const prompt = `
    Write a professional and compelling cover letter for the following job:
    Job Title: ${job.title}
    Company: ${job.company}
    Location: ${job.location}
    
    Using the applicant's profile:
    Name: ${profile.name}
    Resume: ${profile.resumeText}
    
    The letter should be tailored to the specific company and role, highlighting relevant skills from the resume.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  return response.text || "Failed to generate cover letter.";
}
