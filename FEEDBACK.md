# Integration Feedback

## World ID for Agents

- Time to first successful verification: About 1 hour.
- Friction: The callback needed a public HTTPS URL. We did not have a domain at first, and localhost could not be used to test the callback flow.
- Missing capability or documentation: None identified during this integration.
- Most impactful improvement: No specific change requested. The integration worked well once the public callback URL was configured.

## Intercepta

- Time to first API call: About 30 minutes.
- Integration experience: The API worked well for screening payment recipients and tokens in the x402 flow.
- What confused us: We initially could not find a way to reproduce a blocked payment; later, we found the known-risk addresses pinned in Intercepta's Discord channel.
- What was missing: Consider an API endpoint that lists all known-risk addresses and why they are flagged. It could help integrations that need to discover risky addresses before they have a specific address to scan.

## Uniswap
