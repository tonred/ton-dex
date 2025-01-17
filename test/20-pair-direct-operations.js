const {expect} = require('chai');
const {Migration, afterRun, Constants} = require(process.cwd() + '/scripts/utils');
const BigNumber = require('bignumber.js');
const { Command } = require('commander');
const program = new Command();
BigNumber.config({EXPONENTIAL_AT: 257});
const logger = require('mocha-logger');

let tx;

const logTx = (tx) => logger.success(`Transaction: ${tx.transaction.id}`);

const migration = new Migration();

program
    .allowUnknownOption()
    .option('-cn, --contract_name <contract_name>', 'DexPair contract name');

program.parse(process.argv);

const options = program.opts();

options.contract_name = options.contract_name || 'DexPair';

const TOKEN_CONTRACTS_PATH = 'node_modules/ton-eth-bridge-token-contracts/free-ton/build';

let DexRoot
let DexVault;
let DexPairFooBar;
let FooVaultWallet;
let BarVaultWallet;
let FooBarLpVaultWallet;
let FooPairWallet;
let BarPairWallet;
let FooBarLpPairWallet;
let FooRoot;
let BarRoot;
let FooBarLpRoot;
let Account3;
let FooWallet3;
let BarWallet3;
let FooBarLpWallet3;

const EMPTY_TVM_CELL = 'te6ccgEBAQEAAgAAAA==';

let IS_FOO_LEFT;

let keyPairs;

async function dexBalances() {
    const foo = await FooVaultWallet.call({method: 'balance', params: {_answer_id: 0}}).then(n => {
        return new BigNumber(n).shiftedBy(-Constants.tokens.foo.decimals).toString();
    });
    const bar = await BarVaultWallet.call({method: 'balance', params: {_answer_id: 0}}).then(n => {
        return new BigNumber(n).shiftedBy(-Constants.tokens.bar.decimals).toString();
    });
    const lp = await FooBarLpVaultWallet.call({method: 'balance', params: {_answer_id: 0}}).then(n => {
        return new BigNumber(n).shiftedBy(-Constants.LP_DECIMALS).toString();
    });
    return {foo, bar, lp};
}

async function account3balances() {
    let foo;
    await FooWallet3.call({method: 'balance', params: {_answer_id: 0}}).then(n => {
        foo = new BigNumber(n).shiftedBy(-Constants.tokens.foo.decimals).toString();
    }).catch(e => {/*ignored*/});
    let bar;
    await BarWallet3.call({method: 'balance', params: {_answer_id: 0}}).then(n => {
        bar = new BigNumber(n).shiftedBy(-Constants.tokens.bar.decimals).toString();
    }).catch(e => {/*ignored*/});
    let lp;
    await FooBarLpWallet3.call({method: 'balance', params: {_answer_id: 0}}).then(n => {
        lp = new BigNumber(n).shiftedBy(-Constants.LP_DECIMALS).toString();
    }).catch(e => {/*ignored*/});
    const ton = await locklift.utils.convertCrystal((await locklift.ton.getBalance(Account3.address)), 'ton').toNumber();
    return {foo, bar, lp, ton};
}

async function dexPairInfo() {
    const balances = await DexPairFooBar.call({method: 'getBalances', params: {_answer_id: 0}});
    const total_supply = await FooBarLpRoot.call({method: 'getTotalSupply', params: {'_answer_id': 0}});
    let foo, bar;
    if (IS_FOO_LEFT) {
        foo = new BigNumber(balances.left_balance).shiftedBy(-Constants.tokens.foo.decimals).toString();
        bar = new BigNumber(balances.right_balance).shiftedBy(-Constants.tokens.bar.decimals).toString();
    } else {
        foo = new BigNumber(balances.right_balance).shiftedBy(-Constants.tokens.foo.decimals).toString();
        bar = new BigNumber(balances.left_balance).shiftedBy(-Constants.tokens.bar.decimals).toString();
    }

    return {
        foo: foo,
        bar: bar,
        lp_supply: new BigNumber(balances.lp_supply).shiftedBy(-Constants.LP_DECIMALS).toString(),
        lp_supply_actual: new BigNumber(total_supply).shiftedBy(-Constants.LP_DECIMALS).toString()
    };
}

function logBalances(header, dex, account, pair) {
    logger.log(`DEX balance ${header}: ${dex.foo} FOO, ${dex.bar} BAR, ${dex.lp} LP`);
    logger.log(`DexPair ${header}: ` +
        `${pair.foo} FOO, ${pair.bar} BAR, ` +
        `LP SUPPLY (PLAN): ${pair.lp_supply || "0"} LP, ` +
        `LP SUPPLY (ACTUAL): ${pair.lp_supply_actual|| "0"} LP`);
    logger.log(`Account#3 balance ${header}: ` +
        `${account.foo !== undefined ? account.foo + ' FOO' : 'FOO (not deployed)'}, ` +
        `${account.bar !== undefined ? account.bar + ' BAR' : 'BAR (not deployed)'}, ` +
        `${account.lp !== undefined ? account.lp + ' LP' : 'LP (not deployed)'}`);
}

function logExpectedDeposit(expected) {

    const left_decimals = IS_FOO_LEFT ? Constants.tokens.foo.decimals : Constants.tokens.bar.decimals;
    const right_decimals = IS_FOO_LEFT ? Constants.tokens.bar.decimals : Constants.tokens.foo.decimals;

    logger.log(`Expected result: `);
    if (expected.step_1_lp_reward.isZero()) {
        logger.log(`    Step 1: skipped`);
    } else {
        logger.log(`    Step 1: `);
        logger.log(`        Left deposit = ${expected.step_1_left_deposit.shiftedBy(-left_decimals).toString()}`);
        logger.log(`        Right deposit = ${expected.step_1_right_deposit.shiftedBy(-right_decimals).toString()}`);
        logger.log(`        LP reward = ${expected.step_1_lp_reward.shiftedBy(-Constants.LP_DECIMALS).toString()}`);
    }
    if (expected.step_2_left_to_right) {
        logger.log(`    Step 2: `);
        logger.log(`        Left amount for change = ${expected.step_2_spent.shiftedBy(-left_decimals).toString()}`);
        logger.log(`        Left fee = ${expected.step_2_fee.shiftedBy(-left_decimals).toString()}`);
        logger.log(`        Right received amount = ${expected.step_2_received.shiftedBy(-right_decimals).toString()}`);
    } else if (expected.step_2_right_to_left) {
        logger.log(`    Step 2: `);
        logger.log(`        Right amount for change = ${expected.step_2_spent.shiftedBy(-right_decimals).toString()}`);
        logger.log(`        Right fee = ${expected.step_2_fee.shiftedBy(-right_decimals).toString()}`);
        logger.log(`        Left received amount = ${expected.step_2_received.shiftedBy(-left_decimals).toString()}`);
    } else {
        logger.log(`    Step 2: skipped`);
    }
    if (expected.step_3_lp_reward.isZero()) {
        logger.log(`    Step 3: skipped`);
    } else {
        logger.log(`    Step 3: `);
        logger.log(`        Left deposit = ${expected.step_3_left_deposit.shiftedBy(-left_decimals).toString()}`);
        logger.log(`        Right deposit = ${expected.step_3_right_deposit.shiftedBy(-right_decimals).toString()}`);
        logger.log(`        LP reward = ${expected.step_3_lp_reward.shiftedBy(-Constants.LP_DECIMALS).toString()}`);
    }
    logger.log(`    TOTAL: `);
    logger.log(`        LP reward = ${expected.step_1_lp_reward.plus(expected.step_3_lp_reward).shiftedBy(-Constants.LP_DECIMALS).toString()}`);
}

async function logGas() {
    await migration.balancesCheckpoint();
    const diff = await migration.balancesLastDiff();
    if (diff) {
        logger.log(`### GAS STATS ###`);
        for (let alias in diff) {
            logger.log(`${alias}: ${diff[alias].gt(0) ? '+' : ''}${diff[alias].toFixed(9)} TON`);
        }
    }
}

describe('Check direct DexPairFooBar operations', async function () {
    this.timeout(Constants.TESTS_TIMEOUT);
    before('Load contracts', async function () {
        keyPairs = await locklift.keys.getKeyPairs();

        DexRoot = await locklift.factory.getContract('DexRoot');
        DexVault = await locklift.factory.getContract('DexVault');
        DexPairFooBar = await locklift.factory.getContract(options.contract_name);
        FooRoot = await locklift.factory.getContract('RootTokenContract', TOKEN_CONTRACTS_PATH);
        BarRoot = await locklift.factory.getContract('RootTokenContract', TOKEN_CONTRACTS_PATH);
        FooBarLpRoot = await locklift.factory.getContract('RootTokenContract', TOKEN_CONTRACTS_PATH);
        FooVaultWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_CONTRACTS_PATH);
        BarVaultWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_CONTRACTS_PATH);
        FooBarLpVaultWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_CONTRACTS_PATH);
        FooPairWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_CONTRACTS_PATH);
        BarPairWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_CONTRACTS_PATH);
        FooBarLpPairWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_CONTRACTS_PATH);
        Account3 = await locklift.factory.getAccount('Wallet');
        Account3.afterRun = afterRun;
        FooWallet3 = await locklift.factory.getContract('TONTokenWallet', TOKEN_CONTRACTS_PATH);
        BarWallet3 = await locklift.factory.getContract('TONTokenWallet', TOKEN_CONTRACTS_PATH);
        FooBarLpWallet3 = await locklift.factory.getContract('TONTokenWallet', TOKEN_CONTRACTS_PATH);

        migration.load(DexRoot, 'DexRoot');
        migration.load(DexVault, 'DexVault');
        migration.load(DexPairFooBar, 'DexPairFooBar');
        migration.load(FooVaultWallet, 'FooVaultWallet');
        migration.load(BarVaultWallet, 'BarVaultWallet');
        migration.load(FooBarLpVaultWallet, 'FooBarLpVaultWallet');
        migration.load(FooPairWallet, 'FooBarPair_FooWallet');
        migration.load(BarPairWallet, 'FooBarPair_BarWallet');
        migration.load(FooBarLpPairWallet, 'FooBarPair_LpWallet');
        migration.load(FooRoot, 'FooRoot');
        migration.load(BarRoot, 'BarRoot');
        migration.load(FooBarLpRoot, 'FooBarLpRoot');
        migration.load(Account3, 'Account3');
        migration.load(FooWallet3, 'FooWallet3');

        if (migration.exists('BarWallet3')) {
            migration.load(BarWallet3, 'BarWallet3');
            logger.log(`BarWallet#3: ${BarWallet3.address}`);
        } else {
            const expected = await BarRoot.call({
                method: 'getWalletAddress', params: {
                    _answer_id: 0,
                    wallet_public_key_: `0x0`,
                    owner_address_: Account3.address
                }
            });
            logger.log(`BarWallet#3: ${expected} (not deployed)`);
        }
        if (migration.exists('FooBarLpWallet3')) {
            migration.load(FooBarLpWallet3, 'FooBarLpWallet3');
            logger.log(`FooBarLpWallet3#3: ${FooBarLpWallet3.address}`);
        } else {
            const expected = await FooBarLpRoot.call({
                method: 'getWalletAddress', params: {
                    _answer_id: 0,
                    wallet_public_key_: `0x0`,
                    owner_address_: Account3.address
                }
            });
            logger.log(`FooBarLpWallet#3: ${expected} (not deployed)`);
        }
        const pairRoots = await DexPairFooBar.call({method: 'getTokenRoots', params: {_answer_id: 0}});
        IS_FOO_LEFT = pairRoots.left === FooRoot.address;

        logger.log(`Vault wallets: 
            FOO: ${FooVaultWallet.address}
            BAR: ${BarVaultWallet.address}
            LP: ${FooBarLpVaultWallet.address}
        `);

        logger.log(`Pair wallets: 
            FOO: ${FooPairWallet.address}
            BAR: ${BarPairWallet.address}
            LP: ${FooBarLpPairWallet.address}
        `);

        logger.log('DexRoot: ' + DexRoot.address);
        logger.log('DexVault: ' + DexVault.address);
        logger.log('DexPairFooBar: ' + DexPairFooBar.address);
        logger.log('FooRoot: ' + FooRoot.address);
        logger.log('BarRoot: ' + BarRoot.address);
        logger.log('Account#3: ' + Account3.address);
        logger.log('FooWallet#3: ' + FooWallet3.address);
        
        await migration.balancesCheckpoint();
    });

    describe('Direct exchange (positive)', async function () {
        it('Account#3 exchange FOO to BAR (with deploy BarWallet#3)', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 exchange FOO to BAR (with deploy BarWallet#3)');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const TOKENS_TO_EXCHANGE = 1000;

            const expected = await DexPairFooBar.call({
                method: 'expectedExchange', params: {
                    amount: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    spent_token_root: FooRoot.address
                }
            });

            logger.log(`Spent amount: ${TOKENS_TO_EXCHANGE} FOO`);
            logger.log(`Expected fee: ${new BigNumber(expected.expected_fee).shiftedBy(-Constants.tokens.foo.decimals).toString()} FOO`);
            logger.log(`Expected receive amount: ${new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.bar.decimals).toString()} BAR`);

            const payload = await DexPairFooBar.call({
                method: 'buildExchangePayload', params: {
                    id: 0,
                    deploy_wallet_grams: locklift.utils.convertCrystal('0.05', 'nano'),
                    expected_amount: expected.expected_amount
                }
            });

            tx = await Account3.runTarget({
                contract: FooWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('3', 'nano'),
                keyPair: keyPairs[2]
            });
            
            logTx(tx);

            BarWallet3.setAddress(await BarRoot.call({
                method: 'getWalletAddress', params: {
                    _answer_id: 0,
                    wallet_public_key_: `0x0`,
                    owner_address_: Account3.address
                }
            }));

            migration.store(BarWallet3, 'BarWallet3');

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            const expectedDexFoo = new BigNumber(dexStart.foo).plus(TOKENS_TO_EXCHANGE).toString();
            const expectedDexBar = new BigNumber(dexStart.bar)
                .minus(new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.bar.decimals)).toString();
            const expectedAccountFoo = new BigNumber(accountStart.foo).minus(TOKENS_TO_EXCHANGE).toString();
            const expectedAccountBar = new BigNumber(accountStart.bar || 0)
                .plus(new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.bar.decimals)).toString();

            expect(expectedDexFoo).to.equal(dexEnd.foo.toString(), 'Wrong DEX FOO balance');
            expect(expectedDexBar).to.equal(dexEnd.bar.toString(), 'Wrong DEX BAR balance');
            expect(expectedAccountFoo).to.equal(accountEnd.foo.toString(), 'Wrong Account#3 FOO balance');
            expect(expectedAccountBar).to.equal(accountEnd.bar.toString(), 'Wrong Account#3 BAR balance');
        });

        it('Account#3 exchange BAR to FOO', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 exchange BAR to FOO');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const TOKENS_TO_EXCHANGE = 100;

            const expected = await DexPairFooBar.call({
                method: 'expectedExchange', params: {
                    amount: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.bar.decimals).toString(),
                    spent_token_root: BarRoot.address
                }
            });

            logger.log(`Spent amount: ${TOKENS_TO_EXCHANGE.toString()} BAR`);
            logger.log(`Expected fee: ${new BigNumber(expected.expected_fee).shiftedBy(-Constants.tokens.bar.decimals).toString()} BAR`);
            logger.log(`Expected receive amount: ${new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.foo.decimals).toString()} FOO`);

            const payload = await DexPairFooBar.call({
                method: 'buildExchangePayload', params: {
                    id: 0,
                    deploy_wallet_grams: 0,
                    expected_amount: expected.expected_amount
                }
            });

            tx = await Account3.runTarget({
                contract: BarWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.bar.decimals).toString(),
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('2.3', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            const expectedDexFoo = new BigNumber(dexStart.foo)
                .minus(new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.foo.decimals)).toString();
            const expectedDexBar = new BigNumber(dexStart.bar).plus(TOKENS_TO_EXCHANGE).toString();
            const expectedAccountFoo = new BigNumber(accountStart.foo)
                .plus(new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.foo.decimals)).toString();
            const expectedAccountBar = new BigNumber(accountStart.bar).minus(TOKENS_TO_EXCHANGE).toString();

            expect(expectedDexFoo).to.equal(dexEnd.foo.toString(), 'Wrong DEX FOO balance');
            expect(expectedDexBar).to.equal(dexEnd.bar.toString(), 'Wrong DEX BAR balance');
            expect(expectedAccountFoo).to.equal(accountEnd.foo.toString(), 'Wrong Account#3 FOO balance');
            expect(expectedAccountBar).to.equal(accountEnd.bar.toString(), 'Wrong Account#3 BAR balance');
        });

        it('Account#3 exchange BAR to FOO (expectedSpendAmount)', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 exchange BAR to FOO');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const TOKENS_TO_RECEIVE = 1;

            const expected = await DexPairFooBar.call({
                method: 'expectedSpendAmount', params: {
                    receive_amount: new BigNumber(TOKENS_TO_RECEIVE).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    receive_token_root: FooRoot.address
                }
            });

            logger.log(`Expected spend amount: ${new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.bar.decimals).toString()} BAR`);
            logger.log(`Expected fee: ${new BigNumber(expected.expected_fee).shiftedBy(-Constants.tokens.bar.decimals).toString()} BAR`);
            logger.log(`Expected receive amount: ${TOKENS_TO_RECEIVE} FOO`);

            const payload = await DexPairFooBar.call({
                method: 'buildExchangePayload', params: {
                    id: 0,
                    deploy_wallet_grams: 0,
                    expected_amount: 0
                }
            });

            tx = await Account3.runTarget({
                contract: BarWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: expected.expected_amount,
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('2.3', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            const expectedDexFoo = new BigNumber(dexStart.foo)
                .minus(TOKENS_TO_RECEIVE).toString();
            const expectedDexBar = new BigNumber(dexStart.bar)
                .plus(new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.bar.decimals)).toString();
            const expectedAccountFoo = new BigNumber(accountStart.foo)
                .plus(TOKENS_TO_RECEIVE).toString();
            const expectedAccountBar = new BigNumber(accountStart.bar)
                .minus(new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.bar.decimals)).toString();

            expect(expectedDexFoo).to.equal(dexEnd.foo.toString(), 'Wrong DEX FOO balance');
            expect(expectedDexBar).to.equal(dexEnd.bar.toString(), 'Wrong DEX BAR balance');
            expect(expectedAccountFoo).to.equal(accountEnd.foo.toString(), 'Wrong Account#3 FOO balance');
            expect(expectedAccountBar).to.equal(accountEnd.bar.toString(), 'Wrong Account#3 BAR balance');
        });

        it('Account#3 exchange FOO to BAR (small amount)', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 exchange FOO to BAR (small amount)');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const AMOUNT = 100;

            const expected = await DexPairFooBar.call({
                method: 'expectedExchange', params: {
                    amount: AMOUNT,
                    spent_token_root: FooRoot.address
                }
            });

            logger.log(`Expected fee: ${new BigNumber(expected.expected_fee).shiftedBy(-Constants.tokens.foo.decimals).toString()} FOO`);
            logger.log(`Expected receive amount: ${new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.bar.decimals).toString()} BAR`);

            const payload = await DexPairFooBar.call({
                method: 'buildExchangePayload', params: {
                    id: 0,
                    deploy_wallet_grams: 0,
                    expected_amount: 0
                }
            });

            tx = await Account3.runTarget({
                contract: FooWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: AMOUNT,
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('2.6', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            const expectedDexBar = new BigNumber(dexStart.bar)
                .minus(new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.bar.decimals)).toString();
            const expectedDexFoo = new BigNumber(dexStart.foo).plus(new BigNumber(AMOUNT).shiftedBy(-Constants.tokens.foo.decimals)).toString();
            const expectedAccountBar = new BigNumber(accountStart.bar)
                .plus(new BigNumber(expected.expected_amount).shiftedBy(-Constants.tokens.bar.decimals)).toString();
            const expectedAccountFoo = new BigNumber(accountStart.foo).minus(new BigNumber(AMOUNT).shiftedBy(-Constants.tokens.foo.decimals)).toString();

            expect(expectedDexFoo).to.equal(dexEnd.foo.toString(), 'Wrong DEX FOO balance');
            expect(expectedDexBar).to.equal(dexEnd.bar.toString(), 'Wrong DEX BAR balance');
            expect(expectedAccountFoo).to.equal(accountEnd.foo.toString(), 'Wrong Account#3 FOO balance');
            expect(expectedAccountBar).to.equal(accountEnd.bar.toString(), 'Wrong Account#3 BAR balance');
        });
    });

    describe('Direct deposit liquidity (positive)', async function () {

        it('Account#3 deposit FOO liquidity (small amount)', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 deposit FOO liquidity (small amount)');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const expected = await DexPairFooBar.call({
                method: 'expectedDepositLiquidity', params: {
                    left_amount: IS_FOO_LEFT ? 1000 : 0,
                    right_amount: IS_FOO_LEFT ? 0 : 1000,
                    auto_change: true
                }
            });

            logExpectedDeposit(expected);

            const payload = await DexPairFooBar.call({
                method: 'buildDepositLiquidityPayload', params: {
                    id: 0,
                    deploy_wallet_grams: locklift.utils.convertCrystal('0.05', 'nano')
                }
            });

            tx = await Account3.runTarget({
                contract: FooWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: 1000,
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('2.3', 'nano'),
                keyPair: keyPairs[2]
            })

            logTx(tx);

            FooBarLpWallet3.setAddress(await FooBarLpRoot.call({
                method: 'getWalletAddress', params: {
                    _answer_id: 0,
                    wallet_public_key_: `0x0`,
                    owner_address_: Account3.address
                }
            }));

            migration.store(FooBarLpWallet3, 'FooBarLpWallet3');

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            const expectedDexFoo = new BigNumber(dexStart.foo).plus(new BigNumber(1000).shiftedBy(-Constants.tokens.foo.decimals)).toString();
            const expectedAccountFoo = new BigNumber(accountStart.foo).minus(new BigNumber(1000).shiftedBy(-Constants.tokens.foo.decimals)).toString();
            const expectedAccountLp = new BigNumber(accountStart.lp || 0)
                .plus(expected.step_1_lp_reward.plus(expected.step_3_lp_reward).shiftedBy(-Constants.LP_DECIMALS)).toString();

            expect(pairEnd.lp_supply_actual).to.equal(pairEnd.lp_supply, 'Wrong LP supply');
            expect(expectedDexFoo).to.equal(dexEnd.foo.toString(), 'Wrong DEX FOO balance');
            expect(expectedAccountFoo).to.equal(accountEnd.foo.toString(), 'Wrong Account#3 FOO balance');
            expect(expectedAccountLp).to.equal(accountEnd.lp.toString(), 'Wrong Account#3 LP balance');
        });

        it('Account#3 deposit FOO liquidity', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 deposit FOO liquidity');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const TOKENS_TO_DEPOSIT = 100;

            const expected = await DexPairFooBar.call({
                method: 'expectedDepositLiquidity', params: {
                    left_amount: IS_FOO_LEFT ? new BigNumber(TOKENS_TO_DEPOSIT).shiftedBy(Constants.tokens.foo.decimals).toString() : 0,
                    right_amount: IS_FOO_LEFT ? 0 : new BigNumber(TOKENS_TO_DEPOSIT).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    auto_change: true
                }
            });

            logExpectedDeposit(expected);

            const payload = await DexPairFooBar.call({
                method: 'buildDepositLiquidityPayload', params: {
                    id: 0,
                    deploy_wallet_grams: locklift.utils.convertCrystal('0.05', 'nano')
                }
            });

            tx = await Account3.runTarget({
                contract: FooWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: new BigNumber(TOKENS_TO_DEPOSIT).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('2.3', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            FooBarLpWallet3.setAddress(await FooBarLpRoot.call({
                method: 'getWalletAddress', params: {
                    _answer_id: 0,
                    wallet_public_key_: `0x0`,
                    owner_address_: Account3.address
                }
            }));

            migration.store(FooBarLpWallet3, 'FooBarLpWallet3');

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            const expectedDexFoo = new BigNumber(dexStart.foo).plus(TOKENS_TO_DEPOSIT).toString();
            const expectedAccountFoo = new BigNumber(accountStart.foo).minus(TOKENS_TO_DEPOSIT).toString();
            const expectedAccountLp = new BigNumber(accountStart.lp || 0)
                .plus(expected.step_1_lp_reward.plus(expected.step_3_lp_reward).shiftedBy(-9)).toString();

            expect(pairEnd.lp_supply_actual).to.equal(pairEnd.lp_supply, 'Wrong LP supply');
            expect(expectedDexFoo).to.equal(dexEnd.foo.toString(), 'Wrong DEX FOO balance');
            expect(expectedAccountFoo).to.equal(accountEnd.foo.toString(), 'Wrong Account#3 FOO balance');
            expect(expectedAccountLp).to.equal(accountEnd.lp.toString(), 'Wrong Account#3 LP balance');
        });

        it('Account#3 deposit BAR liquidity', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 deposit BAR liquidity');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const TOKENS_TO_DEPOSIT = 100;

            const expected = await DexPairFooBar.call({
                method: 'expectedDepositLiquidity', params: {
                    left_amount: IS_FOO_LEFT ? 0 : new BigNumber(TOKENS_TO_DEPOSIT).shiftedBy(Constants.tokens.bar.decimals).toString(),
                    right_amount: IS_FOO_LEFT ? new BigNumber(TOKENS_TO_DEPOSIT).shiftedBy(Constants.tokens.bar.decimals).toString() : 0,
                    auto_change: true
                }
            });

            logExpectedDeposit(expected);

            const payload = await DexPairFooBar.call({
                method: 'buildDepositLiquidityPayload', params: {
                    id: 0,
                    deploy_wallet_grams: 0
                }
            });

            tx = await Account3.runTarget({
                contract: BarWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: new BigNumber(TOKENS_TO_DEPOSIT).shiftedBy(Constants.tokens.bar.decimals).toString(),
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('2.3', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            const expectedDexBar = new BigNumber(dexStart.bar).plus(TOKENS_TO_DEPOSIT).toString();
            const expectedAccountBar = new BigNumber(accountStart.bar).minus(TOKENS_TO_DEPOSIT).toString();
            const expectedAccountLp = new BigNumber(accountStart.lp)
                .plus(new BigNumber(expected.step_3_lp_reward).shiftedBy(-Constants.LP_DECIMALS)).toString();

            expect(pairEnd.lp_supply_actual).to.equal(pairEnd.lp_supply, 'Wrong LP supply');
            expect(expectedDexBar).to.equal(dexEnd.bar.toString(), 'Wrong DEX BAR balance');
            expect(expectedAccountBar).to.equal(accountEnd.bar.toString(), 'Wrong Account#3 BAR balance');
            expect(expectedAccountLp).to.equal(accountEnd.lp.toString(), 'Wrong Account#3 LP balance');
        });

    });

    describe('Direct withdraw liquidity (positive)', async function () {
        it('Account#3 direct withdraw liquidity (small amount)', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 direct withdraw liquidity (small amount)');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const expected = await DexPairFooBar.call({
                method: 'expectedWithdrawLiquidity', params: {
                    lp_amount: 1000
                }
            });

            const payload = await DexPairFooBar.call({
                method: 'buildWithdrawLiquidityPayload', params: {
                    id: 0,
                    deploy_wallet_grams: 0
                }
            });

            logger.log(`Expected ${IS_FOO_LEFT ? 'FOO' : 'BAR'}: ` +
                `${new BigNumber(expected.expected_left_amount)
                    .shiftedBy(-Constants.tokens[IS_FOO_LEFT?'foo':'bar'].decimals).toString()}`);
            logger.log(`Expected ${!IS_FOO_LEFT ? 'FOO' : 'BAR'}: ` +
                `${new BigNumber(expected.expected_right_amount)
                    .shiftedBy(-Constants.tokens[!IS_FOO_LEFT?'foo':'bar'].decimals).toString()}`);

            tx = await Account3.runTarget({
                contract: FooBarLpWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: 1000,
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('2.3', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            const expectedDexFoo = new BigNumber(dexStart.foo)
                .minus(new BigNumber(IS_FOO_LEFT ? expected.expected_left_amount : expected.expected_right_amount).shiftedBy(-Constants.tokens.foo.decimals))
                .toString();
            const expectedDexBar = new BigNumber(dexStart.bar)
                .minus(new BigNumber(!IS_FOO_LEFT ? expected.expected_left_amount : expected.expected_right_amount).shiftedBy(-Constants.tokens.bar.decimals))
                .toString();
            const expectedAccountFoo = new BigNumber(accountStart.foo)
                .plus(new BigNumber(IS_FOO_LEFT ? expected.expected_left_amount : expected.expected_right_amount).shiftedBy(-Constants.tokens.foo.decimals))
                .toString();
            const expectedAccountBar = new BigNumber(accountStart.bar)
                .plus(new BigNumber(!IS_FOO_LEFT ? expected.expected_left_amount : expected.expected_right_amount).shiftedBy(-Constants.tokens.bar.decimals))
                .toString();

            expect(pairEnd.lp_supply_actual).to.equal(pairEnd.lp_supply, 'Wrong LP supply');
            expect(expectedDexFoo).to.equal(dexEnd.foo.toString(), 'Wrong DEX FOO balance');
            expect(expectedDexBar).to.equal(dexEnd.bar.toString(), 'Wrong DEX BAR balance');
            expect(expectedAccountFoo).to.equal(accountEnd.foo.toString(), 'Wrong Account#3 FOO balance');
            expect(expectedAccountBar).to.equal(accountEnd.bar.toString(), 'Wrong Account#3 BAR balance');
        });

        it('Account#3 direct withdraw liquidity', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 direct withdraw liquidity');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const expected = await DexPairFooBar.call({
                method: 'expectedWithdrawLiquidity', params: {
                    lp_amount: new BigNumber(accountStart.lp).shiftedBy(Constants.LP_DECIMALS).toString()
                }
            });

            const payload = await DexPairFooBar.call({
                method: 'buildWithdrawLiquidityPayload', params: {
                    id: 0,
                    deploy_wallet_grams: 0
                }
            });

            logger.log(`Expected ${IS_FOO_LEFT ? 'FOO' : 'BAR'}: ` +
                `${new BigNumber(expected.expected_left_amount)
                    .shiftedBy(-Constants.tokens[IS_FOO_LEFT?'foo':'bar'].decimals).toString()}`);
            logger.log(`Expected ${!IS_FOO_LEFT ? 'FOO' : 'BAR'}: ` +
                `${new BigNumber(expected.expected_right_amount)
                    .shiftedBy(-Constants.tokens[!IS_FOO_LEFT?'foo':'bar'].decimals).toString()}`);

            tx = await Account3.runTarget({
                contract: FooBarLpWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: new BigNumber(accountStart.lp).shiftedBy(Constants.LP_DECIMALS).toString(),
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('2.3', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            const expectedDexFoo = new BigNumber(dexStart.foo)
                .minus(new BigNumber(IS_FOO_LEFT ? expected.expected_left_amount : expected.expected_right_amount).shiftedBy(-Constants.tokens.foo.decimals))
                .toString();
            const expectedDexBar = new BigNumber(dexStart.bar)
                .minus(new BigNumber(!IS_FOO_LEFT ? expected.expected_left_amount : expected.expected_right_amount).shiftedBy(-Constants.tokens.bar.decimals))
                .toString();
            const expectedAccountFoo = new BigNumber(accountStart.foo)
                .plus(new BigNumber(IS_FOO_LEFT ? expected.expected_left_amount : expected.expected_right_amount).shiftedBy(-Constants.tokens.foo.decimals))
                .toString();
            const expectedAccountBar = new BigNumber(accountStart.bar)
                .plus(new BigNumber(!IS_FOO_LEFT ? expected.expected_left_amount : expected.expected_right_amount).shiftedBy(-Constants.tokens.bar.decimals))
                .toString();
            const expectedAccountLp = '0';

            expect(pairEnd.lp_supply_actual).to.equal(pairEnd.lp_supply, 'Wrong LP supply');
            expect(expectedDexFoo).to.equal(dexEnd.foo.toString(), 'Wrong DEX FOO balance');
            expect(expectedDexBar).to.equal(dexEnd.bar.toString(), 'Wrong DEX BAR balance');
            expect(expectedAccountFoo).to.equal(accountEnd.foo.toString(), 'Wrong Account#3 FOO balance');
            expect(expectedAccountBar).to.equal(accountEnd.bar.toString(), 'Wrong Account#3 BAR balance');
            expect(expectedAccountLp).to.equal(accountEnd.lp.toString(), 'Wrong Account#3 LP balance');
        });
    });

    describe('Direct exchange (negative)', async function () {

        it('Account#3 exchange FOO to BAR (empty payload)', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 exchange FOO to BAR (empty payload)');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const TOKENS_TO_EXCHANGE = 100;

            const expected = await DexPairFooBar.call({
                method: 'expectedExchange', params: {
                    amount: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    spent_token_root: FooRoot.address
                }
            });

            tx = await Account3.runTarget({
                contract: FooWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: EMPTY_TVM_CELL
                },
                value: locklift.utils.convertCrystal('2.3', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            expect(dexStart.foo).to.equal(dexEnd.foo, 'Wrong DEX FOO balance');
            expect(dexStart.bar).to.equal(dexEnd.bar, 'Wrong DEX BAR balance');
            expect(accountStart.foo).to.equal(accountEnd.foo, 'Wrong Account#3 FOO balance');
            expect(accountStart.bar).to.equal(accountEnd.bar, 'Wrong Account#3 BAR balance');
        });

        it('Account#3 exchange FOO to BAR (low gas)', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 exchange FOO to BAR (low gas)');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const TOKENS_TO_EXCHANGE = 100;

            const expected = await DexPairFooBar.call({
                method: 'expectedExchange', params: {
                    amount: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    spent_token_root: FooRoot.address
                }
            });

            const payload = await DexPairFooBar.call({
                method: 'buildExchangePayload', params: {
                    id: 0,
                    deploy_wallet_grams: locklift.utils.convertCrystal('0.05', 'nano'),
                    expected_amount: expected.expected_amount
                }
            });

            tx = await Account3.runTarget({
                contract: FooWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('1', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            expect(dexStart.foo).to.equal(dexEnd.foo, 'Wrong DEX FOO balance');
            expect(dexStart.bar).to.equal(dexEnd.bar, 'Wrong DEX BAR balance');
            expect(accountStart.foo).to.equal(accountEnd.foo, 'Wrong Account#3 FOO balance');
            expect(accountStart.bar).to.equal(accountEnd.bar, 'Wrong Account#3 BAR balance');
        });

        it('Account#3 exchange FOO to BAR (wrong rate)', async function () {
            logger.log('#################################################');
            logger.log('# Account#3 exchange FOO to BAR (wrong rate)');
            const dexStart = await dexBalances();
            const accountStart = await account3balances();
            const pairStart = await dexPairInfo();
            logBalances('start', dexStart, accountStart, pairStart);

            const TOKENS_TO_EXCHANGE = 100;

            const expected = await DexPairFooBar.call({
                method: 'expectedExchange', params: {
                    amount: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    spent_token_root: FooRoot.address
                }
            });

            const payload = await DexPairFooBar.call({
                method: 'buildExchangePayload', params: {
                    id: 0,
                    deploy_wallet_grams: locklift.utils.convertCrystal('0.05', 'nano'),
                    expected_amount: new BigNumber(expected.expected_amount).plus(1).toString()
                }
            });

            tx = await Account3.runTarget({
                contract: FooWallet3,
                method: 'transferToRecipient',
                params: {
                    recipient_public_key: 0,
                    recipient_address: DexPairFooBar.address,
                    tokens: new BigNumber(TOKENS_TO_EXCHANGE).shiftedBy(Constants.tokens.foo.decimals).toString(),
                    deploy_grams: 0,
                    transfer_grams: 0,
                    send_gas_to: Account3.address,
                    notify_receiver: true,
                    payload: payload
                },
                value: locklift.utils.convertCrystal('2.3', 'nano'),
                keyPair: keyPairs[2]
            });

            logTx(tx);

            const dexEnd = await dexBalances();
            const accountEnd = await account3balances();
            const pairEnd = await dexPairInfo();
            logBalances('end', dexEnd, accountEnd, pairEnd);
            await logGas();

            expect(dexStart.foo).to.equal(dexEnd.foo, 'Wrong DEX FOO balance');
            expect(dexStart.bar).to.equal(dexEnd.bar, 'Wrong DEX BAR balance');
            expect(accountStart.foo).to.equal(accountEnd.foo, 'Wrong Account#3 FOO balance');
            expect(accountStart.bar).to.equal(accountEnd.bar, 'Wrong Account#3 BAR balance');
        });
    });
});
