// lib/contracts.ts
// Contract ABIs and addresses for OpenDock

export const INFT_ADDRESS =
  (process.env.NEXT_PUBLIC_NFT_ADDRESS as `0x${string}`) ?? "0x";

export const MARKETPLACE_ADDRESS =
  (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS as `0x${string}`) ?? "0x";

/**
 * Minimal ABI — only what the frontend needs.
 * Full ABI lives in contracts/out/OpenDockINFT.sol/OpenDockINFT.json
 */
export const INFT_ABI = [
  // mint(IntelligentData[], bytes32 metadataHash, address to) returns (uint256)
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
      { name: "metadataHash_", type: "bytes32" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  // ownerOf(uint256) returns (address)
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  // metadataHashOf(uint256) returns (bytes32)
  {
    name: "metadataHashOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  // tokenURI(uint256) returns (string)
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  // intelligentDataOf(uint256) returns ((string,bytes32)[])
  {
    name: "intelligentDataOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "dataDescription", type: "string" },
          { name: "dataHash", type: "bytes32" },
        ],
      },
    ],
  },
  // authorizedUsersOf(uint256) returns (address[])
  {
    name: "authorizedUsersOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  // setUsageOperator(uint256 tokenId, address operator, bool approved)
  {
    name: "setUsageOperator",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  // isUsageOperator(address owner, address operator) returns (bool)
  {
    name: "isUsageOperator",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
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

export const MARKETPLACE_ABI = [
  // listRent(address nftContract, uint256 tokenId, uint256 pricePerSecond, uint256 maxDuration) returns (uint256 orderId)
  {
    name: "listRent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "pricePerSecond", type: "uint256" },
      { name: "maxDuration", type: "uint256" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
  },
  // cancelRent(uint256 orderId)
  {
    name: "cancelRent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [],
  },
  // executeRent(uint256 orderId, uint256 duration) payable
  {
    name: "executeRent",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [],
  },
  // getRentOrder(uint256 orderId) returns (RentOrder)
  {
    name: "getRentOrder",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "nftContract", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "pricePerSecond", type: "uint256" },
          { name: "maxDuration", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  // isActivelyRented(address nftContract, uint256 tokenId) returns (bool)
  {
    name: "isActivelyRented",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // getActiveRental(uint256 rentalId) returns (ActiveRental)
  {
    name: "getActiveRental",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "rentalId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "renter", type: "address" },
          { name: "nftContract", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "rentOrderId", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "duration", type: "uint256" },
          { name: "revoked", type: "bool" },
        ],
      },
    ],
  },
  // withdraw()
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // RentOrderCreated event
  {
    name: "RentOrderCreated",
    type: "event",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "nftContract", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "pricePerSecond", type: "uint256", indexed: false },
      { name: "maxDuration", type: "uint256", indexed: false },
    ],
  },
  // RentalStarted event
  {
    name: "RentalStarted",
    type: "event",
    inputs: [
      { name: "rentalId", type: "uint256", indexed: true },
      { name: "rentOrderId", type: "uint256", indexed: true },
      { name: "renter", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "duration", type: "uint256", indexed: false },
    ],
  },
  // expireRent(uint256 rentalId) — callable by anyone once rental has expired
  {
    name: "expireRent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "rentalId", type: "uint256" }],
    outputs: [],
  },
  // RentalExpired event
  {
    name: "RentalExpired",
    type: "event",
    inputs: [
      { name: "rentalId", type: "uint256", indexed: true },
      { name: "renter", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
    ],
  },
] as const;
