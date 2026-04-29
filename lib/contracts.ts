// lib/contracts.ts
// Contract ABIs and addresses for OpenDock

export const INFT_ADDRESS =
  (process.env.NEXT_PUBLIC_NFT_ADDRESS as `0x${string}`) ?? "0x";

/**
 * Minimal ABI — only what the frontend needs for minting.
 * Full ABI lives in contracts/out/OpenDockINFT.sol/OpenDockINFT.json
 */
export const INFT_ABI = [
  // mint(IntelligentData[] iDatas, address to) returns (uint256)
  {
    name: "mint",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "iDatas",
        type: "tuple[]",
        components: [
          { name: "dataDescription", type: "string" },
          { name: "dataHash", type: "bytes32" },
        ],
      },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  // ownerOf(uint256 tokenId) returns (address)
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  // Minted event
  {
    name: "Minted",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;
