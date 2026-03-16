# FortuneBot

FortuneBot is a multi-user recruiting assistant with:

- login and session-based auth
- saved search history and applications
- AI-assisted job search and cover letters
- realistic fallback search/application generation when Gemini is unavailable
- PostgreSQL-ready persistence for production deployments

## Local development

1. Install dependencies:
   `npm install`
2. Create `.env` from [`.env.example`](C:/Users/vinod/OneDrive/Documents/New%20project/Fortune-BOT/.env.example)
3. Run the app:
   `npm run dev`

The app runs locally at `http://localhost:3000`.

## Production deployment

For Google Cloud Run deployment instructions, see [DEPLOY_GCP.md](./DEPLOY_GCP.md).
