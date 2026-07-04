Security: Environment variables and secrets

- Purpose: explain how to use `.env.example` and keep `.env` private.

1. Never commit `.env` to version control. The repository already lists `.env` in `.gitignore`.

2. To create a local environment file from the template:

   - Unix / macOS:
     ```bash
     cp .env.example .env
     ```

   - Windows PowerShell:
     ```powershell
     Copy-Item .env.example .env
     ```

3. For production, do NOT use a checked-in `.env` file. Use a secrets manager (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, or GitHub Actions secrets) and inject environment variables at deploy time.

4. If `.env` was ever committed accidentally:
   - Rotate secrets immediately (API keys, database passwords, session secrets).
   - Remove the file from the repo history using `git filter-repo` or `git filter-branch` and push force only after coordinating with your team.

5. Recommended quick steps for this repo:
   - Keep `.env` local and private (already ignored).
   - Fill `.env.example` with placeholder values and commit it (safe to share).
   - Add a deployment checklist that documents required environment variables and their purpose.

6. When you're ready, I can:
   - Create a `.env.example` cleanup if you want (remove any real values).
   - Produce a short script to validate required env variables at server startup.
