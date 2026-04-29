// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {TEEVerifier} from "../src/TEEVerifier.sol";
import {OpenDockINFT} from "../src/OpenDockINFT.sol";

/**
 * @title  DeployCore
 * @notice Deploys TEEVerifier + OpenDockINFT on 0G Testnet (chain 16602).
 *
 * Usage:
 *   forge script script/DeployCore.s.sol \
 *     --rpc-url https://rpc.ankr.com/0g_galileo_testnet_evm \
 *     --broadcast \
 *     --private-key $PRIVATE_KEY \
 *     -vvvv
 *
 * Alternatively, set PRIVATE_KEY in a .env and use --account or cast wallet.
 */
contract DeployCore is Script {
    // ---- Adjust these before deploying ----
    string constant NFT_NAME        = "OpenDock Agent";
    string constant NFT_SYMBOL      = "ODAI";
    /// @notice The 0G Storage info string — can be e.g. the indexer URL
    string constant STORAGE_INFO    = "https://indexer-storage-testnet-turbo.0g.ai";
    /// @notice Base URL for tokenURI. Trailing slash required.
    string constant BASE_URI        = "https://opendock.vercel.app/api/token/";

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("Deployer :", deployer);
        console.log("Chain ID :", block.chainid);

        vm.startBroadcast(deployerKey);

        // 1. Deploy TEEVerifier (MVP no-op)
        TEEVerifier verifier = new TEEVerifier();
        verifier.initialize(deployer);
        console.log("TEEVerifier :", address(verifier));

        // 2. Deploy OpenDockINFT
        OpenDockINFT nft = new OpenDockINFT();
        nft.initialize(
            NFT_NAME,
            NFT_SYMBOL,
            STORAGE_INFO,
            address(verifier),
            deployer
        );
        nft.setBaseURI(BASE_URI);
        console.log("OpenDockINFT:", address(nft));

        vm.stopBroadcast();

        // Print env vars to paste into .env
        console.log("\n--- paste into .env ---");
        console.log("NEXT_PUBLIC_CHAIN_ID=16602");
        console.log("NEXT_PUBLIC_NFT_ADDRESS=%s", address(nft));
        console.log("NEXT_PUBLIC_VERIFIER_ADDRESS=%s", address(verifier));
    }
}
