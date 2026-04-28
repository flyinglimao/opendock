// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import {
    IERC7857DataVerifier,
    OracleType,
    AccessProof,
    OwnershipProof,
    TransferValidityProof,
    TransferValidityProofOutput
} from "./interfaces/IERC7857.sol";

// ============================================================
//  BaseVerifier — replay-attack protection
// ============================================================

abstract contract BaseVerifier is IERC7857DataVerifier {
    mapping(bytes32 => bool) internal usedProofs;
    mapping(bytes32 => uint256) internal proofTimestamps;

    function _checkAndMarkProof(bytes32 proofNonce) internal {
        require(!usedProofs[proofNonce], "Proof already used");
        usedProofs[proofNonce] = true;
        proofTimestamps[proofNonce] = block.timestamp;
    }

    /// @notice Reclaim storage for expired nonces (callable by anyone)
    function cleanExpiredProofs(bytes32[] calldata proofNonces) external {
        for (uint256 i = 0; i < proofNonces.length; i++) {
            bytes32 nonce = proofNonces[i];
            if (
                usedProofs[nonce] &&
                block.timestamp > proofTimestamps[nonce] + 7 days
            ) {
                delete usedProofs[nonce];
                delete proofTimestamps[nonce];
            }
        }
    }

    uint256[50] private __gap;
}

// ============================================================
//  TEEVerifier — MVP / no-op implementation
//
//  This contract intentionally skips cryptographic proof verification
//  so the rest of the system can be tested end-to-end without a live
//  TEE attestation service.
//
//  TODO: Replace with real TEE verification before production.
//        A production verifier should:
//          1. Decode ownershipProof.proof as a TEE enclave signature.
//          2. Verify the signature against a registered attestation
//             contract (e.g. 0G's on-chain TEE attestation registry).
//          3. Recover the accessAssistant from accessProof.proof
//             (personal_sign of keccak256(oldDataHash ++ newDataHash
//              ++ encryptedPubKey ++ nonce)).
//          4. Cross-check oldDataHash == ownershipProof.oldDataHash
//             and newDataHash == ownershipProof.newDataHash.
// ============================================================

contract TEEVerifier is
    BaseVerifier,
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    string public constant VERSION = "1.0.0-mvp";

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _admin) external initializer {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ---- IERC7857DataVerifier ----

    /// @notice MVP stub — accepts all proofs without verification.
    ///         Returns decoded output directly from proof fields.
    /// @dev    The nonce replay guard is still active to prevent double-spends
    ///         within the same session.
    function verifyTransferValidity(
        TransferValidityProof[] calldata proofs
    )
        public
        virtual
        override
        whenNotPaused
        returns (TransferValidityProofOutput[] memory outputs)
    {
        outputs = new TransferValidityProofOutput[](proofs.length);

        for (uint256 i = 0; i < proofs.length; i++) {
            TransferValidityProof calldata p = proofs[i];

            // Basic sanity: hashes in access proof and ownership proof must agree
            require(
                p.accessProof.oldDataHash == p.ownershipProof.oldDataHash,
                "oldDataHash mismatch"
            );
            require(
                p.accessProof.newDataHash == p.ownershipProof.newDataHash,
                "newDataHash mismatch"
            );

            outputs[i] = TransferValidityProofOutput({
                oldDataHash: p.accessProof.oldDataHash,
                newDataHash: p.accessProof.newDataHash,
                sealedKey: p.ownershipProof.sealedKey,
                encryptedPubKey: p.ownershipProof.encryptedPubKey,
                wantedKey: p.accessProof.encryptedPubKey,
                // In MVP mode we trust the caller to supply the correct assistant address.
                // In production this would be recovered from the ECDSA signature.
                accessAssistant: p.accessProof.proof.length == 20
                    ? address(bytes20(p.accessProof.proof))   // allow raw address injection for tests
                    : address(0),                              // falls back to "receiver = assistant" path
                accessProofNonce: p.accessProof.nonce,
                ownershipProofNonce: p.ownershipProof.nonce
            });

            // Still guard against replay even in MVP mode
            if (p.accessProof.nonce.length > 0) {
                _checkAndMarkProof(keccak256(p.accessProof.nonce));
            }
            if (p.ownershipProof.nonce.length > 0) {
                _checkAndMarkProof(keccak256(p.ownershipProof.nonce));
            }
        }
    }

    uint256[50] private __gap;
}
