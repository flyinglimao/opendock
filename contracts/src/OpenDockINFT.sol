// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";

import {
    IERC7857DataVerifier,
    IERC7857,
    IERC7857Metadata,
    IntelligentData,
    TransferValidityProof,
    TransferValidityProofOutput
} from "./interfaces/IERC7857.sol";

// ============================================================
//  Utils
// ============================================================

library Utils {
    /// @dev Derive an Ethereum address from an uncompressed public key (64 bytes).
    function pubKeyToAddress(bytes memory pubKey) internal pure returns (address) {
        require(pubKey.length == 64, "Invalid pubkey length");
        return address(uint160(uint256(keccak256(pubKey))));
    }

    function bytesEqual(bytes memory a, bytes memory b) internal pure returns (bool) {
        return keccak256(a) == keccak256(b);
    }
}

// ============================================================
//  OpenDockINFT — ERC-7857 iNFT with TEE transfer + usage delegation
// ============================================================

/**
 * @title  OpenDockINFT
 * @notice ERC-7857-compliant iNFT contract designed for the OpenDock platform.
 *
 * ## Standard compliance
 *  - Implements IERC7857 (transfer, clone, authorizeUsage, approvals, delegateAccess)
 *  - Implements IERC7857Metadata (name, symbol, intelligentDataOf)
 *
 * ## Extensions (non-standard)
 *  - `setUsageOperator` / `isUsageOperator`:  allow a token owner to delegate the right
 *    to call `authorizeUsage` on their behalf (e.g. to the marketplace contract).
 *  - `iTransferFrom`: approved spender can call the full TEE-proof transfer without
 *    first needing to be the owner.
 *
 * ## TEE Transfer Flow (summary)
 *  For a complete description see TEEVerifier.sol.
 *  On-chain, iTransfer / iTransferFrom:
 *   1. Requires caller to be owner, approved address, or approved-for-all operator.
 *   2. Calls `verifier.verifyTransferValidity(proofs)` which verifies TEE signatures
 *      and marks nonces as used.
 *   3. Checks that the accessAssistant recovered from the AccessProof matches either
 *      the receiver itself or their registered access assistant.
 *   4. Checks that the receiver's public key embedded in the proof matches.
 *   5. Updates on-chain state: new owner, cleared approvals, new data hashes.
 *   6. Emits `PublishedSealedKey` so the receiver can retrieve the sealed key off-chain
 *      and decrypt their new agent data from 0G Storage.
 */
contract OpenDockINFT is
    Initializable,
    AccessControlEnumerableUpgradeable,
    IERC7857,
    IERC7857Metadata
{
    // ---- Roles ----
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ---- ERC-7201 namespaced storage ----

    struct TokenData {
        address owner;
        address[] authorizedUsers;
        address approvedUser;
        IntelligentData[] iDatas;
    }

    /// @custom:storage-location erc7201:opendock.storage.OpenDockINFT
    struct INFTStorage {
        // Token data
        mapping(uint256 => TokenData) tokens;
        // ERC-721-style operator approvals
        mapping(address owner => mapping(address operator => bool)) operatorApprovals;
        // ERC-7857 access delegation: user → access assistant address
        mapping(address user => address assistant) accessAssistants;
        // Non-standard: usage operator delegation: owner → operator → approved
        mapping(address owner => mapping(address operator => bool)) usageOperators;
        uint256 nextTokenId;
        // Metadata
        string name;
        string symbol;
        string storageInfo;
        // Verifier
        IERC7857DataVerifier verifier;
    }

    // keccak256(abi.encode(uint(keccak256("opendock.storage.OpenDockINFT")) - 1)) & ~bytes32(uint(0xff))
    bytes32 private constant INFT_STORAGE_LOCATION =
        0x4aa80aaafbe0e5fe3fe1aa97f3c1f8c65d61f96ef1aab2b448154f4e07594600;

    function _getStorage() private pure returns (INFTStorage storage $) {
        assembly {
            $.slot := INFT_STORAGE_LOCATION
        }
    }

    // ---- Additional events (non-standard extensions) ----

    event Minted(
        uint256 indexed tokenId,
        address indexed creator,
        address indexed owner
    );
    event Updated(
        uint256 indexed tokenId,
        IntelligentData[] oldDatas,
        IntelligentData[] newDatas
    );
    /// @notice Non-standard: emitted when usage-operator rights are granted/revoked
    event UsageDelegated(
        uint256 indexed tokenId,
        address indexed owner,
        address indexed operator,
        bool approved
    );

    // ---- Constructor / Initializer ----

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        string memory storageInfo_,
        address verifierAddr,
        address admin_
    ) public virtual initializer {
        require(verifierAddr != address(0), "Zero address: verifier");
        require(admin_ != address(0), "Zero address: admin");

        __AccessControlEnumerable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);

        INFTStorage storage $ = _getStorage();
        $.name = name_;
        $.symbol = symbol_;
        $.storageInfo = storageInfo_;
        $.verifier = IERC7857DataVerifier(verifierAddr);
    }

    // ================================================================
    //  Metadata
    // ================================================================

    function name() public view virtual returns (string memory) {
        return _getStorage().name;
    }

    function symbol() public view virtual returns (string memory) {
        return _getStorage().symbol;
    }

    function verifier() public view virtual returns (IERC7857DataVerifier) {
        return _getStorage().verifier;
    }

    function intelligentDataOf(
        uint256 tokenId
    ) public view virtual returns (IntelligentData[] memory) {
        require(_exists(tokenId), "Token does not exist");
        return _getStorage().tokens[tokenId].iDatas;
    }

    function storageInfo() public view virtual returns (string memory) {
        return _getStorage().storageInfo;
    }

    // ================================================================
    //  Admin
    // ================================================================

    function updateVerifier(address newVerifier) public virtual onlyRole(ADMIN_ROLE) {
        require(newVerifier != address(0), "Zero address");
        _getStorage().verifier = IERC7857DataVerifier(newVerifier);
    }

    // ================================================================
    //  Minting & updating
    // ================================================================

    function mint(
        IntelligentData[] calldata iDatas,
        address to
    ) public payable virtual returns (uint256 tokenId) {
        require(to != address(0), "Zero address");
        require(iDatas.length > 0, "Empty data array");

        INFTStorage storage $ = _getStorage();
        tokenId = $.nextTokenId++;
        TokenData storage newToken = $.tokens[tokenId];
        newToken.owner = to;
        for (uint256 i = 0; i < iDatas.length; i++) {
            newToken.iDatas.push(iDatas[i]);
        }
        emit Minted(tokenId, msg.sender, to);
    }

    /// @notice Update the intelligent data of a token (only callable by owner)
    function update(
        uint256 tokenId,
        IntelligentData[] calldata newDatas
    ) public virtual {
        INFTStorage storage $ = _getStorage();
        require($.tokens[tokenId].owner == msg.sender, "Not owner");
        require(newDatas.length > 0, "Empty data array");

        IntelligentData[] memory oldDatas = new IntelligentData[](
            $.tokens[tokenId].iDatas.length
        );
        for (uint256 i = 0; i < $.tokens[tokenId].iDatas.length; i++) {
            oldDatas[i] = $.tokens[tokenId].iDatas[i];
        }

        delete $.tokens[tokenId].iDatas;
        for (uint256 i = 0; i < newDatas.length; i++) {
            $.tokens[tokenId].iDatas.push(newDatas[i]);
        }
        emit Updated(tokenId, oldDatas, newDatas);
    }

    // ================================================================
    //  Internal transfer helpers
    // ================================================================

    function _proofCheck(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    )
        internal
        returns (bytes[] memory sealedKeys, IntelligentData[] memory newDatas)
    {
        INFTStorage storage $ = _getStorage();
        require(to != address(0), "Zero address");
        require($.tokens[tokenId].owner == from, "Not owner");
        require(proofs.length > 0, "Empty proofs");

        TransferValidityProofOutput[] memory proofOutput =
            $.verifier.verifyTransferValidity(proofs);

        require(
            proofOutput.length == $.tokens[tokenId].iDatas.length,
            "Proof count mismatch"
        );

        sealedKeys = new bytes[](proofOutput.length);
        newDatas = new IntelligentData[](proofOutput.length);

        for (uint256 i = 0; i < proofOutput.length; i++) {
            require(
                proofOutput[i].oldDataHash == $.tokens[tokenId].iDatas[i].dataHash,
                "Old data hash mismatch"
            );

            // Access assistant must be the receiver itself or their registered assistant
            require(
                proofOutput[i].accessAssistant == $.accessAssistants[to] ||
                    proofOutput[i].accessAssistant == to,
                "Access assistant mismatch"
            );

            bytes memory wantedKey = proofOutput[i].wantedKey;
            bytes memory encryptedPubKey = proofOutput[i].encryptedPubKey;

            if (wantedKey.length == 0) {
                // Empty wantedKey: encryptedPubKey IS the receiver's raw public key
                address defaultReceiver = Utils.pubKeyToAddress(encryptedPubKey);
                require(defaultReceiver == to, "Default receiver mismatch");
            } else {
                // Non-empty wantedKey: encryptedPubKey must equal wantedKey
                require(Utils.bytesEqual(encryptedPubKey, wantedKey), "encryptedPubKey mismatch");
            }

            sealedKeys[i] = proofOutput[i].sealedKey;
            newDatas[i] = IntelligentData({
                dataDescription: $.tokens[tokenId].iDatas[i].dataDescription,
                dataHash: proofOutput[i].newDataHash
            });
        }
    }

    function _transfer(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) internal {
        (
            bytes[] memory sealedKeys,
            IntelligentData[] memory newDatas
        ) = _proofCheck(from, to, tokenId, proofs);

        INFTStorage storage $ = _getStorage();
        TokenData storage token = $.tokens[tokenId];
        token.owner = to;
        token.approvedUser = address(0);
        // Clear existing authorized users on transfer (owner changes)
        delete token.authorizedUsers;
        delete token.iDatas;
        for (uint256 i = 0; i < newDatas.length; i++) {
            token.iDatas.push(newDatas[i]);
        }

        emit Transferred(tokenId, from, to);
        emit PublishedSealedKey(to, tokenId, sealedKeys);
    }

    // ================================================================
    //  IERC7857: Transfer functions
    // ================================================================

    /// @inheritdoc IERC7857
    function iTransfer(
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) public virtual {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not authorized");
        _transfer(ownerOf(tokenId), to, tokenId, proofs);
    }

    /// @notice transferFrom-style: caller can be any approved spender (non-standard)
    function iTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) public virtual {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not authorized");
        _transfer(from, to, tokenId, proofs);
    }

    /// @notice Transfer without proof (metadata ownership not re-encrypted).
    ///         Useful for non-private transfers or admin operations.
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public virtual {
        INFTStorage storage $ = _getStorage();
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not authorized");
        require($.tokens[tokenId].owner == from, "Not owner");
        require(to != address(0), "Zero address");

        $.tokens[tokenId].owner = to;
        $.tokens[tokenId].approvedUser = address(0);
        delete $.tokens[tokenId].authorizedUsers;

        emit Transferred(tokenId, from, to);
    }

    // ================================================================
    //  IERC7857: Clone
    // ================================================================

    function _clone(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) internal returns (uint256) {
        (
            bytes[] memory sealedKeys,
            IntelligentData[] memory newDatas
        ) = _proofCheck(from, to, tokenId, proofs);

        INFTStorage storage $ = _getStorage();
        uint256 newTokenId = $.nextTokenId++;
        TokenData storage newToken = $.tokens[newTokenId];
        newToken.owner = to;
        for (uint256 i = 0; i < newDatas.length; i++) {
            newToken.iDatas.push(newDatas[i]);
        }

        emit Cloned(tokenId, newTokenId, from, to);
        emit PublishedSealedKey(to, newTokenId, sealedKeys);
        return newTokenId;
    }

    /// @inheritdoc IERC7857
    function iClone(
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) public virtual returns (uint256) {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not authorized");
        return _clone(ownerOf(tokenId), to, tokenId, proofs);
    }

    // ================================================================
    //  IERC7857: Authorization (usage)
    // ================================================================

    /// @inheritdoc IERC7857
    /// @dev Caller must be the owner OR a pre-approved usage operator.
    function authorizeUsage(uint256 tokenId, address user) public virtual {
        require(user != address(0), "Zero address");
        INFTStorage storage $ = _getStorage();
        address owner = ownerOf(tokenId);
        require(
            msg.sender == owner || $.usageOperators[owner][msg.sender],
            "Not owner or usage operator"
        );

        address[] storage authorizedUsers = $.tokens[tokenId].authorizedUsers;
        for (uint256 i = 0; i < authorizedUsers.length; i++) {
            require(authorizedUsers[i] != user, "Already authorized");
        }
        authorizedUsers.push(user);
        emit Authorization(owner, user, tokenId);
    }

    /// @inheritdoc IERC7857
    function revokeAuthorization(uint256 tokenId, address user) public virtual {
        INFTStorage storage $ = _getStorage();
        address owner = ownerOf(tokenId);
        require(
            msg.sender == owner || $.usageOperators[owner][msg.sender],
            "Not owner or usage operator"
        );
        require(user != address(0), "Zero address");

        address[] storage authorizedUsers = $.tokens[tokenId].authorizedUsers;
        bool found = false;
        for (uint256 i = 0; i < authorizedUsers.length; i++) {
            if (authorizedUsers[i] == user) {
                authorizedUsers[i] = authorizedUsers[authorizedUsers.length - 1];
                authorizedUsers.pop();
                found = true;
                break;
            }
        }
        require(found, "User not authorized");
        emit AuthorizationRevoked(owner, user, tokenId);
    }

    /// @notice Batch authorize multiple users at once
    function batchAuthorizeUsage(
        uint256 tokenId,
        address[] calldata users
    ) public virtual {
        require(users.length > 0, "Empty users array");
        INFTStorage storage $ = _getStorage();
        address owner = ownerOf(tokenId);
        require(
            msg.sender == owner || $.usageOperators[owner][msg.sender],
            "Not owner or usage operator"
        );
        for (uint256 i = 0; i < users.length; i++) {
            require(users[i] != address(0), "Zero address in users");
            $.tokens[tokenId].authorizedUsers.push(users[i]);
            emit Authorization(owner, users[i], tokenId);
        }
    }

    // ================================================================
    //  Non-standard: Usage Operator delegation
    //  Allows an owner to let another address call authorizeUsage/revokeAuthorization
    //  on their tokens.  The Marketplace uses this to grant/revoke access
    //  when rental orders are created/expired.
    // ================================================================

    /// @notice Grant or revoke usage-operator rights for a given token (non-standard extension)
    function setUsageOperator(
        uint256 tokenId,
        address operator,
        bool approved
    ) public virtual {
        require(operator != address(0), "Zero address");
        address owner = ownerOf(tokenId);
        require(msg.sender == owner, "Not owner");
        _getStorage().usageOperators[owner][operator] = approved;
        emit UsageDelegated(tokenId, owner, operator, approved);
    }

    /// @notice Check whether operator may call authorizeUsage for owner's tokens (non-standard)
    function isUsageOperator(
        address owner,
        address operator
    ) public view virtual returns (bool) {
        return _getStorage().usageOperators[owner][operator];
    }

    // ================================================================
    //  IERC7857: ERC-721-style approval
    // ================================================================

    /// @inheritdoc IERC7857
    function approve(address to, uint256 tokenId) public virtual {
        address owner = ownerOf(tokenId);
        require(to != owner, "Approval to current owner");
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender),
            "Not authorized"
        );
        _getStorage().tokens[tokenId].approvedUser = to;
        emit Approval(owner, to, tokenId);
    }

    /// @inheritdoc IERC7857
    function setApprovalForAll(address operator, bool approved) public virtual {
        require(operator != msg.sender, "Approve to caller");
        _getStorage().operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    // ================================================================
    //  IERC7857: Delegate access (access assistant)
    // ================================================================

    /// @inheritdoc IERC7857
    function delegateAccess(address assistant) public virtual {
        require(assistant != address(0), "Zero address");
        _getStorage().accessAssistants[msg.sender] = assistant;
        emit DelegateAccess(msg.sender, assistant);
    }

    // ================================================================
    //  IERC7857: View functions
    // ================================================================

    function ownerOf(uint256 tokenId) public view virtual returns (address) {
        INFTStorage storage $ = _getStorage();
        address owner = $.tokens[tokenId].owner;
        require(owner != address(0), "Token does not exist");
        return owner;
    }

    function authorizedUsersOf(
        uint256 tokenId
    ) public view virtual returns (address[] memory) {
        require(_exists(tokenId), "Token does not exist");
        return _getStorage().tokens[tokenId].authorizedUsers;
    }

    function getApproved(uint256 tokenId) public view virtual returns (address) {
        require(_exists(tokenId), "Token does not exist");
        return _getStorage().tokens[tokenId].approvedUser;
    }

    function isApprovedForAll(
        address owner,
        address operator
    ) public view virtual returns (bool) {
        return _getStorage().operatorApprovals[owner][operator];
    }

    function getDelegateAccess(address user) public view virtual returns (address) {
        return _getStorage().accessAssistants[user];
    }

    // ================================================================
    //  Internal helpers
    // ================================================================

    function _exists(uint256 tokenId) internal view returns (bool) {
        return _getStorage().tokens[tokenId].owner != address(0);
    }

    function _isApprovedOrOwner(
        address spender,
        uint256 tokenId
    ) internal view returns (bool) {
        require(_exists(tokenId), "Token does not exist");
        address owner = ownerOf(tokenId);
        return (
            spender == owner ||
            getApproved(tokenId) == spender ||
            isApprovedForAll(owner, spender)
        );
    }

    uint256[50] private __gap;
}
