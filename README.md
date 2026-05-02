# OpenDock

OpenDock is a decentralized marketplace for **iNFTs (Intelligent NFTs)** and AI agents, built on the **0G Galileo Testnet**. It enables users to create, rent, and manage autonomous AI agents whose intelligence (prompts and knowledge) is stored securely on **0G Storage**.

## 🚀 Overview

OpenDock bridges the gap between decentralized ownership and AI execution. By representing agents as iNFTs, it creates a transparent marketplace for specialized AI capabilities.

### Key Concepts

- **iNFT (Intelligent NFT):** An ERC-7857 token (AI Agents NFT with Private Metadata) that owns its "intelligence". The metadata and system prompts are stored on-chain or via decentralized storage (0G).
- **0G Storage Integration:** Uses the 0G Storage network to persist agent metadata and encrypted "Intelligent Data" envelopes, ensuring data availability without central reliance.
- **Agent Loop:** A sophisticated backend execution environment that handles conversation history, tool calling (web search, blockchain interactions), and integration with the 0G Serving Broker.
- **Hosted Compute Wallets:** Each user is assigned a single, dedicated hosted compute wallet. All agents for a user share the same wallet, which is primarily used to manage and pay for **LLM inference fees** via the 0G Serving system. The wallet utilizes **EIP-7702**, allowing the user to manage the wallet and its funds directly with their own key while delegating compute payment authority to the platform.
- **Automations:** Cron-based scheduling system that allows agents to perform recurring tasks autonomously.

## ✨ Features

- 🛒 **Marketplace:** Browse, search, and rent AI agents listed by the community.
- 🤖 **Agent Creation:** Mint your own iNFT agents with custom system prompts and knowledge bases.
- 💬 **Interactive Chat:** Multi-turn conversations with persistent memory and tool-calling capabilities.
- 🛠️ **Tool-Equipped Agents:** Agents can use tools like Brave Search for web data and a built-in knowledge base for domain-specific retrieval.
- 📅 **Automated Tasks:** Schedule your agents to run periodically (e.g., "Check token prices every hour and summarize").
- 🔒 **Privacy-First (Simulation):** Current implementation uses a server-side encryption simulation for agent intelligence, pathing the way for full TEE (Trusted Execution Environment) integration.

## 🛠️ Technology Stack

- **Frontend:** Next.js (App Router), React 19, Tailwind CSS 4, RainbowKit, Wagmi.
- **Backend:** Next.js API Routes, Prisma ORM (PostgreSQL).
- **Blockchain:** Solidity (Foundry/Forge), Ethers.js, Viem.
- **Infrastructure:** 0G Galileo Testnet, 0G Storage, 0G Serving Broker.
- **AI:** OpenAI-compatible APIs (hosted via 0G Serving providers).

## 📦 Project Structure

- `app/`: Next.js frontend and API routes.
- `components/`: Reusable UI components.
- `contracts/`: Solidity smart contracts (iNFT, Marketplace, TEE Verifier).
- `lib/`: Core logic including the `agent-loop`, 0G Storage interaction, and blockchain utilities.
- `prisma/`: Database schema and migrations.
- `public/`: Static assets.

## 🚦 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [pnpm](https://pnpm.io/)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for contract development)
- A PostgreSQL database

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/opendock.git
   cd opendock
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Configure environment variables:
   Copy `.env.example` to `.env` and fill in the required values:
   ```bash
   cp .env.example .env
   ```

4. Setup the database:
   ```bash
   pnpm prisma migrate dev
   ```

5. Run the development server:
   ```bash
   pnpm dev
   ```

### Smart Contracts

The contracts are located in the `contracts/` directory. To build and test:

```bash
cd contracts
forge build
forge test
```

## 🛡️ Security Model

OpenDock currently implements a **simulation** of the final iNFT security model.
- Private agent data (prompts) are encrypted on the server using `SYSTEM_PROMPT_KEY`.
- Encrypted data is stored on 0G Storage.
- Decryption happens in a secure server context only for authorized owners/renters.
- The roadmap includes migrating to full **TEE-based execution**, where even the server cannot see the plaintext prompts.

## ⚖️ License

This project is licensed under the [MIT License](LICENSE).
