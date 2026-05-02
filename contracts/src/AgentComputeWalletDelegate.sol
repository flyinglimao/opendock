// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IZeroGLedgerManager {
    function addLedger(string calldata additionalInfo)
        external
        payable
        returns (uint256, uint256);

    function depositFund() external payable;

    function refund(uint256 amount) external;

    function transferFund(
        address provider,
        string calldata serviceName,
        uint256 amount
    ) external;
}

/**
 * @title AgentComputeWalletDelegate
 * @notice EIP-7702 delegate code for hosted 0G Compute wallets.
 *
 * Calls execute in the delegated EOA's context, so LedgerManager observes
 * msg.sender as the hosted wallet address. The hosted wallet is bound to one
 * owner during setup; only that owner may move ledger or native funds.
 */
contract AgentComputeWalletDelegate {
    bytes32 private constant OWNER_SLOT =
        bytes32(uint256(keccak256("opendock.agent.compute.wallet.owner")) - 1);

    event OwnerInitialized(address indexed owner);

    event LedgerCreated(
        address indexed caller,
        address indexed ledger,
        uint256 amount
    );

    event LedgerDeposited(
        address indexed caller,
        address indexed ledger,
        uint256 amount
    );

    event ProviderFunded(
        address indexed caller,
        address indexed ledger,
        address indexed provider,
        string serviceName,
        uint256 depositAmount,
        uint256 transferAmount
    );

    event LedgerRefunded(
        address indexed caller,
        address indexed ledger,
        address indexed recipient,
        uint256 amount
    );

    event NativeWithdrawn(
        address indexed caller,
        address indexed recipient,
        uint256 amount
    );

    error InvalidLedger();
    error InvalidOwner();
    error InvalidProvider();
    error InvalidRecipient();
    error MissingValue();
    error InvalidTransferAmount();
    error AlreadyInitialized();
    error Unauthorized();
    error NativeTransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner()) revert Unauthorized();
        _;
    }

    receive() external payable {}

    function initializeOwner(address initialOwner) external {
        if (owner() != address(0)) revert AlreadyInitialized();
        if (initialOwner == address(0)) revert InvalidOwner();
        _setOwner(initialOwner);
        emit OwnerInitialized(initialOwner);
    }

    function owner() public view returns (address walletOwner) {
        bytes32 slot = OWNER_SLOT;
        assembly {
            walletOwner := sload(slot)
        }
    }

    function createLedger(address ledger, string calldata additionalInfo)
        external
        payable
        onlyOwner
    {
        _requireLedger(ledger);
        _requireValue();

        IZeroGLedgerManager(ledger).addLedger{value: msg.value}(additionalInfo);
        emit LedgerCreated(msg.sender, ledger, msg.value);
    }

    function depositLedger(address ledger) external payable onlyOwner {
        _requireLedger(ledger);
        _requireValue();

        IZeroGLedgerManager(ledger).depositFund{value: msg.value}();
        emit LedgerDeposited(msg.sender, ledger, msg.value);
    }

    function createLedgerAndFundProvider(
        address ledger,
        address provider,
        string calldata serviceName,
        uint256 transferAmount,
        string calldata additionalInfo
    ) external payable onlyOwner {
        _requireProviderFundingArgs(ledger, provider, transferAmount);
        _requireValue();

        IZeroGLedgerManager(ledger).addLedger{value: msg.value}(additionalInfo);
        IZeroGLedgerManager(ledger).transferFund(
            provider,
            serviceName,
            transferAmount
        );

        emit ProviderFunded(
            msg.sender,
            ledger,
            provider,
            serviceName,
            msg.value,
            transferAmount
        );
    }

    function depositAndFundProvider(
        address ledger,
        address provider,
        string calldata serviceName,
        uint256 transferAmount
    ) external payable onlyOwner {
        _requireProviderFundingArgs(ledger, provider, transferAmount);

        if (msg.value > 0) {
            IZeroGLedgerManager(ledger).depositFund{value: msg.value}();
        }
        IZeroGLedgerManager(ledger).transferFund(
            provider,
            serviceName,
            transferAmount
        );

        emit ProviderFunded(
            msg.sender,
            ledger,
            provider,
            serviceName,
            msg.value,
            transferAmount
        );
    }

    function fundProvider(
        address ledger,
        address provider,
        string calldata serviceName,
        uint256 transferAmount
    ) external onlyOwner {
        _requireProviderFundingArgs(ledger, provider, transferAmount);

        IZeroGLedgerManager(ledger).transferFund(
            provider,
            serviceName,
            transferAmount
        );

        emit ProviderFunded(
            msg.sender,
            ledger,
            provider,
            serviceName,
            0,
            transferAmount
        );
    }

    function refundLedgerToOwner(address ledger, uint256 amount)
        external
        onlyOwner
    {
        _requireLedger(ledger);
        if (amount == 0) revert InvalidTransferAmount();

        IZeroGLedgerManager(ledger).refund(amount);
        _sendNative(payable(msg.sender), amount);
        emit LedgerRefunded(msg.sender, ledger, msg.sender, amount);
    }

    function withdrawNative(address payable recipient, uint256 amount)
        external
        onlyOwner
    {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidTransferAmount();

        _sendNative(recipient, amount);
        emit NativeWithdrawn(msg.sender, recipient, amount);
    }

    function _requireProviderFundingArgs(
        address ledger,
        address provider,
        uint256 transferAmount
    ) internal pure {
        _requireLedger(ledger);
        if (provider == address(0)) revert InvalidProvider();
        if (transferAmount == 0) revert InvalidTransferAmount();
    }

    function _requireLedger(address ledger) internal pure {
        if (ledger == address(0)) revert InvalidLedger();
    }

    function _requireValue() internal view {
        if (msg.value == 0) revert MissingValue();
    }

    function _setOwner(address newOwner) internal {
        bytes32 slot = OWNER_SLOT;
        assembly {
            sstore(slot, newOwner)
        }
    }

    function _sendNative(address payable recipient, uint256 amount) internal {
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }
}
