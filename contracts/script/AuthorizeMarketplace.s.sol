// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OpenDockINFT} from "../src/OpenDockINFT.sol";

/**
 * @notice Authorize a new marketplace as usage-operator on the NFT contract.
 *
 * Because usageOperators is keyed per-owner (not per-token), one call authorizes
 * the marketplace to call authorizeUsage/revokeAuthorization for ALL tokens owned
 * by the caller. TOKEN_ID is only required to prove ownership.
 *
 * Usage:
 *   forge script script/AuthorizeMarketplace.s.sol \
 *     --rpc-url https://evmrpc-testnet.0g.ai \
 *     --broadcast \
 *     --private-key $PRIVATE_KEY \
 *     -vvvv
 *
 * Required env vars:
 *   PRIVATE_KEY              — deployer / token owner
 *   NEXT_PUBLIC_NFT_ADDRESS  — deployed OpenDockINFT address
 *   NEXT_PUBLIC_MARKETPLACE_ADDRESS — new marketplace address to authorize
 *   TOKEN_ID                 — any tokenId owned by the caller (proves ownership)
 *
 * Optional env vars:
 *   OLD_MARKETPLACE_ADDRESS  — if set, revokes usage-operator for the old marketplace
 */
contract AuthorizeMarketplace is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address nftAddress = vm.envAddress("NEXT_PUBLIC_NFT_ADDRESS");
        address newMarketplace = vm.envAddress("NEXT_PUBLIC_MARKETPLACE_ADDRESS");
        uint256 tokenId = vm.envUint("TOKEN_ID");

        address oldMarketplace = address(0);
        try vm.envAddress("OLD_MARKETPLACE_ADDRESS") returns (address addr) {
            oldMarketplace = addr;
        } catch {}

        OpenDockINFT nft = OpenDockINFT(nftAddress);

        console.log("Deployer         :", deployer);
        console.log("NFT              :", nftAddress);
        console.log("New marketplace  :", newMarketplace);
        if (oldMarketplace != address(0)) {
            console.log("Old marketplace  :", oldMarketplace);
        }
        console.log("Token ID         :", tokenId);

        require(nft.ownerOf(tokenId) == deployer, "Deployer does not own TOKEN_ID");

        vm.startBroadcast(deployerKey);

        if (oldMarketplace != address(0)) {
            nft.setUsageOperator(tokenId, oldMarketplace, false);
            console.log("Revoked old marketplace as usage operator");
        }

        nft.setUsageOperator(tokenId, newMarketplace, true);
        console.log("Authorized new marketplace as usage operator");

        vm.stopBroadcast();

        console.log("\nDone. New marketplace can now call authorizeUsage/revokeAuthorization");
        console.log("for all tokens owned by", deployer);
    }
}
