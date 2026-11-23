// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Minimal stablecoin: only addresses with the minter role can create or destroy supply.
contract StableToken {
    string public constant name = "Test USD";
    string public constant symbol = "TUSD";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    address public immutable admin;
    mapping(address => uint256) public balanceOf;
    mapping(address => bool) public isMinter;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor() { admin = msg.sender; isMinter[msg.sender] = true; }

    function setMinter(address m, bool ok) external { require(msg.sender == admin, "not admin"); isMinter[m] = ok; }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v; balanceOf[to] += v; emit Transfer(msg.sender, to, v); return true;
    }
    function mint(address to, uint256 v) external {
        require(isMinter[msg.sender], "not minter");
        totalSupply += v; balanceOf[to] += v; emit Transfer(address(0), to, v);
    }
    function burnFrom(address from, uint256 v) external {
        require(isMinter[msg.sender], "not minter");
        balanceOf[from] -= v; totalSupply -= v; emit Transfer(from, address(0), v);
    }
}

/// Source side: burns the sender's tokens and emits a message describing the burn.
contract BurnMessenger {
    StableToken public immutable token;
    uint32 public immutable localDomain;
    uint64 public nextNonce;

    event MessageSent(bytes message);

    constructor(StableToken t, uint32 domain) { token = t; localDomain = domain; }

    function depositForBurn(uint256 amount, uint32 destDomain, address recipient) external returns (uint64 nonce) {
        token.burnFrom(msg.sender, amount);
        nonce = nextNonce++;
        emit MessageSent(abi.encode(localDomain, destDomain, nonce, msg.sender, recipient, amount));
    }
}

/// Destination side: mints only for messages signed by the attester, once per (sourceDomain, nonce).
contract MintTransmitter {
    StableToken public immutable token;
    uint32 public immutable localDomain;
    address public immutable attester;
    mapping(bytes32 => bool) public usedNonces;

    constructor(StableToken t, uint32 domain, address attester_) { token = t; localDomain = domain; attester = attester_; }

    function receiveMessage(bytes calldata message, bytes calldata signature) external {
        require(recover(keccak256(message), signature) == attester, "invalid attestation");
        (uint32 src, uint32 dst, uint64 nonce, , address recipient, uint256 amount) =
            abi.decode(message, (uint32, uint32, uint64, address, address, uint256));
        require(dst == localDomain, "wrong destination");
        bytes32 key = keccak256(abi.encode(src, nonce));
        require(!usedNonces[key], "nonce already used");
        usedNonces[key] = true;
        token.mint(recipient, amount);
    }

    function recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "bad signature length");
        bytes32 r = bytes32(sig[0:32]); bytes32 s = bytes32(sig[32:64]); uint8 v = uint8(sig[64]);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        return ecrecover(ethHash, v, r, s);
    }
}
