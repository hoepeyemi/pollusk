// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "./interfaces/IERC20.sol";

/**
 * @title RuleRegistry
 * @notice On-chain registry for storing crypto price alert rules
 *
 * @dev Rules are written via Somnia reactivity: a trusted RuleRegistryReactivityHandler
 *      subscribes to events (e.g. RuleRequestEmitter.RuleRequested); when the chain invokes
 *      the handler, it calls writeRuleFromReactivity(data). Owner sets the handler via setReactivityHandler.
 *      Off-chain services (Somnia Reactivity SDK) can run cron subscriptions and filtered/wildcard
 *      subscriptions for price checks and notifications.
 * @dev This contract also acts as an x402 payment receiver (STT); owner can withdraw.
 */
contract RuleRegistry is Ownable {
    // ============================================================================
    // Types & Data Structures
    // ============================================================================

    /**
     * @notice Price alert rule structure
     * @dev Rules are stored on-chain and can be queried by the CRE workflow
     * @param id Deterministic rule ID (SHA256 hash of alert data) - bytes32 for on-chain compatibility
     * @param asset Cryptocurrency asset symbol (e.g., "BTC", "ETH", "LINK")
     * @param condition Price condition: "gt", "lt", "gte", or "lte"
     * @param targetPriceUsd Target price in USD (stored as uint256, no decimals)
     * @param createdAt UNIX timestamp (seconds) when the rule was created
     */
    struct Rule {
        bytes32 id;
        string asset;
        string condition;
        uint256 targetPriceUsd;
        uint256 createdAt;
    }

    // ============================================================================
    // State Variables
    // ============================================================================

    /**
     * @notice STT token contract address
     * @dev Set in constructor, used for receiving x402 payments
     * @dev STT typically has 6 decimals
     */
    address public usdcToken;

    /**
     * @notice Trusted Somnia reactivity handler allowed to call writeRuleFromReactivity
     * @dev When set, only this address can submit rules via on-chain event reactivity
     */
    address public reactivityHandler;

    /**
     * @notice Next available rule ID
     * @dev Increments each time a new rule is written
     * @dev Used to iterate over all rules (0 to nextRuleId - 1)
     */
    uint256 public nextRuleId;

    /**
     * @notice Mapping from rule ID to Rule struct
     * @dev Rules are stored with incremental IDs starting from 0
     * @dev To get all rules, iterate from 0 to nextRuleId - 1
     */
    mapping(uint256 => Rule) public rules;

    // ============================================================================
    // Events
    // ============================================================================

    /**
     * @notice Emitted when a new rule is created
     * @param ruleId The incremental rule ID assigned to this rule
     * @param id The deterministic rule ID (bytes32 hash)
     * @param asset Cryptocurrency asset symbol
     * @param condition Price condition string
     * @param targetPriceUsd Target price in USD
     * @param createdAt UNIX timestamp when rule was created
     */
    event RuleCreated(
        uint256 indexed ruleId,
        bytes32 indexed id,
        string asset,
        string condition,
        uint256 targetPriceUsd,
        uint256 createdAt
    );

    /**
     * @notice Emitted when STT is withdrawn from the contract
     * @param token The token address (STT)
     * @param to The recipient address
     * @param amount The amount withdrawn (in STT's decimals, typically 6)
     */
    event Withdrawal(address indexed token, address indexed to, uint256 amount);

    /**
     * @notice Emitted when the Somnia reactivity handler is set or updated
     */
    event ReactivityHandlerUpdated(address indexed previousHandler, address indexed newHandler);

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyReactivityHandler() {
        require(msg.sender == reactivityHandler, "RuleRegistry: caller is not the reactivity handler");
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    /**
     * @notice Initializes the RuleRegistry contract
     * @param _usdcToken Address of the STT token contract (for x402 payments)
     */
    constructor(address _usdcToken) Ownable(msg.sender) {
        require(_usdcToken != address(0), "RuleRegistry: STT token address cannot be zero");
        usdcToken = _usdcToken;
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    /**
     * @notice Writes a new rule to the registry
     * @dev Internal; called by writeRuleFromReactivity (Somnia reactivity handler)
     * @param _id Deterministic rule ID (bytes32 hash of alert data)
     * @param _asset Cryptocurrency asset symbol
     * @param _condition Price condition string ("gt", "lt", "gte", "lte")
     * @param _targetPriceUsd Target price in USD
     * @param _createdAt UNIX timestamp when rule was created
     * @return ruleId The incremental rule ID assigned to this rule
     */
    function _writeRule(
        bytes32 _id,
        string memory _asset,
        string memory _condition,
        uint256 _targetPriceUsd,
        uint256 _createdAt
    ) internal returns (uint256) {
        // Assign next available rule ID
        uint256 ruleId = nextRuleId;
        nextRuleId++;

        // Store rule in mapping
        rules[ruleId] = Rule({
            id: _id,
            asset: _asset,
            condition: _condition,
            targetPriceUsd: _targetPriceUsd,
            createdAt: _createdAt
        });

        // Emit event for off-chain indexing and monitoring
        emit RuleCreated(ruleId, _id, _asset, _condition, _targetPriceUsd, _createdAt);

        return ruleId;
    }

    // ============================================================================
    // Somnia Reactivity Integration
    // ============================================================================

    /**
     * @notice Set the trusted Somnia reactivity handler that can write rules via writeRuleFromReactivity
     * @dev Only callable by owner. Use address(0) to disable reactivity-based rule writes.
     * @param _handler Address of the deployed RuleRegistryReactivityHandler (or 0 to disable)
     */
    function setReactivityHandler(address _handler) external onlyOwner {
        address previous = reactivityHandler;
        reactivityHandler = _handler;
        emit ReactivityHandlerUpdated(previous, _handler);
    }

    /**
     * @notice Write a rule from Somnia on-chain reactivity (event-driven)
     * @dev Only the address set as reactivityHandler can call this. Decodes ABI-encoded
     *      (bytes32 id, string asset, string condition, uint256 targetPriceUsd, uint256 createdAt).
     * @param data ABI-encoded rule params; same format as CRE report payload
     */
    function writeRuleFromReactivity(bytes calldata data) external onlyReactivityHandler {
        (bytes32 id, string memory asset, string memory condition, uint256 targetPriceUsd, uint256 createdAt) =
            abi.decode(data, (bytes32, string, string, uint256, uint256));
        _writeRule(id, asset, condition, targetPriceUsd, createdAt);
    }

    /**
     * @notice Write a rule directly (owner only). Use when the on-chain reactivity subscription is not set up.
     * @dev Same params as writeRuleFromReactivity; allows backend to persist rules for run-check/Pushover.
     */
    function writeRuleByOwner(
        bytes32 _id,
        string calldata _asset,
        string calldata _condition,
        uint256 _targetPriceUsd,
        uint256 _createdAt
    ) external onlyOwner {
        _writeRule(_id, _asset, _condition, _targetPriceUsd, _createdAt);
    }

    // ============================================================================
    // Public View Functions
    // ============================================================================

    /**
     * @notice Retrieves a single rule by its rule ID
     * @dev Public view function for querying individual rules
     * @param _ruleId The incremental rule ID (0-indexed)
     * @return Rule struct containing all rule data
     * 
     * @custom:reverts If ruleId >= nextRuleId (rule doesn't exist)
     */
    function getRule(uint256 _ruleId) public view returns (Rule memory) {
        require(_ruleId < nextRuleId, "Rule does not exist");
        return rules[_ruleId];
    }

    /**
     * @notice Retrieves all rules stored in the registry
     * @dev Public view function that returns all rules as an array
     * @dev Iterates from rule ID 0 to nextRuleId - 1
     * @return Array of all Rule structs
     * 
     * @custom:gas This function can be gas-intensive for large numbers of rules.
     *             Consider using getRuleCount() and getRule() for pagination.
     */
    function getAllRules() public view returns (Rule[] memory) {
        // Allocate array with size equal to number of rules
        Rule[] memory allRules = new Rule[](nextRuleId);
        
        // Populate array by iterating over all rule IDs
        for (uint256 i = 0; i < nextRuleId; i++) {
            allRules[i] = rules[i];
        }
        
        return allRules;
    }

    /**
     * @notice Returns the total number of rules stored in the registry
     * @dev Useful for pagination and determining array sizes
     * @return The number of rules (equal to nextRuleId)
     */
    function getRuleCount() public view returns (uint256) {
        return nextRuleId;
    }

    // ============================================================================
    // x402 Payment Receiver Functions
    // ============================================================================

    /**
     * @notice Gets the STT balance of this contract
     * @dev This contract can receive STT payments via x402 protocol
     * @dev The balance accumulates as users pay for creating alerts
     * @return The STT balance of the contract (in STT's decimals, typically 6)
     * 
     * @custom:note STT has 6 decimals, so a return value of 1000000 represents 1 STT
     * 
     * @custom:reverts If usdcToken address is not set (should never happen after deployment)
     */
    function getUSDCBalance() external view returns (uint256) {
        require(usdcToken != address(0), "RuleRegistry: STT token address not set");
        IERC20 usdc = IERC20(usdcToken);
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice Withdraws STT tokens from the contract
     * @dev Only the contract owner can withdraw accumulated STT payments
     * @dev This allows the owner to collect payments received via x402 protocol
     * @param to The address to send the STT to
     * @param amount The amount of STT to withdraw (in STT's decimals, typically 6)
     * 
     * @custom:note STT has 6 decimals, so to withdraw 1 STT, pass 1000000
     * 
     * @custom:reverts If:
     *             - Caller is not the owner
     *             - usdcToken address is not set
     *             - to address is zero
     *             - amount is zero
     *             - Contract balance is insufficient
     *             - STT transfer fails
     * 
     * @custom:emits Withdrawal event on successful withdrawal
     */
    function withdrawUSDC(address to, uint256 amount) external onlyOwner {
        require(usdcToken != address(0), "RuleRegistry: STT token address not set");
        require(to != address(0), "RuleRegistry: invalid recipient address");
        require(amount > 0, "RuleRegistry: amount must be greater than zero");

        IERC20 usdc = IERC20(usdcToken);
        uint256 balance = usdc.balanceOf(address(this));
        require(balance >= amount, "RuleRegistry: insufficient STT balance");

        // Transfer STT to recipient
        require(usdc.transfer(to, amount), "RuleRegistry: STT transfer failed");
        
        // Emit event for off-chain monitoring
        emit Withdrawal(usdcToken, to, amount);
    }
}
