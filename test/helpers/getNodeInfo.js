const tronWebBuilder = require('./tronWebBuilder');
const tronWeb = tronWebBuilder.createInstance();

const blockNum = 27533138;
const addr = "TGknskei8exssLaNYT7G7C2kTu646WMDFd";
const txId = "a53c3fcf25aabab1084b4bc8d7ea1bd294c3f30e8497bf0469419830aa54b445";

(async function () {
    //console.log("\n getNodeInfo(): \n", await tronWeb.trx.getNodeInfo());
    //console.log("\n getAccountResources(): \n", await tronWeb.trx.getAccountResources(addr)); // some numbers
    //console.log("\n listTokens(): \n", await tronWeb.trx.listTokens());
    //console.log("\n getBalance(): \n", await tronWeb.trx.getBalance(addr)); // 12866662 (trx balance *10^6)
    //console.log("\n getAccountById(): \n", await tronWeb.trx.getAccountById(addr)); // addr doesn't work
    //console.log("\n getTransactionInfo(): \n", await tronWeb.trx.getTransactionInfo(txId)); // tx block and fee

    const tx = await tronWeb.trx.getTransaction(txId); // tx data, status & signture
    const txInfo = tx.raw_data.contract[0].parameter.value;
    const txAmount = txInfo.amount, 
        txFrom = tronWeb.address.fromHex(txInfo.owner_address),
        txTo = tronWeb.address.fromHex(txInfo.to_address);
    console.log(`\n tx amount:${txAmount}, from: ${txFrom}, to:${txTo}`); 

    var block = await tronWeb.trx.getBlockByNumber(blockNum);
    var blockTx = block.transactions[0];
    console.log("\n getBlockByNumber() blockTx: \n", blockTx);
})()

