// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TransferValidityProof} from "./IERC7857.sol";

/// @notice Interface for a TEE hardware attestation verifier (external contract)
interface ITEEVerifier {
    /// @notice Verify a message signature produced inside a TEE enclave
    function verifyTEESignature(
        bytes32 messageHash,
        bytes calldata signature
    ) external view returns (bool);
}

/// @notice Project-specific extensions to ERC-7857
///         (not part of the standard, OpenDock-specific)
interface IOpenDockINFT {
    // ---- Events ----

    /// @notice Emitted when a holder grants/revokes usage-operator rights
    event UsageDelegated(
        uint256 indexed tokenId,
        address indexed owner,
        address indexed operator,
        bool approved
    );

    // ---- Usage operator delegation ----

    /// @notice Grant or revoke the right for `operator` to call
    ///         `authorizeUsage` / `revokeAuthorization` on behalf of the owner
    ///         for the given token.
    function setUsageOperator(
        uint256 tokenId,
        address operator,
        bool approved
    ) external;

    /// @notice Check whether `operator` may call authorizeUsage for `owner`'s tokens
    function isUsageOperator(
        address owner,
        address operator
    ) external view returns (bool);

    // ---- iTransferFrom ----

    /// @notice Full TEE-proof transfer callable by any approved spender
    ///         (mirrors IERC7857.iTransfer but with explicit `from`)
    function iTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external;

    // ---- Forwarded IERC7857 methods needed by Marketplace ----

    function authorizeUsage(uint256 tokenId, address user) external;
    function revokeAuthorization(uint256 tokenId, address user) external;
}
