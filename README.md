# MCS18 FYP: Web-based EEG Viewer, Annotator, and Feedback Recommendations

## 👥 Team Members

### **Core:**

- Jason Yeap Kang Sheng (34277579)
- Jota Nishimura (34303995)
- Kristofer Astro Aryapradipta (34091971)
- Prawin Raj (34506209)

### **Supervisor(s):**

- Dr. Jessie Leong Shu Min
- Dr. Low Yin Yin

## 📝 Project Description:

This Final Year project aims to develop a web-based platform to view and annotate EEG (electroencephalogram) files in `.edf` format as well as giving feedback recommendations using a pre-trained model based on the Siena EEG public dataset.

## 🚀 Features

- View EEG recordings from `.edf` files in the browser
- Annotate EEG signals
- Store `.edf` recordings and `.pdf` reports per user (Supabase Auth + Storage)
- Feedback recommendations from a pre-trained model (Siena EEG dataset)

## ⚙️ Technical Stack


| Category       | Libraries / Frameworks                 |
| -------------- | -------------------------------------- |
| Frontend       | Next.js, React, TailwindCSS            |
| Backend / data | Supabase (Auth, Postgres, Storage)     |
| Model          | Python, pre-trained model on Siena EEG |
| Deployment     | Frontend - Vercel                      |


FastAPI is not used in the current scope.

## 📦 Project Structure

```
web-app/
└─ frontend/          # Next.js app (viewer, annotator, auth)
supabase/
└─ schema.sql         # Auth-backed file metadata + storage policies
```

## 🔐 Supabase Setup (Auth + Files)

1. Create a Supabase project.
2. **Authentication → Providers**
  - Enable **Email** (email + password).
  - Enable **Google**. In Google Cloud, create an OAuth client and set the redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`. Add `http://localhost:3000/auth/callback` (and the production URL) under Supabase **Redirect URLs**.
3. Copy the project URL and anon key into `web-app/frontend/.env.local` (see `.env.example`).
4. Run `supabase/schema.sql` in the SQL editor. That creates:
  - a private `user-files` bucket (`.edf` + `.pdf`, 500 MB limit)
  - a `user_files` table with row-level security
  - storage policies so each user can only access `{user_id}/edf/` and `{user_id}/reports/`

## Appendix

- `<insert appendix here>`

