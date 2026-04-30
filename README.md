This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## iNFT Intelligence Encryption

OpenDock currently uses a temporary server-key simulation for private agent intelligence.

- Public ERC-721 metadata contains only agent metadata such as name, description, and image.
- System prompts and knowledge-base text are POSTed to `/api/intelligence/encrypt`, encrypted on the app server with `SYSTEM_PROMPT_KEY`, then the encrypted envelope is uploaded to 0G Storage.
- The database stores only public metadata/cache fields and the 0G `dataHash`; it does not store plaintext prompts or encryption keys.
- When an owner or authorized renter chats with an agent, `/api/token/[id]/chat` verifies the caller's wallet signature and on-chain owner/authorized status before decrypting the envelope with the server key.
- The browser generates the 0G Compute serving `Authorization` header with the user's wallet and sends that header to `/api/token/[id]/chat`; the server then injects the decrypted system prompt and calls the provider. The current 0G serving broker treats the request `content` argument as deprecated/unused, so the serving header is not bound to the chat body.

This is **not** the final 0G iNFT/TEE security model. In this simulation, the app server can decrypt the prompt, but browser clients do not receive plaintext prompts. The intended production model is to send encrypted intelligent data directly to 0G secure execution/TEE so neither the app server nor browser handles plaintext.

Set `SYSTEM_PROMPT_KEY` to a random 32-byte key encoded as 64 hex characters:

```bash
openssl rand -hex 32
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
