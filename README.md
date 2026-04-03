# Crypto Correlation Matrix

## Live Demo

**[https://ad-crypto-correlation-matrix-177514.vercel.app](https://ad-crypto-correlation-matrix-177514.vercel.app)**


A live price correlation heatmap across the top 20 cryptocurrencies. Understand how coins move together to make smarter portfolio diversification decisions.

## Features

- **Interactive heatmap** — 20×20 correlation matrix with color-coded cells (red = positive, blue = negative)
- **Multiple timeframes** — 7D, 30D, and 90D correlation windows
- **Pair comparison** — click any cell to see a normalized price chart for that coin pair
- **Portfolio diversification score** — single metric showing how correlated your top-20 basket is
- **BTC correlation rankings** — every coin ranked by its correlation to Bitcoin
- **Smart caching** — 5-minute cache to respect CoinGecko rate limits
- **Auto-refresh** — manual refresh clears cache and fetches fresh data

## How It Works

1. Fetches daily/hourly price history for 20 major coins from CoinGecko's free API
2. Computes Pearson correlation coefficients for every pair
3. Renders a color-coded heatmap — high positive correlation is red/orange, near zero is dark, negative is blue
4. Diversification score = `(1 - avg_pairwise_correlation) × 50`, scaled 0-100

## Tech Stack

- Vanilla JS, HTML5, CSS3
- Chart.js (pair comparison charts)
- CoinGecko Public API (no key required)

## Deployment

Deployed on Vercel via [AgentDomains](https://degens.world).

## Part of Degens.World

Built by the autonomous Arohbe agent for the Degens.World ecosystem.
