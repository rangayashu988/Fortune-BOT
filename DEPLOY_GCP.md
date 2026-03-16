# Google Cloud Run Deployment

This app is ready to deploy to Google Cloud Run for project `gen-lang-client-0357551927`.

## Recommended architecture

- Cloud Run: web app + API
- Cloud SQL for PostgreSQL: primary multi-user database
- Secret Manager: Gemini API key and session secret
- Artifact Registry: container storage

## 1. Set your gcloud project

```bash
gcloud config set project gen-lang-client-0357551927
```

## 2. Enable required services

```bash
gcloud services enable run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com
```

## 3. Create Cloud SQL Postgres

Replace values if you want different names/passwords.

```bash
gcloud sql instances create fortune-bot-db \
  --database-version=POSTGRES_16 \
  --cpu=1 \
  --memory=3840MB \
  --region=us-central1

gcloud sql databases create fortune_bot --instance=fortune-bot-db

gcloud sql users create fortune_bot_user \
  --instance=fortune-bot-db \
  --password=CHANGE_THIS_PASSWORD
```

Get the instance connection name:

```bash
gcloud sql instances describe fortune-bot-db --format="value(connectionName)"
```

It will look like:

```text
gen-lang-client-0357551927:us-central1:fortune-bot-db
```

## 4. Create secrets

```bash
printf "YOUR_GEMINI_API_KEY" | gcloud secrets create fortune-bot-gemini-key --data-file=-
printf "YOUR_LONG_RANDOM_SESSION_SECRET" | gcloud secrets create fortune-bot-session-secret --data-file=-
printf "postgresql://fortune_bot_user:CHANGE_THIS_PASSWORD@/fortune_bot?host=/cloudsql/INSTANCE_CONNECTION_NAME" | gcloud secrets create fortune-bot-database-url --data-file=-
```

Important:
Replace `INSTANCE_CONNECTION_NAME` with the value from step 3.

## 5. Deploy to Cloud Run

```bash
gcloud run deploy fortune-bot \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances INSTANCE_CONNECTION_NAME \
  --set-env-vars NODE_ENV=production,PGSSL=disable \
  --set-secrets GEMINI_API_KEY=fortune-bot-gemini-key:latest,SESSION_SECRET=fortune-bot-session-secret:latest,DATABASE_URL=fortune-bot-database-url:latest
```

## 6. Open the app

```bash
gcloud run services describe fortune-bot \
  --region us-central1 \
  --format='value(status.url)'
```

## Notes

- Cloud Run automatically injects `PORT`, and the server is already configured for that.
- In production you should use PostgreSQL, not SQLite.
- If Gemini quota is exhausted, the app still serves realistic fallback search results and fallback application generation.
- For stronger auth later, add email verification and password reset emails.
