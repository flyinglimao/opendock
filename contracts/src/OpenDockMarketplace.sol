// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import {IOpenDockINFT, TransferValidityProof} from "./interfaces/IOpenDockINFT.sol";
import {OpenDockINFT} from "./OpenDockINFT.sol";

// ============================================================
//  OpenDock Marketplace
//  Supports two order types:
//   1. BuyOrder  — permanently transfers the iNFT to the buyer via iTransferFrom
//   2. RentOrder — grants the renter usage authorization for a fixed duration;
//                  upon expiry anyone can call `expireRent` to revoke it
// ============================================================

/**
 * @title  OpenDockMarketplace
 *
 * @notice Buy & Rent marketplace for ERC-7857 iNFTs.
 *
 * ## Buy flow
 *  1. Seller calls `approve(marketplace, tokenId)` on the iNFT contract.
 *  2. Seller calls `listBuy(tokenId, price)`.
 *  3. Buyer sends ETH + TEE proofs to `executeBuy(orderId, proofs)`.
 *     – The marketplace calls `iNFT.iTransferFrom(seller, buyer, tokenId, proofs)`.
 *     – Seller receives ETH (minus fee).
 *
 * ## Rent flow
 *  1. Owner calls `setUsageOperator(tokenId, marketplace, true)` on the iNFT.
 *  2. Owner calls `listRent(tokenId, pricePerSecond, maxDuration)`.
 *  3. Renter sends ETH + duration to `executeRent(orderId, duration)`.
 *     – Marketplace calls `iNFT.authorizeUsage(tokenId, renter)`.
 *     – Owner receives ETH (minus fee).
 *  4. After `startTime + duration`, anyone calls `expireRent(rentId)`.
 *     – Marketplace calls `iNFT.revokeAuthorization(tokenId, renter)`.
 *
 * Note: The marketplace must remain a usage-operator for the owner's token for the
 * entire rental period.  Owners should NOT revoke usage-operator status while an
 * active rental exists (this is enforced by on-chain state checks).
 */
// Inline reentrancy guard (OZ v5 upgradeable does not ship ReentrancyGuardUpgradeable)
abstract contract ReentrancyGuardUpgradeable is Initializable {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    function __ReentrancyGuard_init() internal onlyInitializing {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    uint256[49] private __gap;
}

contract OpenDockMarketplace is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    // ---- Roles ----
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ================================================================
    //  Storage structs
    // ================================================================

    enum OrderStatus {
        Active,
        Filled,
        Cancelled
    }

    struct BuyOrder {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 price;       // total ETH required
        OrderStatus status;
    }

    struct RentOrder {
        address owner;
        address nftContract;
        uint256 tokenId;
        uint256 pricePerSecond;
        uint256 maxDuration;   // in seconds; 0 = unlimited
        OrderStatus status;
    }

    struct ActiveRental {
        address renter;
        address nftContract;
        uint256 tokenId;
        uint256 rentOrderId;
        uint256 startTime;
        uint256 duration;      // in seconds
        bool revoked;
    }

    // ================================================================
    //  ERC-7201 namespaced storage
    // ================================================================

    /// @custom:storage-location erc7201:opendock.storage.Marketplace
    struct MarketplaceStorage {
        // Buy orders
        mapping(uint256 => BuyOrder) buyOrders;
        uint256 nextBuyOrderId;
        // Rent orders
        mapping(uint256 => RentOrder) rentOrders;
        uint256 nextRentOrderId;
        // Active rentals
        mapping(uint256 => ActiveRental) activeRentals;
        uint256 nextRentalId;
        // Count of active (non-revoked, non-expired) rentals per token.
        // Multiple renters can hold the same token simultaneously.
        mapping(address nftContract => mapping(uint256 tokenId => uint256 count))
            tokenActiveRentalCount;
        // Protocol fee in basis points (e.g. 250 = 2.5%)
        uint256 feeBps;
        address feeRecipient;
        // Pending withdrawals for sellers/owners
        mapping(address => uint256) pendingWithdrawals;
    }

    bytes32 private constant MARKETPLACE_STORAGE_LOCATION =
        0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a100;

    function _getStorage() private pure returns (MarketplaceStorage storage $) {
        assembly {
            $.slot := MARKETPLACE_STORAGE_LOCATION
        }
    }

    // ================================================================
    //  Events
    // ================================================================

    event BuyOrderCreated(
        uint256 indexed orderId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 price
    );
    event BuyOrderCancelled(uint256 indexed orderId);
    event BuyOrderFilled(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 tokenId
    );

    event RentOrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        address indexed nftContract,
        uint256 tokenId,
        uint256 pricePerSecond,
        uint256 maxDuration
    );
    event RentOrderCancelled(uint256 indexed orderId);
    event RentalStarted(
        uint256 indexed rentalId,
        uint256 indexed rentOrderId,
        address indexed renter,
        uint256 tokenId,
        uint256 duration
    );
    event RentalExpired(
        uint256 indexed rentalId,
        address indexed renter,
        uint256 tokenId
    );

    event FeesUpdated(uint256 feeBps, address feeRecipient);
    event Withdrawal(address indexed to, uint256 amount);

    // ================================================================
    //  Constructor / Initializer
    // ================================================================

    constructor() {}

    function initialize(
        address admin_,
        uint256 feeBps_,
        address feeRecipient_
    ) public initializer {
        require(admin_ != address(0), "Zero address: admin");
        require(feeRecipient_ != address(0), "Zero address: feeRecipient");
        require(feeBps_ <= 1000, "Fee too high"); // max 10%

        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);
        _grantRole(PAUSER_ROLE, admin_);

        MarketplaceStorage storage $ = _getStorage();
        $.feeBps = feeBps_;
        $.feeRecipient = feeRecipient_;
        $.nextRentalId = 1; // 0 reserved for "no active rental"
    }

    // ================================================================
    //  Admin
    // ================================================================

    function setFees(
        uint256 feeBps_,
        address feeRecipient_
    ) external onlyRole(ADMIN_ROLE) {
        require(feeBps_ <= 1000, "Fee too high");
        require(feeRecipient_ != address(0), "Zero address");
        MarketplaceStorage storage $ = _getStorage();
        $.feeBps = feeBps_;
        $.feeRecipient = feeRecipient_;
        emit FeesUpdated(feeBps_, feeRecipient_);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ================================================================
    //  Buy Order — create / cancel / execute
    // ================================================================

    /**
     * @notice List an iNFT for sale.
     * @dev    Seller must first call `nft.approve(marketplace, tokenId)` or
     *         `nft.setApprovalForAll(marketplace, true)`.
     */
    function listBuy(
        address nftContract,
        uint256 tokenId,
        uint256 price
    ) external whenNotPaused returns (uint256 orderId) {
        require(nftContract != address(0), "Zero address");
        require(price > 0, "Price must be > 0");

        OpenDockINFT nft = OpenDockINFT(nftContract);
        require(nft.ownerOf(tokenId) == msg.sender, "Not owner");
        require(
            nft.getApproved(tokenId) == address(this) ||
                nft.isApprovedForAll(msg.sender, address(this)),
            "Marketplace not approved"
        );

        MarketplaceStorage storage $ = _getStorage();
        orderId = $.nextBuyOrderId++;
        $.buyOrders[orderId] = BuyOrder({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: price,
            status: OrderStatus.Active
        });

        emit BuyOrderCreated(orderId, msg.sender, nftContract, tokenId, price);
    }

    /// @notice Cancel a buy listing (only seller)
    function cancelBuy(uint256 orderId) external {
        MarketplaceStorage storage $ = _getStorage();
        BuyOrder storage order = $.buyOrders[orderId];
        require(order.seller == msg.sender, "Not seller");
        require(order.status == OrderStatus.Active, "Order not active");
        order.status = OrderStatus.Cancelled;
        emit BuyOrderCancelled(orderId);
    }

    /**
     * @notice Execute a buy order.
     * @dev    Buyer provides the TEE proofs required by ERC-7857 iTransferFrom.
     *         The TEE flow requires the buyer to pre-arrange the re-encryption
     *         off-chain with the TEE, then submit the resulting proofs here.
     *
     * TEE Transfer via Marketplace:
     *   1. Buyer communicates with TEE off-chain, providing their public key.
     *   2. TEE re-encrypts agent data from seller's key to buyer's key.
     *   3. TEE produces AccessProof (signed by buyer/assistant) and OwnershipProof
     *      (signed by TEE enclave).
     *   4. Buyer calls this function with those proofs + ETH.
     */
    function executeBuy(
        uint256 orderId,
        TransferValidityProof[] calldata proofs
    ) external payable nonReentrant whenNotPaused {
        MarketplaceStorage storage $ = _getStorage();
        BuyOrder storage order = $.buyOrders[orderId];
        require(order.status == OrderStatus.Active, "Order not active");
        require(msg.value >= order.price, "Insufficient payment");

        // Mark filled before external calls (reentrancy guard also active)
        order.status = OrderStatus.Filled;

        address buyer = msg.sender;
        address seller = order.seller;
        uint256 tokenId = order.tokenId;

        // Call iTransferFrom — this is the full ERC-7857 TEE transfer
        IOpenDockINFT(order.nftContract).iTransferFrom(
            seller,
            buyer,
            tokenId,
            proofs
        );

        // Calculate and distribute fees
        uint256 fee = (order.price * $.feeBps) / 10_000;
        uint256 sellerProceeds = order.price - fee;

        $.pendingWithdrawals[seller] += sellerProceeds;
        $.pendingWithdrawals[$.feeRecipient] += fee;

        // Refund excess ETH
        uint256 excess = msg.value - order.price;
        if (excess > 0) {
            $.pendingWithdrawals[buyer] += excess;
        }

        emit BuyOrderFilled(orderId, buyer, tokenId);
    }

    // ================================================================
    //  Rent Order — create / cancel / execute / expire
    // ================================================================

    /**
     * @notice List an iNFT for rent.
     * @dev    Owner must first call `nft.setUsageOperator(tokenId, marketplace, true)`.
     * @param maxDuration  Maximum rental duration in seconds (0 = no limit)
     */
    function listRent(
        address nftContract,
        uint256 tokenId,
        uint256 pricePerSecond,
        uint256 maxDuration
    ) external whenNotPaused returns (uint256 orderId) {
        require(nftContract != address(0), "Zero address");
        require(pricePerSecond > 0, "Price must be > 0");

        OpenDockINFT nft = OpenDockINFT(nftContract);
        require(nft.ownerOf(tokenId) == msg.sender, "Not owner");
        require(
            nft.isUsageOperator(msg.sender, address(this)),
            "Marketplace not usage operator"
        );

        MarketplaceStorage storage $ = _getStorage();
        orderId = $.nextRentOrderId++;
        $.rentOrders[orderId] = RentOrder({
            owner: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            pricePerSecond: pricePerSecond,
            maxDuration: maxDuration,
            status: OrderStatus.Active
        });

        emit RentOrderCreated(
            orderId,
            msg.sender,
            nftContract,
            tokenId,
            pricePerSecond,
            maxDuration
        );
    }

    /// @notice Cancel a rent listing (only owner; no active rental must exist)
    function cancelRent(uint256 orderId) external {
        MarketplaceStorage storage $ = _getStorage();
        RentOrder storage order = $.rentOrders[orderId];
        require(order.owner == msg.sender, "Not owner");
        require(order.status == OrderStatus.Active, "Order not active");

        require(
            $.tokenActiveRentalCount[order.nftContract][order.tokenId] == 0,
            "Active rental exists"
        );

        order.status = OrderStatus.Cancelled;
        emit RentOrderCancelled(orderId);
    }

    /**
     * @notice Rent an iNFT for `duration` seconds.
     * @dev    No TEE proofs required — this only calls `authorizeUsage`.
     *         The TEE (Sealed Executor) will verify the renter's identity
     *         on-chain via `authorizedUsersOf` when the renter actually uses the agent.
     */
    function executeRent(
        uint256 orderId,
        uint256 duration
    ) external payable nonReentrant whenNotPaused {
        MarketplaceStorage storage $ = _getStorage();
        RentOrder storage order = $.rentOrders[orderId];
        require(order.status == OrderStatus.Active, "Order not active");
        require(duration > 0, "Duration must be > 0");
        require(
            order.maxDuration == 0 || duration <= order.maxDuration,
            "Duration exceeds max"
        );

        uint256 totalPrice = order.pricePerSecond * duration;
        require(msg.value >= totalPrice, "Insufficient payment");

        address renter = msg.sender;

        // Authorize the renter for usage via the marketplace's usage-operator role
        IOpenDockINFT(order.nftContract).authorizeUsage(order.tokenId, renter);

        // Create rental record
        uint256 rentalId = $.nextRentalId++;
        $.activeRentals[rentalId] = ActiveRental({
            renter: renter,
            nftContract: order.nftContract,
            tokenId: order.tokenId,
            rentOrderId: orderId,
            startTime: block.timestamp,
            duration: duration,
            revoked: false
        });
        $.tokenActiveRentalCount[order.nftContract][order.tokenId] += 1;

        // Distribute payment
        uint256 fee = (totalPrice * $.feeBps) / 10_000;
        uint256 ownerProceeds = totalPrice - fee;
        $.pendingWithdrawals[order.owner] += ownerProceeds;
        $.pendingWithdrawals[$.feeRecipient] += fee;

        // Refund excess
        uint256 excess = msg.value - totalPrice;
        if (excess > 0) {
            $.pendingWithdrawals[renter] += excess;
        }

        emit RentalStarted(rentalId, orderId, renter, order.tokenId, duration);
    }

    /**
     * @notice Revoke a renter's authorization after rental period ends.
     * @dev    Callable by anyone once the rental has expired.
     */
    function expireRent(uint256 rentalId) external nonReentrant {
        MarketplaceStorage storage $ = _getStorage();
        ActiveRental storage rental = $.activeRentals[rentalId];
        require(!rental.revoked, "Already revoked");
        require(
            block.timestamp >= rental.startTime + rental.duration,
            "Rental not yet expired"
        );

        rental.revoked = true;
        $.tokenActiveRentalCount[rental.nftContract][rental.tokenId] -= 1;

        // Revoke usage authorization via the marketplace's usage-operator role
        IOpenDockINFT(rental.nftContract).revokeAuthorization(
            rental.tokenId,
            rental.renter
        );

        emit RentalExpired(rentalId, rental.renter, rental.tokenId);
    }

    // ================================================================
    //  Withdraw (pull-payment pattern)
    // ================================================================

    function withdraw() external nonReentrant {
        MarketplaceStorage storage $ = _getStorage();
        uint256 amount = $.pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        $.pendingWithdrawals[msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawal(msg.sender, amount);
    }

    // ================================================================
    //  View helpers
    // ================================================================

    function getBuyOrder(uint256 orderId) external view returns (BuyOrder memory) {
        return _getStorage().buyOrders[orderId];
    }

    function getRentOrder(uint256 orderId) external view returns (RentOrder memory) {
        return _getStorage().rentOrders[orderId];
    }

    function getActiveRental(uint256 rentalId) external view returns (ActiveRental memory) {
        return _getStorage().activeRentals[rentalId];
    }

    function pendingWithdrawal(address account) external view returns (uint256) {
        return _getStorage().pendingWithdrawals[account];
    }

    function feeConfig() external view returns (uint256 feeBps, address feeRecipient) {
        MarketplaceStorage storage $ = _getStorage();
        return ($.feeBps, $.feeRecipient);
    }

    /// @notice True if the token has at least one active (non-expired) rental
    function isActivelyRented(
        address nftContract,
        uint256 tokenId
    ) external view returns (bool) {
        return _getStorage().tokenActiveRentalCount[nftContract][tokenId] > 0;
    }

    uint256[50] private __gap;
}
