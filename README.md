# Get-Orders

## Deploy to Vercel

Import this repository into Vercel and deploy from the project root. Vercel detects the Express app in `server.js`; `vercel.json` sends `/` to the bill page in `public/`.

Bill PDF downloads work without environment variables. Customer search requires PostgreSQL; set `DATABASE_URL` in the Vercel project's Environment Variables if that feature is enabled, then redeploy.

For local development, run `npm install` and `npm start`.