// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OpenDockMarketplace} from "../src/OpenDockMarketplace.sol";

/**
 * @title  DeployMarketplace
 * @notice Deploys only OpenDockMarketplace (e.g. after a contract upgrade).
 *         NFT and TEEVerifier remain unchanged.
 *
 * After deploying, run AuthorizeMarketplace.s.sol so the new marketplace
 * can call authorizeUsage/revokeAuthorization on the NFT contract.
 *
 * Usage:
 *   forge script script/DeployMarketplace.s.sol \
 *     --rpc-url https://evmrpc-testnet.0g.ai \
 *     --broadcast \
 *     --private-key $PRIVATE_KEY \
 *     -vvvv
 *
 * Required env var: PRIVATE_KEY
 * Optional env var: MARKETPLACE_FEE_BPS (default 0)
 */
contract DeployMarketplace is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        uint256 feeBps = 0;
        try vm.envUint("MARKETPLACE_FEE_BPS") returns (uint256 v) {
            feeBps = v;
        } catch {}

        console.log("Deployer :", deployer);
        console.log("Chain ID :", block.chainid);
        console.log("Fee BPS  :", feeBps);

        vm.startBroadcast(deployerKey);

        OpenDockMarketplace marketplace = new OpenDockMarketplace();
        marketplace.initialize(deployer, feeBps, deployer);

        vm.stopBroadcast();

        console.log("Marketplace :", address(marketplace));
        console.log("\n--- update .env ---");
        console.log("NEXT_PUBLIC_MARKETPLACE_ADDRESS=%s", address(marketplace));
        console.log("\n--- next steps ---");
        console.log("1. Update NEXT_PUBLIC_MARKETPLACE_ADDRESS in .env");
        console.log("2. Run AuthorizeMarketplace.s.sol with TOKEN_ID=<your token id>");
    }
}
