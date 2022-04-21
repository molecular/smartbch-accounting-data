import { config } from "./config";
import contract_abis from "./assets/config/contract-abi.json";

import Web3 from "web3";
import { TransactionConfig } from "web3-core";
import { NodeApiService } from './services/api/node-api.service';

import { Block, Transaction } from 'web3-eth';
import { Log, BlockNumber } from 'web3-core';

import { UtilHelperService } from './services/helpers/util-helper.service'
import { EventDecoder, IDecodedValue } from './services/helpers/event-decoder';

import { createWriteStream, createReadStream } from 'fs';
import { stringify } from 'csv-stringify';
import { parse } from 'csv-parse';
import { BigNumber } from 'bignumber.js';

import { Contract, ContractManager } from './contractmanager'

const util = new UtilHelperService();
const api = new NodeApiService(config.api);
const contract_manager = new ContractManager(api);

// configure BigNumber classes (here and in util module)
const bignumberConfig: BigNumber.Config = {
	ROUNDING_MODE: BigNumber.ROUND_DOWN,
	DECIMAL_PLACES: 18,
	EXPONENTIAL_AT: [-50,50]
};
BigNumber.config(bignumberConfig);
util.bignumberConfig(bignumberConfig); // TODO: not sure this works


api.getBlockHeader().then(async (latest) => {
	console.log(`latest block Number: ${latest}, ${"0x" + (latest - 10).toString(16)}`)
	const blocks_per_second = 5;
	//const blocks = 30*24*60*60 / blocks_per_second;

	const start_block = 
		// 1;;
		990000;
		//latest-blocks;

	const end_block = 
		latest+1;
		//1090000;

	const max_count = 0; // 0: default limit

	//do_2_ethGetLogs(start_block, end_block, max_count);

	//let contract_address = "0x7eBeAdb95724a006aFaF2F1f051B13F4eBEBf711" // CashKitten ;
	//let contract_address = "0x7b2B3C5308ab5b2a1d9a94d20D35CCDf61e05b72" // flexUSD ;
	let contract_address = "0x7642Df81b5BEAeEb331cc5A104bd13Ba68c34B91" // LCY
	//let contract_address = "0x445B3712A09f8102Dd0c1ffb6B3b0dE4D3B643b7" // WRS

	await contract_manager.loadContracts([contract_address]);
	let contract = contract_manager.getContractByAddress(contract_address);

	let accounts_filename = "out/accounts." + contract.name + ".CSV";
	//extract_accounts(accounts_filename, contract, start_block, end_block, max_count);
	get_balances(accounts_filename, contract);

});

const range = (start, end) => Array.from(Array(end - start + 1).keys()).map(x => x + start);

async function extract_accounts(accounts_filename, contract, start_block, end_block, max_count) {
	console.log("start_block", start_block, "end_block", end_block, "max_count", max_count);

	let my_address_topics = config.my_addresses.map((address) => util.convertAddressToTopic(address));
	console.log("my_address_topics", my_address_topics)
	let sets = [
		//{ contract_address: contract.address, topics: [Web3.utils.sha3("Transfer(address,address,uint256)"), my_address_topics, null] },
		//{ contract_address: contract.address, topics: [Web3.utils.sha3("Transfer(address,address,uint256)"), null, my_address_topics] },
		{ contract_address: contract.address, topics: [Web3.utils.sha3("Transfer(address,address,uint256)")] },
	]

	console.log(contract);
	console.log("totalSupply", util.convertValue(contract["totalSupply"], Number(contract["decimals"])))

	let frame_size = 25000
	let frames = range(0, Math.ceil((end_block-start_block)/frame_size)-1).map((frame) => start_block + frame * frame_size)

	// sequentially call getLogs(...) to collect all logs into collector
	let collector: any[] = [];
	for (let i=0; i<frames.length; i++) {
		let frame = frames[i];
		let last_block = Math.min(frame + frame_size - 1, end_block);
		//console.log("frame", frame, "last_block", last_block);


		let collected: any[] = await Promise.all(sets.map((set) => {
			// 4 curl
			// console.log(set.contract_address)
			// console.log(set.topics)
			// console.log(util.toHex(frame))
			// console.log(util.toHex(last_block))

			return api.getLogs(
				set.contract_address, 
				set.topics, 
				util.toHex(frame), 
				util.toHex(last_block), 
				max_count
			)
		}))
		.then(flattenArrays)
		collector = collector.concat(collected)
		console.log(`loop #${i}: blocks ${frame} - ${last_block}: found ${collected.length} items`);
	}
	console.log("found", collector.length, "items in aggregate");

	Promise.resolve(collector)
	.then(flattenArrays)
	.then((logs) => { // extracts account from log topics
		console.log("extracting accounts directly from logs")
		return Object.keys(
			logs.reduce((o, log) => {
				o[util.convertTopicAddress(log.topics[1])] = true;
				o[util.convertTopicAddress(log.topics[2])] = true;
				return o;
			}, {})
		);
	})
	.then((result) => { // write accounts.CSV
		let objects = result.map((item) => { return { account: item }; });
		stringify(objects, { 
			header: true,
			columns: Object.keys(objects[0])
		})
		.pipe(createWriteStream(accounts_filename));
		console.log(`wrote ${result.length} items to ${accounts_filename}`)
		return result;
	})
}

async function get_balances(accounts_filename, contract) {
	const parser = parse({delimiter: ';', from_line: 2}, function(err, data){
		data = data.map((d) => d[0])
		Promise.resolve(data)
		.then((accounts: string[]) => { 
			//accounts = accounts.slice(0,100)
			console.log("number of accounts", accounts.length)
			return api.callMultiple( // call contract.balanceOf(account) for each account
				accounts.map((account) => {
					let keccak = Web3.utils.sha3("balanceOf(address)")
					if (keccak == null) keccak = ""
					return {
						transactionConfig: {
							to: contract.address,
							data: keccak.substring(0,10) + util.convertAddressToTopic(account).substring(2)
						},
						returnType: 'uint256'
					};
				})
			).then((balances) => { // assemble an object suitable for output
				let result: any[] = []
				for (let i=0; i<accounts.length; i++) {
					let o = {
						contract_address: contract.address,
						account: accounts[i],
						"balance(uint256)": new BigNumber(balances[i])
					}
					result.push(o);
				}
				return result;
			});
		})
		.then(convertValues)
		.then((result) => {
			return result.sort((a,b) => b["balance(uint256)"].comparedTo(a["balance(uint256)"]));
		})
		.then((result) => {
			let balances_filename = accounts_filename.replace("accounts", "accounts_with_balances");
			stringify(result, { 
				header: true,
				columns: Object.keys(result[0])
			})
			.pipe(createWriteStream(balances_filename));
			console.log(`wrote ${balances_filename}: ${result.length} accounts`);
		})
		// .then((result) => { // write accounts_with_balances.csv
		// 	let objects = result;
		// 	stringify(objects, { 
		// 		header: true,
		// 		columns: Object.keys(objects[0])
		// 	})
		// 	.pipe(createWriteStream("accounts_with_balances.csv"));
		// 	console.log(`wrote ${result.length} items to accounts_with_balances.csv`)
		// 	return result;
		// })
		// .then(writeCSVs)
		// ;

	});
	createReadStream(accounts_filename).pipe(parser);

}

function logToConsole(result) {
	console.log(result);
	return result;
}

function flattenArrays(arrays) {
	return arrays.reduce((o, i) => { return o.concat(i); }, [])
}

function logResults(result: any) {
	console.log(result);
	return result;
}



async function convertValues(events): Promise<any[]> {
	events.forEach(async (event) => {
		let contract = await contract_manager.getContractByAddress(event.contract_address);
		Object.keys(event).forEach((key) => {
			if (key.indexOf("(uint256)") > 0) {
				if (event[key] !== undefined ) {
					event[key+"_"] = new BigNumber(event[key]).integerValue().dividedBy(new BigNumber(`1e${contract["decimals"]}`)).toFixed(config.output.decimals)
					event[key] = new BigNumber(event[key]).integerValue()
				}
			}
		});
	});
	return events;
}
