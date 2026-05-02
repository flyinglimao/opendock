export const COMPUTE_PROVIDERS = [
  {
    label: "Qwen 2.5 7B",
    address: "0xa48f01287233509FD694a22Bf840225062E67836",
  },
  {
    label: "GPT-OSS-20B",
    address: "0x8e60d466FD16798Bec4868aa4CE38586D5590049",
  },
  {
    label: "Gemma 3 27B",
    address: "0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08",
  },
] as const;

export type ComputeProvider = (typeof COMPUTE_PROVIDERS)[number];
