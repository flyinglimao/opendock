// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {AgentComputeWalletDelegate} from "../src/AgentComputeWalletDelegate.sol";

/**
 * @title DeployAgentComputeWalletDelegate
 * @notice Deploys the EIP-7702 delegate implementation for hosted compute wallets.
 *
 * Usage:
 *   forge script script/DeployAgentComputeWalletDelegate.s.sol \
 *     --rpc-url https://rpc.ankr.com/0g_galileo_testnet_evm \
 *     --broadcast \
 *     --private-key $PRIVATE_KEY \
 *     -vvvv
 */
contract DeployAgentComputeWalletDelegate is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer :", deployer);
        console.log("Chain ID :", block.chainid);

        vm.startBroadcast(deployerKey);
        AgentComputeWalletDelegate delegate = new AgentComputeWalletDelegate();
        vm.stopBroadcast();

        console.log("AgentComputeWalletDelegate:", address(delegate));
        console.log("\n--- paste into .env ---");
        console.log(
            "AGENT_COMPUTE_WALLET_DELEGATE_IMPLEMENTATION=%s",
            address(delegate)
        );
    }
}
