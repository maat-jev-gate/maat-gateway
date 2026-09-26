# Themis / Ma'at: Swap Guard Dashboard

A demo dashboard for the hackathon. It shows how the guard judges an AI agent's **Uniswap swap** before the agent signs it, with two things front and center:

- **Speed**: the time from intercepting the swap to the verdict (about 180 ms), a stage-by-stage waterfall, the parallel vs. one-by-one comparison, and the share of one Base block (2 s).
- **Evidence**: each signal's weight on the scale, the money trail (following the signer instead of the launchpad factory), the deployer's dev-sell record, JEV's typed output with its probabilities, and the calibration curve.

> ⚠️ Every number, address and token on the page is **mock data** (in `mock-data.js`).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure and styles (light and dark themes) |
| `app.js` | Rendering logic: charts, animation, interaction. No dependencies |
| `mock-data.js` | **All mock data.** Edit this file to change the story |

It is a static site with no build step. Open `index.html` locally, or run `python3 -m http.server` and visit `http://localhost:8000`.

## Publishing to GitHub Pages

1. Repository **Settings → Pages**
2. Under **Build and deployment → Source**, choose **Deploy from a branch**
3. Pick the branch (`main` after merging), folder `/ (root)`, and save
4. After a minute or two the site is live at `https://<user>.github.io/jev-hackthon-demo/`

`.nojekyll` is already in place, so Pages serves the files as they are.

## Demo script (Scene 4: aping a meme)

1. The page opens on the **YUZU** swap: `0.80 ETH → YUZU`, verdict **BLOCK** at 97.4%, the scale tipped toward BLOCK.
2. In the "From intent to verdict" card, click **Slow motion ×10**. Five lookups run in parallel, then JEV decides, and the stamp lands at 184 ms. Point out that this is 9% of one Base block.
3. Scroll to "What tipped the scale": the dev-sell history (+2.4) and the rug-cluster funding (+1.9) carry the most weight, and the Intercepta signals are marked in gold.
4. "Follow the money": the launchpad factory is skipped and the real signer is followed. Rug cluster R-17 → hop wallet → deployer.
5. "Deployer track record": 3 of 4 prior launches were dev-sold.
6. Click the other swaps on the left to show the remaining verdicts:
   - **MOCHI → ESCALATE**: over the new-token cap, so a human approves through World ID
   - **ONSEN → LIMIT**: the pool is too thin, so the swap is cut to 0.23 ETH
   - **"USDC" → BLOCK**: a lookalike of USDC's address, caught by Intercepta
   - **USDC → ALLOW**: the x402 payment top-up passes in 137 ms
7. At the bottom, "All swaps today": decision-time distribution (p99 < 260 ms), block reasons, and "Does 95% mean 95%?" (calibration).

Other controls:

- **Themis / Ma'at** in the top right switches the product name and logo (the name is still undecided).
- Every chart has a **Table** button that shows the underlying numbers.
- Link straight to a swap with a URL hash, e.g. `#mochi`, `#onsen`, `#fake-usdc`.

## Connecting real data

In `mock-data.js`, each object in `swaps[]` is one decision. When the backend produces objects with the same fields (`stages`, `signals`, `trail`, `record`, `probs`, `outcome`), the page renders them unchanged. Field conventions are in the comment at the top of that file.
