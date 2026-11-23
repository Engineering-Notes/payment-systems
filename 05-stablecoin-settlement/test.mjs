// Burn-and-mint between two local chains with an off-chain attester.
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import { ethers } from 'ethers';

const src = fs.readFileSync(new URL('./contracts.sol', import.meta.url), 'utf8');
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources: { 'c.sol': { content: src } },
  settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})));
if (out.errors?.some((e) => e.severity === 'error')) { console.log(out.errors); process.exit(1); }
const art = (n) => out.contracts['c.sol'][n];

const MNEMONIC = 'test test test test test test test test test test test junk';
async function chain(chainId) {
  const raw = ganache.provider({ chain: { chainId }, wallet: { mnemonic: MNEMONIC }, logging: { quiet: true } });
  const provider = new ethers.BrowserProvider(raw);
  const [admin, alice] = await Promise.all([provider.getSigner(0), provider.getSigner(1)]);
  return { raw, provider, admin, alice };
}
const deploy = async (signer, name, ...args) => {
  const f = new ethers.ContractFactory(art(name).abi, art(name).evm.bytecode.object, signer);
  const c = await f.deploy(...args); await c.waitForDeployment(); return c;
};
const mine = (c, n) => c.raw.request({ method: 'evm_mine', params: [{ blocks: n }] });
const USD = (x) => ethers.parseUnits(String(x), 6);
const fmt = (x) => ethers.formatUnits(x, 6);

const A = await chain(1001), B = await chain(1002);
const attesterKey = ethers.Wallet.createRandom();
const attackerKey = ethers.Wallet.createRandom();

const tokA = await deploy(A.admin, 'StableToken');
const tokB = await deploy(B.admin, 'StableToken');
const messenger = await deploy(A.admin, 'BurnMessenger', await tokA.getAddress(), 1);
const transmitter = await deploy(B.admin, 'MintTransmitter', await tokB.getAddress(), 2, attesterKey.address);
await (await tokA.setMinter(await messenger.getAddress(), true)).wait();
await (await tokB.setMinter(await transmitter.getAddress(), true)).wait();

// The issuer mints 1,000 against 1,000 of reserves on chain A.
const aliceAddr = await A.alice.getAddress();
await (await tokA.mint(aliceAddr, USD(1000))).wait();
const RESERVES = USD(1000);

const supply = async () => (await tokA.totalSupply()) + (await tokB.totalSupply());
const report = async (label) => {
  const s = await supply();
  console.log(`${label.padEnd(44)} supply A ${fmt(await tokA.totalSupply()).padStart(7)} | B ${fmt(await tokB.totalSupply()).padStart(6)}`
    + ` | total ${fmt(s).padStart(7)} | reserves ${fmt(RESERVES)} | unbacked ${fmt(s - RESERVES)}`);
};

// The attester: watches for MessageSent and signs once the burn is `confirmations` blocks deep.
async function attest(receipt, confirmations) {
  const log = receipt.logs.map((l) => { try { return messenger.interface.parseLog(l); } catch { return null; } }).find(Boolean);
  const message = log.args.message;
  const head = Number(await A.raw.request({ method: 'eth_blockNumber', params: [] }));
  if (head - receipt.blockNumber < confirmations) return null;   // not final yet: no attestation
  // Re-check the burn is still in the canonical chain before signing.
  const still = await A.raw.request({ method: 'eth_getTransactionReceipt', params: [receipt.hash] });
  if (!still || still.blockHash !== receipt.blockHash) return null;
  return { message, signature: await attesterKey.signMessage(ethers.getBytes(ethers.keccak256(message))) };
}
const tryMint = async (message, signature) => {
  const t = transmitter.connect(B.alice);
  try { await t.receiveMessage.staticCall(message, signature); }
  catch (e) { return 'reverted: ' + (e.reason ?? e.info?.error?.data?.reason ?? e.shortMessage); }
  await (await t.receiveMessage(message, signature, { gasLimit: 300000 })).wait();
  return 'minted';
};

await report('0 issuer mints 1,000 on chain A');

// 1. Normal transfer, attester waits for finality (64 blocks in this simulation).
const FINAL = 64;
let r = await (await messenger.connect(A.alice).depositForBurn(USD(100), 2, aliceAddr)).wait();
console.log('1 burn 100 on A; attestation before finality:', await attest(r, FINAL) === null ? 'withheld' : 'issued');
await mine(A, FINAL);
const att = await attest(r, FINAL);
console.log('  after 64 blocks, attestation:', att ? 'issued' : 'withheld', '| mint on B:', await tryMint(att.message, att.signature));
await report('  after transfer');

// 2. Replay the same message and signature.
console.log('2 replay same attestation:              ', await tryMint(att.message, att.signature));

// 3. Forged attestation signed by someone else.
const forged = await attackerKey.signMessage(ethers.getBytes(ethers.keccak256(att.message)));
console.log('3 forged signature:                     ', await tryMint(att.message, forged));

// 4. Tampered amount with the genuine signature.
const coder = ethers.AbiCoder.defaultAbiCoder();
const d = coder.decode(['uint32', 'uint32', 'uint64', 'address', 'address', 'uint256'], att.message);
const tampered = coder.encode(['uint32', 'uint32', 'uint64', 'address', 'address', 'uint256'], [d[0], d[1], d[2], d[3], d[4], USD(100000)]);
console.log('4 amount changed to 100,000, same sig:  ', await tryMint(tampered, att.signature));
await report('  after attacks');

// 5. Attester that signs at 0 confirmations, then the source chain reorganises.
const snap = await A.raw.request({ method: 'evm_snapshot', params: [] });
r = await (await messenger.connect(A.alice).depositForBurn(USD(200), 2, aliceAddr)).wait();
const early = await attest(r, 0);
console.log('5 burn 200 on A, attested at 0 confirmations, mint on B:', await tryMint(early.message, early.signature));
await A.raw.request({ method: 'evm_revert', params: [snap] });   // the block with the burn is orphaned
await mine(A, FINAL);
console.log('  source chain reorg: burn tx still on A?', !!(await A.raw.request({ method: 'eth_getTransactionReceipt', params: [r.hash] })));
await report('  after reorg');

// 6. Same reorg, attester waits for finality.
const snap2 = await A.raw.request({ method: 'evm_snapshot', params: [] });
r = await (await messenger.connect(A.alice).depositForBurn(USD(200), 2, aliceAddr)).wait();
await mine(A, 10);
console.log('6 burn 200 on A, 10 blocks later attestation:', await attest(r, FINAL) ? 'issued' : 'withheld');
await A.raw.request({ method: 'evm_revert', params: [snap2] });
await mine(A, FINAL);
console.log('  after reorg + 64 blocks, attestation:', (await A.raw.request({ method: 'eth_getTransactionReceipt', params: [r.hash] })) ? 'possible' : 'impossible, burn no longer exists');
await report('  final state');
process.exit(0);
