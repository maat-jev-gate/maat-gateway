# Maat x402 Demo

This demo has two independent parts:

- `merchant/`: reusable x402 HTTP merchant service and live merchant console.
- `client/`: temporary MetaMask client. The next integration step is to replace its direct merchant request with Maat Gateway calls.

## Start the merchant

```bash
cd merchant
npm install
cp .env.example .env
# Set MERCHANT_PAY_TO to a Base Sepolia address.
npm run dev
```

Open the merchant console at `http://localhost:8790`.

## Start the demo client

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5175`, install MetaMask, select Base Sepolia, and use the three-step flow:

1. Connect MetaMask.
2. Request the dataset and inspect the HTTP 402 quote.
3. Confirm the EIP-712 USDC authorization in MetaMask. The client sends the signed x402 payment payload back to the merchant, which verifies and settles it before returning the data.

The merchant console records both the initial 402 request and the settled request, including the amount, payer, and settlement transaction hash.

The merchant does not require a custom smart contract. The facilitator settles the payment through the existing Base Sepolia USDC contract and transfers USDC to `MERCHANT_PAY_TO`.
