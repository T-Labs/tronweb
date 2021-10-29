//const tronWebBuilder = require('./tronWebBuilder');
//const tronWeb0 = tronWebBuilder.createInstance();

const TronWeb = require('../../dist/TronWeb.node');
//const TronGrid = require("trongrid");
const TronStation = require('tron-station-sdk');

var tronWeb = new TronWeb({
    fullNode: 'http://35.180.51.163:8090', // 162.55.0.212 works, 148.251.246.190, c3 35.180.51.163
    solidityNode: 'http://35.180.51.163:8091',
    eventServer: 'https://api.trongrid.io',
    privateKey: '475b9325195123a93afa200089b6812fc451e42c4cd73d69d5d6b764c0062462'
});
const tronStation = new TronStation(tronWeb, true);

const blockNum = 27990956;
const addr = "TAFUh5jeNqfimwgTVdBhJMCAZvP4M94aGF";
const addrPrivate = '8685231EC02D9F74F4677EEC70A17434D270D55E9F70B512FB0158B7366F26F1';
const addr2 = "TCsdx9XKhFMyVQjLvHvP95Gft9GTuws9h3";
const addrHex = "410313C0B6E688504BACB8EEF280305D2A8ADBA7FA";
const txId = "a53c3fcf25aabab1084b4bc8d7ea1bd294c3f30e8497bf0469419830aa54b445";
const contractUsdt = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const BttId = "1002000";

const privateKeyToAddressHex = (tronWeb, privateKey) =>
    tronWeb.address.toHex(tronWeb.address.fromPrivateKey(privateKey));

const getTokenContract = async (tronWeb, contractAddress) =>
    await tronWeb.contract().at(contractAddress);


const decodeAssetId = (str) => str.split('').filter((letter, i) => i % 2 == 1).join(''); // 31303033373430 -> 1003740 

const decodeContractInput = (contract, input) => {
    if (input[30] === '4')
        input = input.replace('41', '00'); // replace first entrance of 41 (optional prefix that brakes decode method)
    return contract.decodeInput(input);
};

const getBlocksTxs = async (fromBlock, toBlock, trc20ContractAddresses) => {
    const blocks = await tronWeb.trx.getBlockRange(fromBlock, toBlock);
    const allowTxTypes = ['TransferContract', 'TransferAssetContract', 'TriggerSmartContract'];

    const contractHexAddresses = trc20ContractAddresses.map(tronWeb.address.toHex);
    const contracts = {};
    for (let contractHex of contractHexAddresses) // preload token contracts
        contracts[contractHex] = await getTokenContract(tronWeb, contractHex);

    const resultBlocks = blocks.filter(block => block.transactions != null).map(block => ({
        BlockNum: block.block_header.raw_data.number,
        Txs: block.transactions.map(tx => {
            console.log('', block.block_header.raw_data.number, tx.txID);
            if (!tx.ret || tx.ret === [] || tx.ret[0].contractRet !== 'SUCCESS')
                return null;
            const contractData = tx.raw_data.contract[0];
            if (!allowTxTypes.includes(contractData.type)) {
                //console.log('unknown type:', contractData.type, tx.txID);
                return null;
            }
            const values = contractData.parameter.value;

            if (contractData.type === 'TriggerSmartContract') { // trc20
                if (!contractHexAddresses.includes(values.contract_address))
                    return null; // token that we don't use

                if (!values.data.startsWith('a9059cbb')) // type 'transfer', decodeContractInput doesn't support some others
                    return null;

                let contractTxInfo = null;
                try {
                    contractTxInfo = decodeContractInput(contracts[values.contract_address], values.data);
                } catch (e) { // error if transfer amount = 0
                    console.log(`Couldn't decode ${tx.txID}`, e);
                }
                if (!contractTxInfo || contractTxInfo.name !== 'transfer')
                    return null;
                console.log(contractData, contractTxInfo);
                return {
                    TxHash: tx.txID,
                    FromHex: values.owner_address,
                    ToHex: (contractTxInfo.params.receiver || contractTxInfo.params._to || contractTxInfo.params.recipient),
                    Amount: (contractTxInfo.params.numTokens || contractTxInfo.params._value || contractTxInfo.params.amount).toString(), // BigInteger to string
                    TokenId: tronWeb.address.fromHex(values.contract_address),
                };
            } else { // TRX & trc10
                return {
                    TxHash: tx.txID,
                    FromHex: values.owner_address,
                    ToHex: values.to_address,
                    Amount: values.amount.toString(),
                    TokenId: values.asset_name ? decodeAssetId(values.asset_name) : null,
                };
            }
        }).filter(tx => tx != null),
    }));
    console.log("\n getBlockRange(): \n", resultBlocks.length);
    return resultBlocks;
};

const getAddressEnergy = async (address) => {
    const accResources = await tronWeb.trx.getAccountResources(address); // energy and bandwidth balances
    console.log("\n accResources(): \n", accResources);
    if (!accResources.EnergyLimit) // new address
        return 0;
    const availableEnergy = accResources.EnergyLimit - (accResources.EnergyUsed || 0);
    return availableEnergy;
};
const getFreezeEnergyRate = async () => { // How much energy will receive per 1 frozen TRX
    const accResources = await tronWeb.trx.getAccountResources('TAFUh5jeNqfimwgTVdBhJMCAZvP4M94aGF'); // any address
    console.log("\n accResources(): \n", accResources);
    return accResources.TotalEnergyLimit / accResources.TotalEnergyWeight;
};

const sendTx = async (fromPrivateKey, to, amount, tokenAddressOrAssetId, isTrc20) => {
    if (isTrc20) { // TRC-20
        const contract = await getTokenContract(tronWeb, tokenAddressOrAssetId);
        let txId;
        await contract.transfer(to, amount)
            .send({ feeLimit: 20 * 1000000 /* 4.15 TRX usually */ }, fromPrivateKey)
            .then(output => { txId = output; });
        return txId;

    } else { // TRX and TRC-10
        const from = privateKeyToAddressHex(tronWeb, fromPrivateKey);
        let tx;
        console.log(from);
        if (tokenAddressOrAssetId)
            tx = await tronWeb.transactionBuilder.sendToken(to, amount, tokenAddressOrAssetId, from);
        else
            tx = await tronWeb.transactionBuilder.sendTrx(to, amount, from);
        const txSigned = await tronWeb.trx.sign(tx, fromPrivateKey);
        const txResult = await tronWeb.trx.sendRawTransaction(txSigned);
        return txResult.txid;
    }
};

const freezeTrx = async (isUnfreeze, fromPrivateKey, to, amount, isBandwidth) => {
    let result;
    if (isUnfreeze) {
        result = await tronWeb.trx.unfreezeBalance(isBandwidth ? 'BANDWIDTH' : 'ENERGY', fromPrivateKey, to);
    } else {
        result = await tronWeb.trx.freezeBalance(Number(amount), 3 /* days */,
            isBandwidth ? 'BANDWIDTH' : 'ENERGY', fromPrivateKey, to);
    }
    console.log("freeze:", JSON.stringify(result, null, 2));
    return result.txid;
};



(async function () {
    //console.log("\n getNodeInfo(): \n", await tronWeb.trx.getNodeInfo());
    //var block = await tronWeb.trx.getCurrentBlock();
    //console.log("\n getCurrentBlock(): ", block.block_header.raw_data.number, new Date(block.block_header.raw_data.timestamp).toGMTString());

    var block = await tronWeb.trx.getBlockByNumber(34920937);
    var blockTx = block.transactions.filter(t => t.txID === '7eacc7a438bc7b230c4be9dbbe2f99cf7957b1235309296a7af9381729060fbf')[0];
    console.log("\n getBlockByNumber(): \n", JSON.stringify(blockTx));

    //var blockTxs = await getBlocksTxs(30618990, 30618991, ["TXWbbQG9L3bveaEUrSYyQrV3WpoaTBy2Jn"]);
    //var blockTx = blockTxs[0].Txs.filter(t => t.TxHash === '1bb9e3faccd8a3c5d2e6f0fb0182e29c9f770e18134d357fbc262287e7616346');
    //console.log("\n getBlockTx: \n", JSON.stringify(blockTx));


    //console.log("\n getAccountResources(): \n", await tronWeb.trx.getAccountResources(addr)); // some numbers
    //console.log("\n listTokens(): \n", await tronWeb.trx.listTokens());
    //console.log("\n getAccountById(): \n", await tronWeb.trx.getAccountById(addrHex)); // error
    //console.log("\n getAccountById(): \n", await tronWeb.trx.getAccountById(addr)); // addr doesn't work
    //console.log("\n getTransaction(): \n", JSON.stringify(await tronWeb.trx.getTransaction('24c81f52446cea0b4d49b980d159d770e543a4d41510a7253424fa501d0ff26e'), null, 2)); // tx block and fee

    //console.log("\n address toHex(): \n", tronWeb.address.toHex('TD4zRSWXjWgcyR75o5wxDZ2JtW3S7cdzcv'));
    //console.log("\n address fromHex(): \n", tronWeb.address.fromHex('0x22005f47124B0D367921136Fc9E30a58bC8cc27F'));
    //console.log("\n addresses(): ", tronWeb.address.fromHex('0xab7d7cd4f30188be762dbc2a1002f753cbae3699'));
    //var tx2 = await tronWeb.trx.getTransactionInfo('6651f2a30edd263c97b4f8189edae62b44ce21256e805c819f1883fdf7a1b000');
    //console.log("\n getTransaction(): \n", JSON.stringify(tx2, null, 2));
    //console.log("\n createAccount(): \n", await tronWeb.createAccount()); // create keys

    //console.log("\n getTokenListByName(): \n", await tronWeb.trx.getTokenListByName('USDT')); // many tokens with same name
    //console.log("\n getTokenFromID(): \n", await tronWeb.trx.getTokenFromID(1002000)); // works

    //const acc = await tronWeb.trx.getAccount(addr); //  Balances
    //const accResources = await tronWeb.trx.getAccountResources('TN2bj7b8noE6JxpLJTX1syGXXbwk5uwgft'); // bandwidth & energy
    //console.log("\n accResources(): \n", acc, accResources); // 12866662 (trx balance *10^6)

    //const tx = await tronWeb.trx.getTransaction('38aa67495f87f5d28ac57d3e2063aafd5dd062a09f4ffc0bb90dd61c5c527a49'); // tx data, status & signture
    //const tx = await tronWeb.trx.getTransactionInfo('a0a5ddd07271c2c42c4a49cf09bc3e152fb3d7bbf92c57c03967ff737c14c102'); // tx data, status & signture
    //console.log('\n tx:', JSON.stringify(tx, null, 2)); 

    //const txAmount = txInfo.amount, 
    //    txFrom = tronWeb.address.fromHex(txInfo.owner_address),
    //    txTo = tronWeb.address.fromHex(txInfo.to_address);
    //console.log(`\n tx amount:${txAmount}, from: ${txFrom}, to:${txTo}`); 

    //const txs = await tronWeb.trx.getTransactionsRelated(addr);
    //console.log('\n txs', txs); 

    // https://gist.github.com/andelf/bdd18734d40774a721d0c4cbcec67037 
    //TRX20 calls, require supportConstant = true in node config
    //const contract = await getTokenContract(tronWeb, 'TFXX6gSzYFhy1wEbvZhS75G2g3JM1pgc8t');
    //console.log("\n contract data: ", decodeContractInput(contract, 'a9059cbb0000000000000000000000000313c0b6e688504bacb8eef280305d2a8adba7fa00000000000000000000000000000000000000000000000000000000000927c0'));
    //console.log("balance:", (await contract.methods.balanceOf("TZ8gQmohQpgyQ7vWw6hsL1hyGvoZXwKrjB").call()));
    //var events = await tronWeb.event.getEventsByContractAddress(contractUsdt, {
    //  onlyConfirmed: true,
    //  eventName: "Transfer",
    //  limit: 100,
    //  sinceTimestamp: 1614361510000,
    //  sort: "block_timestamp"
    //});
    //console.log("events:", events, tronWeb.address.fromHex('0x0313c0b6e688504bacb8eef280305d2a8adba7fa'));

    //const txResult = await sendTx(addrPrivate, "TN2bj7b8noE6JxpLJTX1syGXXbwk5uwgft", 10, false); // trx
    //const txResult = await sendTx(addrPrivate, "TSuR78fjbN1xJJ2Jdv2wLQBwkNcLx99cgr", 100, BttId, false); // trc10
    //const txResult = await sendTx(addrPrivate, "TX3ey6ZXdJDhP6qChZyxLsK3zu1x4fpSrN", 15000, contractUsdt, true); //trc20
    //console.log("sent tx:", txResult);


    //const freezeTxid = await freezeTrx(false, addrPrivate, "TX3ey6ZXdJDhP6qChZyxLsK3zu1x4fpSrN", 1000001, false);
    //const freezeTxid = await freezeTrx(true, addrPrivate, null, 0, false); 


    //console.log('getAddressEnergy:', await getAddressEnergy('TY4Ptxd1G6GKRShyUuqdJ4WzdeKAHd4NEw'));
    //console.log('getFreezeRate:', await getFreezeEnergyRate());
    //console.log('tronStation:', await tronStation.getAccountBandwidth(addr));

})()

