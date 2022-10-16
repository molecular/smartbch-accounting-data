import { config } from "./config";
import contract_abis from "./assets/config/contract-abi.json";

import Web3 from "web3";
// import { BlockNumber, Log, TransactionConfig, TransactionReceipt } from 'web3-core';
// import { Block, Transaction } from 'web3-eth';

//import { Transaction } from 'web3-eth';
import { Log, BlockNumber, TransactionConfig } from 'web3-core';

import { UtilHelperService } from './services/helpers/util-helper.service';
import { EventDecoder, IDecodedValue } from './services/helpers/event-decoder';

import { createWriteStream, createReadStream } from 'fs';
import { stringify } from 'csv-stringify';
import { parse } from 'csv-parse';
import { BigNumber } from 'bignumber.js';

import { Contract, ContractManager } from './contractmanager';
import { SmartBCHApi, TypedParameter, NamedReturnType } from './smartbch_api';

import * as fs from 'fs';
import * as path from 'path';

const util = new UtilHelperService();
const sbch = new SmartBCHApi(config.api.apiEndpoint);
const contract_manager = new ContractManager(sbch);

// configure BigNumber classes (here and in util module)
const bignumberConfig: BigNumber.Config = {
	ROUNDING_MODE: BigNumber.ROUND_DOWN,
	DECIMAL_PLACES: 18,
	EXPONENTIAL_AT: [-50,50]
};
BigNumber.config(bignumberConfig);
util.bignumberConfig(bignumberConfig); // TODO: not sure this works

const range = (start, end) => Array.from(Array(end - start + 1).keys()).map(x => x + start);

// main

ensureDir("./out/x")

// if connection is working...
sbch.blockNumber()
.then(async (latest: string) => {

	let height = util.parseHex(latest)
	console.log(`latest block Number: ${latest}, type: ${typeof latest}`)
	const blocks_per_second = 5;
	//const blocks = 30*24*60*60 / blocks_per_second;

	const start_block = 
		1;
		//height-blocks;

	const end_block = 
		height+1;
		//1090000;

	const max_count = 0; // 0: default limit

	const masterchef = "0x3a7b9d0ed49a90712da4e087b17ee4ac1375a5d4";

	//do_masterchef_getPoolInfo(masterchef);
	do_transactions(config.my_addresses, start_block, end_block)
	do_2_ethGetLogs(config.my_addresses, config.routers_chefs, start_block, end_block);

	//do_test(config)

})
.catch((error) => {
	console.log(`error connecting to sbch node ${config.api.apiEndpoint}: ${error}`);
});

// main funcs

async function do_test(config) {
	console.log("removeLiquidityEth sig:", Web3.utils.sha3("removeLiquidityETH(address,uint256,uint256,uint256,address,uint256)"));

	let contract_address = '0x5d0bf8d8c8b054080e2131d8b260a5c6959411b8';
	contract_manager.loadContracts([contract_address]);
	let contract = contract_manager.getContractByAddress(contract_address);
	
	Promise.all(
		config.my_addresses.map(address => sbch.queryTxByAddr(address, util.toHex(6730101), util.toHex(6730101)))
	)
	.then(flattenArrays)
	.then(logToConsole)
	.then((result) => {
		result.forEach((tx) => {
			let contract = contract_manager.getContractByAddress(tx.to);
			contract_manager.decodeTransactionInput(contract, tx.input, config.output.decimals);
		})
	})
	.then(logToConsole)
}

async function do_transactions(addresses: string[], start_block, end_block) {
	Promise.all(
		addresses.map(address => sbch.queryTxByAddr(address, util.toHex(start_block), util.toHex(end_block)))
	)
	.then(flattenArrays)
	.then(decodeTransactionInputs)
	.then(parseHex(["blockNumber", "gas", "gasPrice", "nonce", "transactionIndex", "value"]))
	.then(extendEventsWithBlockInfo)
	.then(parseHex(["blockTimestamp"]))
	.then(convertBCHValues(["value"]))
	.then(writeCSV("out/transactions.csv"))
	.catch(logError)
}

function do_2_ethGetLogs(addresses: string[], routers_chefs: string[], start_block, end_block) {
	// collect topic patterns in "sets"
	let address_topics = addresses.map((address) => util.convertAddressToTopic(address));
	let sets = [
		{ contract_address: "0x7b2B3C5308ab5b2a1d9a94d20D35CCDf61e05b72", topics: [Web3.utils.sha3("ChangeMultiplier(uint256)")] },
		{ contract_address: null, topics: [null, address_topics] },
		{ contract_address: null, topics: [null, null, address_topics] },
		{ contract_address: null, topics: [null, null, null, address_topics] }
	]

	// add patterns for 
	sets = sets.concat(flattenArrays(routers_chefs.map((r) => {
		return [
			{ contract_address: r, topics: [null, address_topics] },
			{ contract_address: r, topics: [null, null, address_topics] }
		];
	})));

	Promise.all(sets.map((set) => {
		return sbch.getLogs(set.contract_address, set.topics, util.toHex(start_block), util.toHex(end_block))
	}))
	.then(flattenArrays)
	//.then(logToConsole)
	.then((logs) => {
		return contract_manager.loadContracts(logs.map(log => log.address))
		.then(() => { return logs; });
	})
	// .then((events) => {
	// 	return events.filter((event) => event.address == '0x674a71e69fe8d5ccff6fdcf9f1fa4262aa14b154');
	// })
	.then(decodeLogsToEvents)
	.then(extendEventsWithBlockInfo)
	.then(parseHex(["blockTimestamp"]))
	.then(appendSyntheticEvents)
	.then(convertValues)
	.then(sortChronologically)
	.then(parseHex(["transaction_index"]))
	.then(groupEventsByName)
	.then(writeCSVs("out/events"));

}

async function do_masterchef_getPoolInfo(masterchef_address: string) {
	// pool_length := masterchef.poolLength()
	let pool_length = await sbch.call(
		null, masterchef_address, "poolLength()", [], 'uint256'
	)

	// write results from each masterchef.poolInfo() to csv
	Promise.all(range(0, pool_length-1).map((i) => {
		let parameters: TypedParameter[] = [
			{ type: 'uint256', value: util.toHex(i) }
		];
		return sbch.call(
			null, 
			masterchef_address, 
			"poolInfo(uint256)", 
			parameters, 
			[
				{ name: 'lpToken', type: 'address' },
				{ name: 'allocPoint', type: 'uint256' },
				{ name: 'lastRewardBlock', type: 'uint256' },
				{ name: 'accSushiPerShare', type: 'uint256' },
			]
		)
		.then((result) => {
			return {
				masterchef_address: masterchef_address,
				pid: i,
				...result
			}
		})
		.catch(logError)
	}))
	.then(logToConsole)
	.then(writeCSV("out/basedata/masterchef_pools.csv"))
}

function logToConsole(result) {
	console.log(result);
	return result;
}

function logError(error) {
	console.log("ERROR: ", error);
	return error;
}

function flattenArrays(arrays) {
	return arrays.reduce((o, i) => { return o.concat(i); }, [])
}

function logResults(result: any) {
	console.log(result);
	return result;
}

function decodeTransactionInputs(results: any) {
	return results.map((tx) => {
		let contract = contract_manager.getContractByAddress(tx.to);
		if ( contract ) {
			let decoded = contract_manager.decodeTransactionInput(contract, tx.input, config.output.decimals);
			if (decoded && decoded.length > 0) {
				tx.input = decoded[0].human_readable;
				tx.decoded_input = decoded;
			}
		}
		return tx;
	})
}

function decodeLogsToEvents(logs: Log[]) {
	return Promise.all(logs.map(async (log) => {
		//console.log("decoding logs for contract ", log.address)
		let contract = contract_manager.getContractByAddress(log.address)
		if (contract) {
			let decode_results = contract_abis
			.filter(abi => contract["abiNames"].map((n) => { return n.toLowerCase(); }).includes(abi.type.toLowerCase()))
			.map((contract_abi) => {
				let event_decoder = new EventDecoder(contract_abi.abi);
				let dlog = event_decoder.decodeLog(log);
				if (dlog) {
					let parameters = dlog.events.reduce((o, e: IDecodedValue) => {
						o[`${e.name}(${e.type})`] = e.value;
						return o;
					}, {});
					//console.log("  success decoding events using contract_abi \"", contract_abi.type, "\" to log.name=", dlog.name)
					return {
						blockNumber: util.parseHex(""+log.blockNumber),
						transaction_hash: log.transactionHash,
						transaction_index: log.transactionIndex,
						abi: contract_abi.type,
						event_name: dlog.name,
						contract_address: log.address,
						contract_name: contract["name"],
						contract_symbol: contract["symbol"],
						...parameters
					}
				} 
			})
			if (decode_results.length == 0) {
				console.log(`  decode fail, unknwon/missing non-sep20 abi for contract ${contract.address}. Cannot decode events`);
				//console.log(log)
				return {
					blockNumber: util.parseHex(""+log.blockNumber),
					transaction_hash: log.transactionHash,
					transaction_index: log.transactionIndex,
					abi: "<unknwown>",
					event_name: "<unknown>",
					contract_address: log.address,
					contract_name: contract["name"],
					contract_symbol: contract["symbol"],
				}
			} else {
				return decode_results[0];
			}

		} else { // no contract
			console.log("no contract for log.address", log.address);
			return {
				blockNumber: util.parseHex(""+log.blockNumber),
				transaction_hash: log.transactionHash,
				transaction_index: log.transactionIndex,
				abi: "<unknown>",
				event_name: "<unknown>",
				contract_address: log.address,
				contract_name: "<unknown>",
				contract_symbol: "",
			}
		}
	}));
}

// look up blocks to set blockTimestamp, blockDate on each transfer
function extendEventsWithBlockInfo(events: any[]): Promise<any[]> {		
	let blockNumbers: string[] = events.map((t) => { 
		if (t) return util.toHex(t.blockNumber); 
		return '0x0'
	});
	return sbch.getBlocksByNumbers(blockNumbers)
	.then((blocks: any[]) => {
		//console.log("blocks", blocks)
		let blocks_by_number = blocks.reduce((o, block) => {
			o[util.parseHex(block.number)] = block;
			return o;
		},{});

		// extend event with block info
		return events
		.filter((event) => event)
		.map((event) => {
			if (event && event.blockNumber) {
				let block = blocks_by_number[event.blockNumber]
				return {
					blockTimestamp: block.timestamp,
					blockDate: new Date(1000 * parseInt(""+block.timestamp)).toISOString(),
					...event,
				};
			} else {
				return {
					blockTimestamp: -1,
					blockDate: "",
					...event,
				};
			}
		});
	});
}

function sortChronologically(events: any[]) {
	return events.sort((a,b) => {
		return a.blockTimestamp - b.blockTimestamp
	});
}

// create synthetic events from existing events like flexUSD interest payments from ChangeMultiplier events
function appendSyntheticEvents(events: any[]) {

	let created_events: any[] = [];

	// for each contract
	Object.keys(
		events
		.filter((event) => {
			return "Transfer" == event["event_name"];
		})
		.reduce((o, e) => {
			o[e.contract_address] = true
			return o;
		}, {})
	)
	.forEach((contract_address) => {
		let contract = contract_manager.getContractByAddress(contract_address);

		// setup balance tracking
		let balance_by_address = config.my_addresses.reduce((o,a) => {
			o[a] = new BigNumber(0.0);
			return o;
		}, {});
		//console.log("contract", contract.address, "balances", balance_by_address);

		// iterate through events in chronological order tracking balance and generating <synthetic> events
		let previousMultiplier = new BigNumber(`1E${contract["decimals"]}`);
		let relevant_events = 
		events
		.filter((event) => {
			return event["contract_name"] == contract.name && ["ChangeMultiplier", "Transfer"].includes(event["event_name"])
		})
		.sort((a,b) => {
			return a.blockTimestamp - b.blockTimestamp
		})
		.forEach((event) => {
			//console.log(event);
			if (event["event_name"] == "Transfer") {
				config.my_addresses.forEach((address) => {
					//console.log("address", address, "to", event["to(address)"], "value", event["value(uint256)"])
					if (event["from(address)"] && address.toLowerCase() == event["from(address)"].toLowerCase()) {
						balance_by_address[address] = balance_by_address[address].integerValue().minus(new BigNumber(event["value(uint256)"]).integerValue());
						event["<balance>(uint256)"] = balance_by_address[address]
					}
					if (event["to(address)"] && address.toLowerCase() == event["to(address)"].toLowerCase()) {
						balance_by_address[address] = balance_by_address[address].integerValue().plus(new BigNumber(event["value(uint256)"]).integerValue());
						event["<balance>(uint256)"] = balance_by_address[address]
					}
				})
			}
			if (event["event_name"] == "ChangeMultiplier") {
				let multiplier = new BigNumber(event["multiplier(uint256)"])

				config.my_addresses.forEach((a) => {
					let new_balance = balance_by_address[a].multipliedBy(multiplier).dividedBy(previousMultiplier).integerValue();
					let delta = new_balance.minus(balance_by_address[a])
					if (!delta.isEqualTo(0)) {
						created_events.push({
							blockTimestamp: event.blockTimestamp,
							blockDate: event.blockDate,
							blockNumber: event.blockNumber,
							transaction_hash: event.transaction_hash,
							transaction_index: event.transaction_index,
							abi: '<synthetic, interest payment>',
							event_name: 'Transfer',
							contract_address: event.contract_address,
							contract_name: event.contract_name,
							contract_symbol: event.contract_symbol,
							"from(address)": "",
							"to(address)": a,
							"value(uint256)": delta,
							"<balance>(uint256)": new_balance
						});
						balance_by_address[a] = new_balance;
					}
				})

				previousMultiplier = multiplier;
			}
		});
	}); 
	// config.my_addresses.forEach((a) => {
	// 	console.log(a, ": ", balance_by_address[a].dividedBy(1E18).toFixed(18));
	// })
	return events.concat(created_events).sort((a,b) => {
		return a.blockTimestamp - b.blockTimestamp
	});
}

function parseHex(parameter_names: string[]) {
	return (result) => {
		return result.map((data) => {
			parameter_names.forEach((p) => {
				data[p] = util.parseHex(data[p]) 
				//data[p] = new BigNumber(data[p]).toString()
			});
			return data;
		});
	};
}

function convertBCHValues(parameter_names: string[]) {
	let m = new BigNumber("1E18");
	return (events) => {
		return events.map((event) => {
			parameter_names.forEach((p) => {
				event[p] = new BigNumber(event[p]).integerValue().dividedBy(m).toFixed(config.output.decimals);
			});
			return event;
		});
	};
}

async function convertValues(events): Promise<any[]> {
	events.forEach(async (event) => {
		let contract = await contract_manager.getContractByAddress(event.contract_address);
		Object.keys(event).forEach((key) => {
			if (key.indexOf("(uint256)") > 0) {
				if (event[key] !== undefined ) {
					event[key+"_"] = new BigNumber(event[key]).integerValue().dividedBy(new BigNumber(`1e${contract["decimals"]}`)).toFixed(config.output.decimals)
					event[key] = new BigNumber(event[key]).integerValue().toString()
				}
			}
		});
	});
	return events;
}


function groupEventsByName(events: any[]): Promise<any> {
	// group eventy by their types
	let events_by_name = events.reduce((o, event) => {
		let key = 
			// event["abi"] + "." + event["event_name"] // enable when "abiNames": ["FlexUSDImplV2","sep20"] (in contract.json) woreks
			event["event_name"]
		if (config.output.separate_file_per_contract) {
			key += "." + event["contract_name"]
		}
		if (!o[key]) o[key] = [];
		o[key].push(event);
		return o;
	}, {});
	return events_by_name;
}

function ensureDir(dir: string) {
	//console.log("ensureDir(", dir, ")")
	if (!fs.existsSync(dir)){
		console.log("creating dir", dir)
		fs.mkdirSync(dir, { recursive: true });
	}
}

function ensureDirForFile(filename: string) {
	//console.log("ensureDirForFile(", filename, ")")
	ensureDir(path.dirname(filename))
}

function writeCSV(filename: string) {
	ensureDirForFile(filename)
	return (results) => {
		stringify(results, { 
			header: true,
			columns: Object.keys(results[0])
		})
		.pipe(createWriteStream(filename));
		console.log(`wrote ${results.length} items to ${filename}`);
		return results;
	}; 
}

function writeCSVs(dir: string) {
	ensureDir(dir)
	return (data_by_name) => {
		// dump events of each event name to "<event_name>.csv"
		Object.keys(data_by_name).forEach((event_name) => {
			let events = data_by_name[event_name];  
			let filename = "out/events/" + event_name + ".csv";
			ensureDirForFile(filename)
			stringify(events, { 
				header: true,
				columns: Object.keys(events[0])
			})
			.pipe(createWriteStream(filename))
			console.log(`wrote ${filename}: ${events.length} ${event_name}-events`);
		})
	}
}
//     queryLogs(address: string, data: any[], start: string | 'latest', end: string | 'latest', limit: string): Promise<any>;
