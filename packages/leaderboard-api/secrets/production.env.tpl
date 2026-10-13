# Secrets of the production Worker, as 1Password references (vault "be-music" in my.1password.com). `op inject` fills
# them in on the way to Cloudflare; the values never land on disk. See the package README, "Secrets".
BETTER_AUTH_SECRET={{ op://be-music/be-music-leaderboard/password }}
