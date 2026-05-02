#!/usr/bin/env bash
# Verify all deployed OpenDock contracts on 0G Galileo Testnet explorer.
# Already-verified contracts will be silently skipped by the explorer.
#
# Usage:
#   cd contracts
#   bash script/verify.sh
#
# Reads addresses from .env (NEXT_PUBLIC_*) and broadcast run-latest.json files.
# Requires: forge, jq

set -euo pipefail

CHAIN_ID=16602
VERIFIER_URL="https://chainscan-galileo.0g.ai/open/api"
COMPILER_VERSION="v0.8.33+commit.64118f21"
NUM_OPTIMIZATIONS=200
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$CONTRACTS_DIR"

# Load .env if present
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -o allexport && source .env && set +o allexport
fi

# Read addresses from .env; fall back to broadcast files
read_address_from_broadcast() {
  local script="$1" contract="$2"
  local broadcast="$CONTRACTS_DIR/broadcast/$script/$CHAIN_ID/run-latest.json"
  if [ -f "$broadcast" ]; then
    jq -r --arg name "$contract" \
      '.transactions[] | select(.contractName == $name and .contractAddress != null) | .contractAddress' \
      "$broadcast" | head -1
  fi
}

NFT_ADDRESS="${NEXT_PUBLIC_NFT_ADDRESS:-$(read_address_from_broadcast "DeployCore.s.sol" "OpenDockINFT")}"
MARKETPLACE_ADDRESS="${NEXT_PUBLIC_MARKETPLACE_ADDRESS:-$(read_address_from_broadcast "DeployCore.s.sol" "OpenDockMarketplace")}"
VERIFIER_ADDRESS="${NEXT_PUBLIC_VERIFIER_ADDRESS:-$(read_address_from_broadcast "DeployCore.s.sol" "TEEVerifier")}"
DELEGATE_ADDRESS="${AGENT_COMPUTE_WALLET_DELEGATE_IMPLEMENTATION:-$(read_address_from_broadcast "DeployAgentComputeWalletDelegate.s.sol" "AgentComputeWalletDelegate")}"

verify_one() {
  local address="$1" contract_path="$2" label="$3"
  if [ -z "$address" ]; then
    echo "⚠  Skipping $label — address not found"
    return
  fi
  echo "→ Verifying $label ($address)..."
  forge verify-contract \
    --chain-id "$CHAIN_ID" \
    --num-of-optimizations "$NUM_OPTIMIZATIONS" \
    --verifier custom \
    --verifier-api-key "PLACEHOLDER" \
    --compiler-version "$COMPILER_VERSION" \
    --verifier-url "$VERIFIER_URL" \
    "$address" \
    "$contract_path"
  echo "  Submitted $label"
}

verify_one "$VERIFIER_ADDRESS"    "src/TEEVerifier.sol:TEEVerifier"                                   "TEEVerifier"
verify_one "$NFT_ADDRESS"         "src/OpenDockINFT.sol:OpenDockINFT"                                 "OpenDockINFT"
verify_one "$MARKETPLACE_ADDRESS" "src/OpenDockMarketplace.sol:OpenDockMarketplace"                   "OpenDockMarketplace"
verify_one "$DELEGATE_ADDRESS"    "src/AgentComputeWalletDelegate.sol:AgentComputeWalletDelegate"     "AgentComputeWalletDelegate"

echo ""
echo "Done. Check https://chainscan-galileo.0g.ai for results."
