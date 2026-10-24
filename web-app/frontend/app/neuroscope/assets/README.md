The viewer styles are imported by the React page at `/neuroscope`. Viewer behavior now lives in `components/neuroscope` and `lib/neuroscope`; this folder contains the migrated stylesheets.

Configure the backend with `NEXT_PUBLIC_API_BASE_URL` in the frontend environment. It defaults to localhost during development and must be set to the current backend origin in production.
